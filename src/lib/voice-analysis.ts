// Voice profile analysis — extract an acoustic "fingerprint" from a reference
// recording, then derive EffectParams that nudge a source clip toward it.
//
// This is NOT neural voice cloning: it cannot reproduce a person's vocal-tract
// identity/timbre. It measures average pitch (F0) and spectral balance, and
// maps the *difference* between source and reference onto the existing EQ/pitch
// controls. Result: the source sits in a similar tonal/pitch space as the
// reference (deeper/brighter/warmer), an approximation — not the same voice.

import type { EffectParams } from "./audio-engine";
import { DEFAULT_PARAMS } from "./audio-engine";

// ---- Frequency bands, aligned to the engine's filter centers -------------
// Non-overlapping, contiguous-ish bands. The gap 500–2000 Hz (vocal body) is
// folded into the total only, so it normalizes balance without its own slider.
type BandName = "sub" | "bass" | "warmth" | "presence" | "clarity" | "treble" | "brightness";

const BANDS: Record<BandName, [number, number]> = {
  sub: [50, 120], // -> voiceDepth (lowshelf @120)
  bass: [120, 250], // -> bass       (lowshelf @100)
  warmth: [250, 500], // -> warmth     (lowshelf @250)
  presence: [2000, 4000], // -> presence   (peaking  @3000)
  clarity: [4000, 6000], // -> clarity    (peaking  @5000)
  treble: [6000, 9000], // -> treble     (highshelf @6000)
  brightness: [9000, 14000], // -> brightness (highshelf @10000)
};

const TOTAL_RANGE: [number, number] = [50, 14000];

export interface VoiceProfile {
  /** Median fundamental frequency (Hz) across voiced frames, or null if none. */
  medianF0: number | null;
  /** Per-band share of total spectral power (linear, sums≈≤1 excluding the body gap). */
  balance: Record<BandName, number>;
  /** Spectral centroid (Hz) — overall "brightness" of the timbre. */
  centroid: number;
  /** Seconds of audio that contributed to the estimate (voiced/energetic frames). */
  analyzedSeconds: number;
}

// ============================ FFT ==========================================
// In-place iterative radix-2 Cooley–Tukey. re/im are length N (power of two).
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  // bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1,
        ci = 0;
      for (let k = 0; k < len >> 1; k++) {
        const a = i + k;
        const b = a + (len >> 1);
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

// ============================ Analysis =====================================
const FRAME = 2048; // FFT size (~46ms @44.1k) — good F0 + spectral resolution
const HOP = 1024; // 50% overlap
const MIN_F0 = 70; // Hz — lowest voice fundamental we look for
const MAX_F0 = 400; // Hz — highest (covers most speech/song)
const SILENCE_RMS = 0.012; // frames quieter than this are skipped

/** Downmix any AudioBuffer to a single mono Float32Array. */
function toMono(buffer: AudioBuffer): Float32Array {
  const ch = buffer.numberOfChannels;
  const len = buffer.length;
  if (ch === 1) return buffer.getChannelData(0);
  const out = new Float32Array(len);
  for (let c = 0; c < ch; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) out[i] += data[i];
  }
  for (let i = 0; i < len; i++) out[i] /= ch;
  return out;
}

/** Autocorrelation pitch estimate for one frame. Returns Hz or null if unvoiced. */
function estimateF0(frame: Float32Array, sampleRate: number): number | null {
  const minLag = Math.floor(sampleRate / MAX_F0);
  const maxLag = Math.min(frame.length - 1, Math.floor(sampleRate / MIN_F0));
  let bestLag = -1;
  let bestCorr = 0;
  // Energy at lag 0 for normalization
  let norm0 = 0;
  for (let i = 0; i < frame.length; i++) norm0 += frame[i] * frame[i];
  if (norm0 <= 0) return null;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i + lag < frame.length; i++) corr += frame[i] * frame[i + lag];
    const normalized = corr / norm0;
    if (normalized > bestCorr) {
      bestCorr = normalized;
      bestLag = lag;
    }
  }
  // Require a reasonably periodic frame to count it as voiced
  if (bestLag < 0 || bestCorr < 0.45) return null;
  return sampleRate / bestLag;
}

