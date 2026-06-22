import { useCallback, useMemo, useRef, useState } from "react";
import { Wand2, Upload, Link2, Loader2, AlertCircle, Check, FileAudio, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { EffectParams } from "@/lib/audio-engine";
import {
  analyzeBlob,
  analyzeBuffer,
  computeMatchParams,
  type VoiceProfile,
  type MatchResult,
} from "@/lib/voice-analysis";
import { extractAudio } from "@/lib/extract-audio";
import { diagnostics } from "@/lib/diagnostics";

interface Props {
  /** Returns the decoded source buffer (the user's own audio) or null if not ready. */
  getSourceBuffer: () => AudioBuffer | null;
  onApply: (params: EffectParams) => void;
  disabled?: boolean;
}

const MAX_BYTES = 100 * 1024 * 1024;
const AUDIO_EXT = ["mp3", "wav", "m4a", "ogg", "webm", "aac", "flac"];

function validateAudioFile(file: File): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!file.type.startsWith("audio/") && !AUDIO_EXT.includes(ext || "")) {
    return "Unsupported format. Upload an audio file.";
  }
  if (file.size > MAX_BYTES) return "File too large (max 100 MB).";
  if (file.size === 0) return "File is empty or corrupted.";
  return null;
}

function base64ToBlob(base64: string, mime: string): Blob {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

export function VoiceMatchCard({ getSourceBuffer, onApply, disabled }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"file" | "link">("file");
  const [url, setUrl] = useState("");
  const [refName, setRefName] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "fetching" | "analyzing">(null);
  const [error, setError] = useState<string | null>(null);

  // Cached profiles so the strength slider recomputes instantly without re-analysis.
  const [srcProfile, setSrcProfile] = useState<VoiceProfile | null>(null);
  const [refProfile, setRefProfile] = useState<VoiceProfile | null>(null);
  const [strength, setStrength] = useState(80);
  const [applied, setApplied] = useState(false);

  const reset = () => {
    setRefName(null);
    setSrcProfile(null);
    setRefProfile(null);
    setError(null);
    setApplied(false);
  };

  const result: MatchResult | null = useMemo(() => {
    if (!srcProfile || !refProfile) return null;
    return computeMatchParams(srcProfile, refProfile, strength / 100);
  }, [srcProfile, refProfile, strength]);

  const runAnalysis = useCallback(
    async (refBlob: Blob, name: string) => {
      const source = getSourceBuffer();
      if (!source) {
        setError("Your audio isn't ready yet. Wait for the waveform to load, then try again.");
        return;
      }
      setBusy("analyzing");
      setError(null);
      setApplied(false);
      try {
        const [ref, src] = [await analyzeBlob(refBlob), analyzeBuffer(source)];
        setRefProfile(ref);
        setSrcProfile(src);
        setRefName(name);
        diagnostics.log("success", "audio", `Voice-match analyzed reference "${name}"`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg || "Could not analyze the reference audio.");
        diagnostics.log("error", "audio", "Voice-match analysis failed", msg);
      } finally {
        setBusy(null);
      }
    },
    [getSourceBuffer],
  );

  const onPickFile = (file: File | null | undefined) => {
    if (!file) return;
    const err = validateAudioFile(file);
    if (err) {
      setError(err);
      return;
    }
    runAnalysis(file, file.name.replace(/\.[^.]+$/, ""));
  };

  const onFetchUrl = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setBusy("fetching");
    setError(null);
    try {
      const res = await extractAudio({ data: trimmed });
      if (!res.ok || !res.base64) {
        setError(res.error ?? "Could not fetch audio from that link.");
        setBusy(null);
        return;
      }
      const blob = base64ToBlob(res.base64, res.mimeType ?? "audio/mp4");
      // analysis sets its own busy state; clear fetch state first
      setBusy(null);
      await runAnalysis(blob, res.title ?? "Link reference");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Link fetch failed.");
      setBusy(null);
    }
  };

  const apply = () => {
    if (!result) return;
    onApply(result.params);
    setApplied(true);
    toast.success(`Matched voice from "${refName}"`);
    diagnostics.log("info", "state", `Applied voice match (strength ${strength}%)`);
  };

  return (
    <div className="rounded-xl border bg-card/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display font-semibold flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-primary" /> Match a Voice
        </h3>
        {refName && (
          <button
            type="button"
            onClick={reset}
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <X className="h-3 w-3" /> Clear
          </button>
        )}
      </div>

      <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
        Use a reference clip's pitch &amp; tone for your audio. Approximates the sound — not an
        exact voice clone.
      </p>

      {!refName ? (
        <>
          <Tabs
            value={mode}
            onValueChange={(v) => {
              setMode(v as "file" | "link");
              setError(null);
            }}
          >
            <TabsList className="grid w-full grid-cols-2 h-9">
              <TabsTrigger value="file" className="gap-1.5 text-xs">
                <Upload className="h-3.5 w-3.5" /> File
              </TabsTrigger>
              <TabsTrigger value="link" className="gap-1.5 text-xs">
                <Link2 className="h-3.5 w-3.5" /> Link
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="mt-3">
            {mode === "file" ? (
              <>
                <Button
                  variant="secondary"
                  className="w-full gap-2"
                  disabled={disabled || busy !== null}
                  onClick={() => fileRef.current?.click()}
                >
                  {busy === "analyzing" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FileAudio className="h-4 w-4" />
                  )}
                  {busy === "analyzing" ? "Analyzing…" : "Choose reference audio"}
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={(e) => onPickFile(e.target.files?.[0])}
                />
              </>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="vm-url" className="sr-only">
                  Reference URL
                </Label>
                <Input
                  id="vm-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onFetchUrl();
                  }}
                  placeholder="Instagram / TikTok / YouTube URL"
                  disabled={busy !== null}
                  className="h-9"
                />
                <Button
                  className="w-full gap-2"
                  disabled={disabled || busy !== null || !url.trim()}
                  onClick={onFetchUrl}
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Link2 className="h-4 w-4" />
                  )}
                  {busy === "fetching"
                    ? "Fetching…"
                    : busy === "analyzing"
                      ? "Analyzing…"
                      : "Fetch & analyze"}
                </Button>
                <p className="text-[10px] text-muted-foreground">
                  Link extraction needs server support and only works on public posts. If it fails,
                  download the clip and use the File tab.
                </p>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border bg-secondary/40 px-3 py-2 text-sm">
            <Check className="h-4 w-4 text-primary shrink-0" />
            <span className="truncate font-medium">{refName}</span>
          </div>

          {refProfile && (
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <Stat
                label="Pitch"
                value={refProfile.medianF0 ? `${Math.round(refProfile.medianF0)} Hz` : "—"}
              />
              <Stat label="Brightness" value={`${Math.round(refProfile.centroid)} Hz`} />
            </div>
          )}

          {result && result.notes.length > 0 && (
            <ul className="space-y-1 text-[11px] text-muted-foreground">
              {result.notes.map((n, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="text-primary">•</span>
                  {n}
                </li>
              ))}
            </ul>
          )}

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <Label className="text-xs font-medium">Match strength</Label>
              <span className="font-mono text-xs tabular-nums text-primary">{strength}%</span>
            </div>
            <Slider
              value={[strength]}
              min={0}
              max={100}
              step={5}
              onValueChange={(v) => {
                setStrength(v[0] ?? 80);
                setApplied(false);
              }}
            />
          </div>

          <Button onClick={apply} className="w-full gap-2" disabled={!result}>
            {applied ? <Check className="h-4 w-4" /> : <Wand2 className="h-4 w-4" />}
            {applied ? "Applied — adjust & re-apply" : "Apply match"}
          </Button>
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-[11px]">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-destructive" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn("rounded-lg border bg-secondary/30 px-2.5 py-1.5")}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono font-medium">{value}</div>
    </div>
  );
}
