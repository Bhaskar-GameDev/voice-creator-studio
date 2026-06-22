// Real-time voice effects engine using Web Audio API.
// Smooth parameter updates via setTargetAtTime to avoid clicks/zipper noise.

export interface EffectParams {
  pitch: number;        // -100..100  -> -1200..+1200 cents
  bass: number;         // -100..100  -> -12..+12 dB low-shelf @100Hz
  treble: number;       // -100..100  -> -12..+12 dB high-shelf @6kHz
  warmth: number;       // -100..100  -> -6..+6 dB low-shelf @250Hz
  brightness: number;   // -100..100  -> -8..+8 dB high-shelf @10kHz
  presence: number;     // -100..100  -> -8..+8 dB peaking @3kHz Q=1
  clarity: number;      // -100..100  -> -6..+6 dB peaking @5kHz Q=1.2
  compression: number;  // 0..100     -> ratio 1..8, threshold -10..-50 dB
  reverb: number;       // 0..100     -> wet mix 0..0.55
  stereoWidth: number;  // 0..100     -> Haas delay on R 0..28ms
  voiceDepth: number;   // 0..100     -> 0..+9 dB low-shelf @120Hz
}

export const DEFAULT_PARAMS: EffectParams = {
  pitch: 0, bass: 0, treble: 0, warmth: 0, brightness: 0,
  presence: 0, clarity: 0, compression: 0, reverb: 0,
  stereoWidth: 0, voiceDepth: 0,
};

export const PARAM_META: Record<keyof EffectParams, { label: string; description: string; min: number; max: number; bipolar: boolean; unit?: string }> = {
  pitch:       { label: "Pitch",        description: "Shift voice up or down",            min: -100, max: 100, bipolar: true, unit: "¢" },
  bass:        { label: "Bass",         description: "Low-end body around 100 Hz",        min: -100, max: 100, bipolar: true, unit: "dB" },
  treble:      { label: "Treble",       description: "High-end air above 6 kHz",          min: -100, max: 100, bipolar: true, unit: "dB" },
  warmth:      { label: "Warmth",       description: "Lower-mid fullness at 250 Hz",      min: -100, max: 100, bipolar: true, unit: "dB" },
  brightness:  { label: "Brightness",   description: "Open high shelf at 10 kHz",         min: -100, max: 100, bipolar: true, unit: "dB" },
  presence:    { label: "Presence",     description: "Vocal forwardness at 3 kHz",        min: -100, max: 100, bipolar: true, unit: "dB" },
  clarity:     { label: "Clarity",      description: "Articulation at 5 kHz",             min: -100, max: 100, bipolar: true, unit: "dB" },
  compression: { label: "Compression",  description: "Even out dynamics",                 min: 0,    max: 100, bipolar: false },
  reverb:      { label: "Reverb",       description: "Spatial depth (wet/dry)",           min: 0,    max: 100, bipolar: false },
  stereoWidth: { label: "Stereo Width", description: "Pseudo-stereo via Haas delay",      min: 0,    max: 100, bipolar: false },
  voiceDepth:  { label: "Voice Depth",  description: "Sub body around 120 Hz",            min: 0,    max: 100, bipolar: false },
};

const SMOOTH = 0.025; // seconds — smoothing time constant for param ramps