/** Analyze an already-decoded AudioBuffer into a VoiceProfile (pure, sync). */
export function analyzeBuffer(buffer: AudioBuffer): VoiceProfile {
  const sr = buffer.sampleRate;
  const mono = toMono(buffer);

  // Hann window, reused
  const win = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));

  const re = new Float32Array(FRAME);
  const im = new Float32Array(FRAME);
  const powerSum = new Float64Array(FRAME / 2); // accumulated magnitude² per bin
  const f0s: number[] = [];
  let voicedFrames = 0;

  for (let start = 0; start + FRAME <= mono.length; start += HOP) {
    // RMS gate — skip silence so it doesn't flatten the average spectrum
    let rms = 0;
    for (let i = 0; i < FRAME; i++) {
      const s = mono[start + i];
      rms += s * s;
    }
    rms = Math.sqrt(rms / FRAME);
    if (rms < SILENCE_RMS) continue;
    voicedFrames++;

    // Pitch on the raw (windowed lightly via gate) frame
    const f0 = estimateF0(mono.subarray(start, start + FRAME), sr);
    if (f0) f0s.push(f0);

    // Windowed FFT for spectrum
    for (let i = 0; i < FRAME; i++) {
      re[i] = mono[start + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < FRAME / 2; k++) powerSum[k] += re[k] * re[k] + im[k] * im[k];
  }

  const binHz = sr / FRAME;
  const inRange = (hz: number, [lo, hi]: [number, number]) => hz >= lo && hz < hi;

  // Band power + centroid + total over TOTAL_RANGE
  const bandPower: Record<BandName, number> = {
    sub: 0,
    bass: 0,
    warmth: 0,
    presence: 0,
    clarity: 0,
    treble: 0,
    brightness: 0,
  };
  let total = 0;
  let centroidNum = 0;
  for (let k = 1; k < FRAME / 2; k++) {
    const hz = k * binHz;
    if (!inRange(hz, TOTAL_RANGE)) continue;
    const p = powerSum[k];
    total += p;
    centroidNum += hz * p;
    for (const name of Object.keys(BANDS) as BandName[]) {
      if (inRange(hz, BANDS[name])) bandPower[name] += p;
    }
  }

  const balance = {} as Record<BandName, number>;
  for (const name of Object.keys(BANDS) as BandName[]) {
    balance[name] = total > 0 ? bandPower[name] / total : 0;
  }

  const medianF0 = medianWithOctaveFix(f0s);

  return {
    medianF0,
    balance,
    centroid: total > 0 ? centroidNum / total : 0,
    analyzedSeconds: (voicedFrames * HOP) / sr,
  };
}

// Autocorrelation often locks onto a sub-/super-octave for some frames, which
// splits the F0 distribution and corrupts a plain median. Fold every estimate
// to within an octave of the rough median, then take the median of that.
function medianWithOctaveFix(values: number[]): number | null {
  if (!values.length) return null;
  const median = (arr: number[]) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const rough = median(values);
  const folded = values.map((v) => {
    let x = v;
    while (x > rough * 1.5) x /= 2;
    while (x < rough * 0.67) x *= 2;
    return x;
  });
  return median(folded);
}

/** Decode a Blob/File and analyze it. Caller must run this in the browser. */
export async function analyzeBlob(blob: Blob): Promise<VoiceProfile> {
  const Ctx = (window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext) as typeof AudioContext;
  const ctx = new Ctx();
  try {
    const arr = await blob.arrayBuffer();
    const buffer = await ctx.decodeAudioData(arr.slice(0));
    if (buffer.duration < 0.5) throw new Error("Reference clip is too short (need ≥ 0.5s).");
    return analyzeBuffer(buffer);
  } finally {
    try {
      ctx.close();
    } catch {
      /* ignore */
    }
  }
}

