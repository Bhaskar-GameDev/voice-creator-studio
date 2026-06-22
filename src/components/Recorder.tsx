import { useEffect, useRef, useState, useCallback } from "react";
import { Mic, Pause, Play, Square, X, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/projects";
import { toast } from "sonner";

type Phase = "idle" | "recording" | "paused" | "stopped";

interface Props {
  onComplete: (blob: Blob, durationSec: number) => void;
}

const RECORDING_CHANNEL = typeof window !== "undefined" && typeof BroadcastChannel !== "undefined"
  ? new BroadcastChannel("voice-studio:recording-channel")
  : null;

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

  // Protection states
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [otherTabRecording, setOtherTabRecording] = useState(false);

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

  // Sync media devices list
  useEffect(() => {
    if (!supported) return;
    refreshDevices();
    const handler = () => refreshDevices();
    navigator.mediaDevices.addEventListener?.("devicechange", handler);
    return () => navigator.mediaDevices.removeEventListener?.("devicechange", handler);
  }, [refreshDevices, supported]);

  // Clean up all audio nodes, tracks, timers, etc.
  const cleanup = useCallback(() => {
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => {
      try { t.stop(); } catch {}
    });
    streamRef.current = null;
    recorderRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
    setLevel(0);
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  // Prevent browser refresh during active recordings
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (phase === "recording" || phase === "paused") {
        e.preventDefault();
        e.returnValue = "Recording in progress. Leaving will discard the unsaved recording.";
        return e.returnValue;
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [phase]);

  // Prevent multiple simultaneous recordings across tabs/windows
  useEffect(() => {
    if (!RECORDING_CHANNEL) return;

    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === "recording-started") {
        setOtherTabRecording(true);
      } else if (e.data?.type === "recording-stopped") {
        setOtherTabRecording(false);
      }
    };

    RECORDING_CHANNEL.addEventListener("message", handleMessage);

    // Initial check for active recording lock
    const activeLock = localStorage.getItem("voice-studio:active-recorder-lock");
    if (activeLock) {
      const lockTime = parseInt(activeLock, 10);
      if (Date.now() - lockTime < 60000) { // Lock is fresh (less than 1 minute old)
        setOtherTabRecording(true);
      } else {
        localStorage.removeItem("voice-studio:active-recorder-lock");
      }
    }

    return () => {
      RECORDING_CHANNEL.removeEventListener("message", handleMessage);
    };
  }, []);

  // Maintain lock and notify other tabs periodically while recording
  useEffect(() => {
    if (phase === "recording" || phase === "paused") {
      const notifyInterval = setInterval(() => {
        localStorage.setItem("voice-studio:active-recorder-lock", Date.now().toString());
        RECORDING_CHANNEL?.postMessage({ type: "recording-started" });
      }, 10000); // refresh lock every 10s

      localStorage.setItem("voice-studio:active-recorder-lock", Date.now().toString());
      RECORDING_CHANNEL?.postMessage({ type: "recording-started" });

      return () => {
        clearInterval(notifyInterval);
        localStorage.removeItem("voice-studio:active-recorder-lock");
        RECORDING_CHANNEL?.postMessage({ type: "recording-stopped" });
      };
    }
  }, [phase]);

  // Cleanup lock on page exit/crash recovery helper
  useEffect(() => {
    const handleUnloadCleanup = () => {
      if (phase === "recording" || phase === "paused") {
        localStorage.removeItem("voice-studio:active-recorder-lock");
        RECORDING_CHANNEL?.postMessage({ type: "recording-stopped" });
      }
    };
    window.addEventListener("pagehide", handleUnloadCleanup);
    return () => window.removeEventListener("pagehide", handleUnloadCleanup);
  }, [phase]);

  // Forward declaration of stop for use in tickTimer
  const stopRef = useRef<() => void>(() => {});

  const tickTimer = useCallback(() => {
    const live = (Date.now() - startedAtRef.current) / 1000;
    const totalElapsed = accumulatedRef.current + live;
    setElapsed(totalElapsed);

    // Cap recording duration at 20 minutes (1200 seconds)
    if (totalElapsed >= 1200) {
      toast.warning("Recording limit reached (20 minutes). Saving recording automatically.");
      stopRef.current();
    }
  }, []);

  const startLevelMeter = (stream: MediaStream) => {
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new Ctx();
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
    if (isTransitioning) return;
    setIsTransitioning(true);
    setTimeout(() => setIsTransitioning(false), 500);

    setError(null);
    if (!supported) {
      setError("Your browser does not support audio recording.");
      return;
    }

    // Double check other tab active recording lock
    const activeLock = localStorage.getItem("voice-studio:active-recorder-lock");
    if (activeLock) {
      const lockTime = parseInt(activeLock, 10);
      if (Date.now() - lockTime < 60000) {
        setOtherTabRecording(true);
        toast.error("Another tab is currently recording. Please stop it before starting a new one.");
        return;
      }
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      streamRef.current = stream;
      stream.getAudioTracks()[0]?.addEventListener("ended", () => {
        setError("Microphone was disconnected.");
        stopRef.current();
      });
      await refreshDevices();
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorderRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onerror = (e: any) => {
        setError(e?.error?.message ?? "Recorder error");
        toast.error(e?.error?.message ?? "An error occurred during recording.");
      };
      rec.start(250);
      accumulatedRef.current = 0;
      startedAtRef.current = Date.now();
      setElapsed(0);
      timerRef.current = window.setInterval(tickTimer, 100);
      startLevelMeter(stream);
      setPhase("recording");
    } catch (e: any) {
      cleanup();
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
    if (isTransitioning) return;
    setIsTransitioning(true);
    setTimeout(() => setIsTransitioning(false), 500);

    const rec = recorderRef.current;
    if (!rec || rec.state !== "recording") return;
    try {
      rec.pause();
      accumulatedRef.current += (Date.now() - startedAtRef.current) / 1000;
      if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
      setPhase("paused");
    } catch (e: any) {
      toast.error("Could not pause recording: " + (e?.message ?? e));
    }
  };

  const resume = () => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    setTimeout(() => setIsTransitioning(false), 500);

    const rec = recorderRef.current;
    if (!rec || rec.state !== "paused") return;
    try {
      rec.resume();
      startedAtRef.current = Date.now();
      timerRef.current = window.setInterval(tickTimer, 100);
      setPhase("recording");
    } catch (e: any) {
      toast.error("Could not resume recording: " + (e?.message ?? e));
    }
  };

  const stop = useCallback(() => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    setTimeout(() => setIsTransitioning(false), 500);

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
        toast.error("Recording was empty. Please check your microphone connection.");
        return;
      }

      // Check if clip is extremely short (< 0.5 seconds)
      if (finalDur < 0.5) {
        toast.error("Recording is too short (minimum 0.5 seconds required).");
        setError("Recording was too short.");
        return;
      }

      onComplete(blob, finalDur);
    };

    try {
      if (rec.state !== "inactive") rec.stop();
      else cleanup();
    } catch (e) {
      cleanup();
      setPhase("idle");
      setElapsed(0);
    }
  }, [phase, isTransitioning, cleanup, onComplete]);

  // Keep stopRef fresh with current stop function
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  const cancel = () => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    setTimeout(() => setIsTransitioning(false), 500);

    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.onstop = null as any;
      try { rec.stop(); } catch {}
    }
    chunksRef.current = [];
    cleanup();
    setPhase("idle");
    setElapsed(0);
    toast.info("Recording cancelled.");
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
      {otherTabRecording && !active && (
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-warning" />
          <div>
            <div className="font-semibold">Microphone Locked</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Another browser tab is currently recording audio. Please stop that recording to enable recording in this tab.
            </p>
          </div>
        </div>
      )}

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
          <Select value={deviceId} onValueChange={setDeviceId} disabled={active || otherTabRecording}>
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
          <Button
            onClick={start}
            disabled={otherTabRecording || isTransitioning}
            size="lg"
            className="gap-2"
          >
            {isTransitioning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
            Start recording
          </Button>
        ) : (
          <>
            {isRec ? (
              <Button onClick={pause} disabled={isTransitioning} size="lg" variant="secondary" className="gap-2">
                <Pause className="h-4 w-4" /> Pause
              </Button>
            ) : (
              <Button onClick={resume} disabled={isTransitioning} size="lg" className="gap-2">
                <Play className="h-4 w-4" /> Resume
              </Button>
            )}
            <Button onClick={stop} disabled={isTransitioning} size="lg" variant="default" className="gap-2">
              <Square className="h-4 w-4" /> Stop & save
            </Button>
            <Button onClick={cancel} disabled={isTransitioning} size="lg" variant="ghost" className="gap-2 text-muted-foreground">
              <X className="h-4 w-4" /> Cancel
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