function lerp(v: number, inMin: number, inMax: number, outMin: number, outMax: number) {
  const t = (v - inMin) / (inMax - inMin);
  return outMin + t * (outMax - outMin);
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  buffer: AudioBuffer | null = null;
  source: AudioBufferSourceNode | null = null;

  // Nodes
  inputGain!: GainNode;
  dryBypass!: GainNode;       // wet path = full chain to destination
  wetChain!: GainNode;        // bypass path = raw to destination
  bass!: BiquadFilterNode;
  warmth!: BiquadFilterNode;
  voiceDepth!: BiquadFilterNode;
  presence!: BiquadFilterNode;
  clarity!: BiquadFilterNode;
  treble!: BiquadFilterNode;
  brightness!: BiquadFilterNode;
  compressor!: DynamicsCompressorNode;
  reverbDry!: GainNode;
  reverbWet!: GainNode;
  convolver!: ConvolverNode;
  reverbSum!: GainNode;
  // Stereo width
  splitter!: ChannelSplitterNode;
  merger!: ChannelMergerNode;
  delayR!: DelayNode;
  masterGain!: GainNode;       // output volume (monitoring only, not baked into export)

  private params: EffectParams = { ...DEFAULT_PARAMS };
  private volume = 1;
  private playing = false;
  private bypass = false;
  private startedAt = 0;
  private pausedAt = 0;
  private rafId: number | null = null;
  playbackSpeed = 1.0;
  loop = false;

  onTimeUpdate?: (t: number) => void;
  onEnded?: () => void;
  onPlayingChange?: (p: boolean) => void;

  async load(blob: Blob): Promise<void> {
    this.dispose();
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    this.ctx = new Ctx();
    const arr = await blob.arrayBuffer();
    // decodeAudioData rejects on corrupted/unsupported audio
    this.buffer = await this.ctx.decodeAudioData(arr.slice(0));
    this.buildGraph();
    this.applyAllParams(true);
  }

  duration(): number { return this.buffer?.duration ?? 0; }
  isPlaying(): boolean { return this.playing; }
  isBypass(): boolean { return this.bypass; }

  currentTime(): number {
    if (!this.ctx || !this.buffer) return 0;
    if (this.playing) {
      const elapsedSec = (this.ctx.currentTime - this.startedAt) * this.playbackSpeed;
      if (this.loop) {
        return elapsedSec % this.buffer.duration;
      }
      return Math.min(elapsedSec, this.buffer.duration);
    }
    return this.pausedAt;
  }

  private buildGraph() {
    const ctx = this.ctx!;

    this.inputGain = ctx.createGain();

    // Bypass router: two parallel paths, crossfaded
    this.dryBypass = ctx.createGain();   // raw → destination
    this.wetChain = ctx.createGain();    // processed → destination
    this.dryBypass.gain.value = 0;
    this.wetChain.gain.value = 1;

    // EQ chain
    this.bass = ctx.createBiquadFilter();        this.bass.type = "lowshelf";  this.bass.frequency.value = 100;
    this.warmth = ctx.createBiquadFilter();      this.warmth.type = "lowshelf"; this.warmth.frequency.value = 250;
    this.voiceDepth = ctx.createBiquadFilter();  this.voiceDepth.type = "lowshelf"; this.voiceDepth.frequency.value = 120;
    this.presence = ctx.createBiquadFilter();    this.presence.type = "peaking"; this.presence.frequency.value = 3000; this.presence.Q.value = 1;
    this.clarity = ctx.createBiquadFilter();     this.clarity.type = "peaking"; this.clarity.frequency.value = 5000; this.clarity.Q.value = 1.2;
    this.treble = ctx.createBiquadFilter();      this.treble.type = "highshelf"; this.treble.frequency.value = 6000;
    this.brightness = ctx.createBiquadFilter();  this.brightness.type = "highshelf"; this.brightness.frequency.value = 10000;

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.knee.value = 18;
    this.compressor.attack.value = 0.006;
    this.compressor.release.value = 0.18;

    // Reverb (dry+wet sum)
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = makeImpulse(ctx, 2.4, 2.6);
    this.reverbDry = ctx.createGain(); this.reverbDry.gain.value = 1;
    this.reverbWet = ctx.createGain(); this.reverbWet.gain.value = 0;
    this.reverbSum = ctx.createGain();

    // Stereo width (Haas delay on R channel)
    this.splitter = ctx.createChannelSplitter(2);
    this.merger = ctx.createChannelMerger(2);
    this.delayR = ctx.createDelay(0.05);
    this.delayR.delayTime.value = 0;

    // Wire processed chain
    this.inputGain
      .connect(this.bass)
      .connect(this.warmth)
      .connect(this.voiceDepth)
      .connect(this.presence)
      .connect(this.clarity)
      .connect(this.treble)
      .connect(this.brightness)
      .connect(this.compressor);

    // Reverb parallel
    this.compressor.connect(this.reverbDry).connect(this.reverbSum);
    this.compressor.connect(this.convolver).connect(this.reverbWet).connect(this.reverbSum);

    // Stereo width split/merge — handles mono by duplicating
    this.reverbSum.connect(this.splitter);
    // L direct
    this.splitter.connect(this.merger, 0, 0);
    // R delayed
    this.splitter.connect(this.delayR, 1, 0);
    this.delayR.connect(this.merger, 0, 1);

    // Master volume node sits before destination on both paths
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.volume;

    this.merger.connect(this.wetChain).connect(this.masterGain);

    // Bypass path connects directly when source is created (so source -> dryBypass -> master)
    this.dryBypass.connect(this.masterGain);

    this.masterGain.connect(ctx.destination);
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.015);
    }
  }

  getVolume(): number { return this.volume; }

  setParam<K extends keyof EffectParams>(key: K, value: number, immediate = false) {
    this.params[key] = value;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const setTC = (param: AudioParam, target: number) => {
      if (immediate) param.setValueAtTime(target, t);
      else param.setTargetAtTime(target, t, SMOOTH);
    };
    switch (key) {
      case "pitch":
        if (this.source) setTC(this.source.detune, lerp(value, -100, 100, -1200, 1200));
        break;
      case "bass":       setTC(this.bass.gain,       lerp(value, -100, 100, -12, 12)); break;
      case "treble":     setTC(this.treble.gain,     lerp(value, -100, 100, -12, 12)); break;
      case "warmth":     setTC(this.warmth.gain,     lerp(value, -100, 100, -6, 6)); break;
      case "brightness": setTC(this.brightness.gain, lerp(value, -100, 100, -8, 8)); break;
      case "presence":   setTC(this.presence.gain,   lerp(value, -100, 100, -8, 8)); break;
      case "clarity":    setTC(this.clarity.gain,    lerp(value, -100, 100, -6, 6)); break;
      case "voiceDepth": setTC(this.voiceDepth.gain, lerp(value, 0, 100, 0, 9)); break;
      case "compression": {
        const amount = value / 100;
        setTC(this.compressor.threshold, lerp(amount, 0, 1, -10, -50));
        setTC(this.compressor.ratio, lerp(amount, 0, 1, 1, 8));
        break;
      }
      case "reverb": {
        const wet = lerp(value, 0, 100, 0, 0.55);
        setTC(this.reverbWet.gain, wet);
        setTC(this.reverbDry.gain, 1 - wet * 0.6);
        break;
      }
      case "stereoWidth":
        setTC(this.delayR.delayTime, lerp(value, 0, 100, 0, 0.028));
        break;
    }
  }

  applyAllParams(immediate = false) {
    (Object.keys(this.params) as (keyof EffectParams)[]).forEach((k) =>
      this.setParam(k, this.params[k], immediate),
    );
  }

  setAll(p: EffectParams, immediate = false) {
    this.params = { ...p };
    this.applyAllParams(immediate);
  }

  getParams(): EffectParams { return { ...this.params }; }

  setBypass(b: boolean) {
    if (!this.ctx) { this.bypass = b; return; }
    this.bypass = b;
    const t = this.ctx.currentTime;
    this.dryBypass.gain.setTargetAtTime(b ? 1 : 0, t, 0.015);
    this.wetChain.gain.setTargetAtTime(b ? 0 : 1, t, 0.015);
  }

  async play(from?: number): Promise<void> {
    if (!this.ctx || !this.buffer) return;
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.stopSource();
    const startFrom = from ?? this.pausedAt;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.detune.value = lerp(this.params.pitch, -100, 100, -1200, 1200);
    src.playbackRate.value = this.playbackSpeed;
    src.loop = this.loop;
    // Connect to BOTH paths; gains decide which is audible
    src.connect(this.inputGain);
    src.connect(this.dryBypass);
    src.onended = () => {
      if (this.source !== src) return; // superseded
      if (this.loop) return; // ignore ended event if looping
      const reachedEnd = this.currentTime() >= (this.buffer?.duration ?? 0) - 0.05;
      if (reachedEnd) {
        this.playing = false;
        this.pausedAt = 0;
        this.onPlayingChange?.(false);
        this.onTimeUpdate?.(0);
        this.onEnded?.();
        this.stopRaf();
      }
    };
    src.start(0, Math.max(0, Math.min(startFrom, this.buffer.duration - 0.01)));
    this.source = src;
    this.startedAt = this.ctx.currentTime - startFrom / this.playbackSpeed;
    this.playing = true;
    this.onPlayingChange?.(true);
    this.startRaf();
  }

  pause() {
    if (!this.playing) return;
    this.pausedAt = this.currentTime();
    this.stopSource();
    this.playing = false;
    this.onPlayingChange?.(false);
    this.stopRaf();
  }

  stop() {
    this.stopSource();
    this.pausedAt = 0;
    this.playing = false;
    this.onPlayingChange?.(false);
    this.onTimeUpdate?.(0);
    this.stopRaf();
  }

  seek(t: number) {
    const wasPlaying = this.playing;
    this.pausedAt = Math.max(0, Math.min(t, this.duration()));
    if (wasPlaying) this.play(this.pausedAt);
    else this.onTimeUpdate?.(this.pausedAt);
  }

  setPlaybackSpeed(speed: number) {
    this.playbackSpeed = speed;
    if (this.playing && this.source && this.ctx) {
      const currentT = this.currentTime();
      this.startedAt = this.ctx.currentTime - currentT / speed;
      this.source.playbackRate.setTargetAtTime(speed, this.ctx.currentTime, 0.01);
    }
  }

  setLoop(l: boolean) {
    this.loop = l;
    if (this.source) {
      this.source.loop = l;
    }
  }

  jump(offset: number) {
    const t = this.currentTime() + offset;
    this.seek(t);
  }

  private stopSource() {
    if (this.source) {
      try { this.source.onended = null; this.source.stop(); } catch { /* ignore */ }
      try { this.source.disconnect(); } catch { /* ignore */ }
      this.source = null;
    }
  }

  private startRaf() {
    this.stopRaf();
    const loop = () => {
      if (!this.playing) return;
      this.onTimeUpdate?.(this.currentTime());
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }
  private stopRaf() { if (this.rafId != null) { cancelAnimationFrame(this.rafId); this.rafId = null; } }

  dispose() {
    this.stopRaf();
    this.stopSource();
    if (this.ctx) {
      try { this.ctx.close(); } catch { /* ignore */ }
    }
    this.ctx = null;
    this.buffer = null;
  }
}

function makeImpulse(ctx: AudioContext, duration: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * duration));
  const ir = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return ir;
}
