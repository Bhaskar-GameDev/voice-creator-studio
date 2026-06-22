import { useEffect, useRef, useState, useCallback } from "react";
import { Mic, Pause, Play, Square, X, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/projects";

type Phase = "idle" | "recording" | "paused" | "stopped";

interface Props {
  onComplete: (blob: Blob, durationSec: number) => void;
}

function pickMime(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}

export function Recorder({ onComplete }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [level, setLevel] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const accumulatedRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);

  const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices && typeof MediaRecorder !== "undefined";

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const mics = list.filter((d) => d.kind === "audioinput");
      setDevices(mics);
      if (!deviceId && mics[0]?.deviceId) setDeviceId(mics[0].deviceId);
    } catch {
      /* ignore */
    }
  }, [deviceId]);

  useEffect(() => {
    if (!supported) return;
    refreshDevices();
    const handler = () => refreshDevices();
    navigator.mediaDevices.addEventListener?.("devicechange", handler);
    return () => navigator.mediaDevices.removeEventListener?.("devicechange", handler);
  }, [refreshDevices, supported]);

  const cleanup = useCallback(() => {
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
    setLevel(0);
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const tickTimer = useCallback(() => {
    const live = (Date.now() - startedAtRef.current) / 1000;
    setElapsed(accumulatedRef.current + live);
  }, []);

  const startLevelMeter = (stream: MediaStream) => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 2.5));
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
    } catch { /* ignore */ }
  };

  const start = async () => {
    setError(null);
    if (!supported) {
      setError("Your browser does not support audio recording.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      streamRef.current = stream;
      stream.getAudioTracks()[0]?.addEventListener("ended", () => {
        setError("Microphone was disconnected.");
        stop();
      });
      await refreshDevices();
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorderRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onerror = (e: any) => setError(e?.error?.message ?? "Recorder error");
      rec.start(250);
      accumulatedRef.current = 0;
      startedAtRef.current = Date.now();
      setElapsed(0);
      timerRef.current = window.setInterval(tickTimer, 100);
      startLevelMeter(stream);
      setPhase("recording");
    } catch (e: any) {
      if (e?.name === "NotAllowedError" || e?.name === "SecurityError") {
        setError("Microphone permission denied. Please allow microphone access in your browser settings.");
      } else if (e?.name === "NotFoundError") {
        setError("No microphone found. Please connect an input device.");
      } else if (e?.name === "NotReadableError") {
        setError("Microphone is in use by another application.");
      } else {
        setError(e?.message ?? "Could not start recording.");
      }
    }
  };

  const pause = () => {
    const rec = recorderRef.current;
    if (!rec || rec.state !== "recording") return;
    rec.pause();
    accumulatedRef.current += (Date.now() - startedAtRef.current) / 1000;
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    setPhase("paused");
  };

  const resume = () => {
    const rec = recorderRef.current;
    if (!rec || rec.state !== "paused") return;
    rec.resume();
    startedAtRef.current = Date.now();
    timerRef.current = window.setInterval(tickTimer, 100);
    setPhase("recording");
  };

  const stop = () => {
    const rec = recorderRef.current;
    if (!rec) return;
    const finalDur = phase === "recording"
      ? accumulatedRef.current + (Date.now() - startedAtRef.current) / 1000
      : accumulatedRef.current;
    rec.onstop = () => {
      const type = rec.mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      cleanup();
      setPhase("idle");
      setElapsed(0);
      if (blob.size === 0) {
        setError("Recording was empty. Please try again.");
        return;
      }
      onComplete(blob, finalDur);
    };
    if (rec.state !== "inactive") rec.stop();
    else cleanup();
  };

  const cancel = () => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.onstop = null as any;
      try { rec.stop(); } catch {}
    }
    chunksRef.current = [];
    cleanup();
    setPhase("idle");
    setElapsed(0);
  };

  if (!supported) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm">
        <div className="flex items-center gap-2 font-medium"><AlertCircle className="h-4 w-4" /> Recording not supported</div>
        <p className="mt-2 text-muted-foreground">Use a modern browser (Chrome, Edge, Firefox, Safari) with microphone access.</p>
      </div>
    );
  }

  const isRec = phase === "recording";
  const isPaused = phase === "paused";
  const active = isRec || isPaused;

  return (
    <div className="rounded-xl border bg-card/60 p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={cn(
            "grid h-12 w-12 place-items-center rounded-full bg-secondary",
            isRec && "bg-[var(--color-recording)] text-white recording-pulse",
            isPaused && "bg-warning text-background",
          )}>
            <Mic className="h-5 w-5" />
          </div>
          <div>
            <div className="font-display text-2xl font-bold tabular-nums">{formatDuration(elapsed)}</div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">
              {isRec ? "Recording" : isPaused ? "Paused" : "Ready"}
            </div>
          </div>
        </div>
        <div className="min-w-[200px]">
          <Select value={deviceId} onValueChange={setDeviceId} disabled={active}>
            <SelectTrigger><SelectValue placeholder="Select microphone" /></SelectTrigger>
            <SelectContent>
              {devices.length === 0 ? (
                <SelectItem value="default">Default microphone</SelectItem>
              ) : devices.map((d) => (
                <SelectItem key={d.deviceId} value={d.deviceId}>
                  {d.label || `Microphone ${d.deviceId.slice(0, 6)}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full bg-gradient-to-r from-primary via-warning to-destructive transition-[width] duration-75"
          style={{ width: `${Math.round(level * 100)}%` }}
        />
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {!active ? (
          <Button onClick={start} size="lg" className="gap-2">
            <Mic className="h-4 w-4" /> Start recording
          </Button>
        ) : (
          <>
            {isRec ? (
              <Button onClick={pause} size="lg" variant="secondary" className="gap-2">
                <Pause className="h-4 w-4" /> Pause
              </Button>
            ) : (
              <Button onClick={resume} size="lg" className="gap-2">
                <Play className="h-4 w-4" /> Resume
              </Button>
            )}
            <Button onClick={stop} size="lg" variant="default" className="gap-2">
              <Square className="h-4 w-4" /> Stop & save
            </Button>
            <Button onClick={cancel} size="lg" variant="ghost" className="gap-2 text-muted-foreground">
              <X className="h-4 w-4" /> Cancel
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