// ============================ Mapping ======================================
// Map a band's power-balance difference (ref vs source) to a slider value.
// The raw dB difference is FIRST clamped to ±fullScaleDb so a wildly different
// recording (e.g. a music-heavy clip vs a dry voice) can't produce a 30 dB swing
// that pegs the slider — that was the source of "garbage" maxed-out values.
function bandToSlider(
  refShare: number,
  srcShare: number,
  fullScaleDb: number,
  strength: number,
  { positiveOnly = false, cap = 100 }: { positiveOnly?: boolean; cap?: number } = {},
): number {
  // Bands near-silent in BOTH clips carry no perceptual weight; a tiny/tiny ratio
  // can be huge, so skip them rather than let noise drive the slider.
  const FLOOR = 0.003; // 0.3% of total spectral power
  if (Math.max(refShare, srcShare) < FLOOR) return 0;
  const EPS = 1e-6;
  const dbRaw = 10 * Math.log10((refShare + EPS) / (srcShare + EPS));
  const db = clamp(dbRaw, -fullScaleDb, fullScaleDb); // bound before scaling
  let slider = (db / fullScaleDb) * 100 * strength;
  if (positiveOnly) slider = Math.max(0, slider);
  return clamp(Math.round(slider), positiveOnly ? 0 : -cap, cap);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export interface MatchResult {
  params: EffectParams;
  /** Human-readable notes for the UI (e.g. "+3 semitones lower", "brighter"). */
  notes: string[];
}

/**
 * Derive EffectParams that move `source` toward `reference`.
 * `strength` 0..1 scales how aggressively the difference is applied (default 0.8).
 * Only pitch + tonal-balance controls are inferred; dynamics/space (compression,
 * reverb, stereoWidth) are left at their defaults.
 */
export function computeMatchParams(
  source: VoiceProfile,
  reference: VoiceProfile,
  strength = 0.8,
): MatchResult {
  const s = clamp(strength, 0, 1);
  const params: EffectParams = { ...DEFAULT_PARAMS };
  const notes: string[] = [];

  // Too little usable audio on either side → estimates are unreliable; bail to
  // defaults rather than emit nonsense.
  if (source.analyzedSeconds < 0.4 || reference.analyzedSeconds < 0.4) {
    notes.push("Not enough clear audio to analyze — try a longer, cleaner clip.");
    return { params, notes };
  }

  // --- Pitch (cents from F0 ratio) ---
  // Bound to ±7 semitones: bigger shifts wreck formants (chipmunk/monster) and
  // usually mean an octave-detection error rather than a real difference.
  if (source.medianF0 && reference.medianF0) {
    const cents = clamp(1200 * Math.log2(reference.medianF0 / source.medianF0), -700, 700);
    const PITCH_MAX = 1200; // engine maps ±100 slider -> ±1200 cents
    params.pitch = clamp(Math.round((cents / PITCH_MAX) * 100 * s), -70, 70);
    const semis = cents / 100;
    if (Math.abs(semis) >= 0.5) {
      notes.push(
        `Pitch ${semis > 0 ? "up" : "down"} ~${Math.abs(semis).toFixed(1)} semitones ` +
          `(${Math.round(source.medianF0)}→${Math.round(reference.medianF0)} Hz)`,
      );
    }
  } else {
    notes.push("No clear pitch detected — pitch left unchanged.");
  }

  // --- Tonal balance (per-band EQ) ---
  // Per-band caps keep any single band from dominating, so a tonal mismatch
  // becomes a tasteful nudge instead of a maxed-out, harsh result.
  const b = reference.balance;
  const a = source.balance;
  params.voiceDepth = bandToSlider(b.sub, a.sub, 9, s, { positiveOnly: true, cap: 60 });
  params.bass = bandToSlider(b.bass, a.bass, 12, s, { cap: 45 });
  params.warmth = bandToSlider(b.warmth, a.warmth, 6, s, { cap: 35 });
  params.presence = bandToSlider(b.presence, a.presence, 8, s, { cap: 35 });
  params.clarity = bandToSlider(b.clarity, a.clarity, 6, s, { cap: 30 });
  params.treble = bandToSlider(b.treble, a.treble, 12, s, { cap: 40 });
  params.brightness = bandToSlider(b.brightness, a.brightness, 8, s, { cap: 35 });

  // Brightness note from centroid difference
  if (source.centroid > 0 && reference.centroid > 0) {
    const ratio = reference.centroid / source.centroid;
    if (ratio > 1.12) notes.push("Reference is brighter — added high-end.");
    else if (ratio < 0.89) notes.push("Reference is darker — softened high-end.");
  }
  if (params.voiceDepth > 8) notes.push("Reference has more low-end body — added depth.");

  return { params, notes };
}
