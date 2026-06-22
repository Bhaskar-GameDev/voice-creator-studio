import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { Play, Pause, Square, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { formatDuration } from "@/lib/projects";

interface Props {
  blob: Blob;
  fileName?: string;
}

export function WaveformPlayer({ blob, fileName = "voice-studio-export" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    setReady(false);
    setError(null);
    const styles = getComputedStyle(document.documentElement);
    const waveColor = styles.getPropertyValue("--waveform").trim() || "#6b7280";
    const progressColor = styles.getPropertyValue("--waveform-progress").trim() || "#f59e0b";

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor,
      progressColor,
      cursorColor: progressColor,
      cursorWidth: 2,
      barWidth: 2,
      barGap: 2,
      barRadius: 2,
      height: 110,
      normalize: true,
    });
    wsRef.current = ws;

    const url = URL.createObjectURL(blob);
    ws.load(url).catch((e) => setError(e?.message ?? "Failed to decode audio"));

    ws.on("ready", () => {
      setReady(true);
      setDuration(ws.getDuration());
    });
    ws.on("audioprocess", () => setCurrent(ws.getCurrentTime()));
    ws.on("seeking", () => setCurrent(ws.getCurrentTime()));
    ws.on("play", () => setPlaying(true));
    ws.on("pause", () => setPlaying(false));
    ws.on("finish", () => setPlaying(false));
    ws.on("error", (e) => setError(String(e)));

    return () => {
      ws.destroy();
      URL.revokeObjectURL(url);
    };
  }, [blob]);

  const toggle = () => wsRef.current?.playPause();
  const stop = () => {
    wsRef.current?.stop();
    setCurrent(0);
  };
  const download = () => {
    const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : blob.type.includes("wav") ? "wav" : "webm";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${fileName}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="rounded-xl border bg-card/60 p-4 sm:p-6 space-y-4">
      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive-foreground">
          Could not load audio: {error}
        </div>
      ) : null}
      <div ref={containerRef} className="min-h-[110px]" aria-label="Audio waveform" />
      <div className="flex items-center justify-between text-xs font-mono text-muted-foreground tabular-nums">
        <span>{formatDuration(current)}</span>
        <span>{formatDuration(duration)}</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button onClick={toggle} disabled={!ready} size="lg" className="gap-2">
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {playing ? "Pause" : "Play"}
          </Button>
          <Button onClick={stop} disabled={!ready} variant="secondary" size="lg" className="gap-2">
            <Square className="h-4 w-4" /> Stop
          </Button>
        </div>
        <div className="flex items-center gap-3 min-w-[180px]">
          <span className="text-xs text-muted-foreground">Vol</span>
          <Slider
            value={[volume * 100]}
            onValueChange={(v) => {
              const nv = (v[0] ?? 0) / 100;
              setVolume(nv);
              wsRef.current?.setVolume(nv);
            }}
            max={100}
            step={1}
            className="w-32"
          />
          <Button onClick={download} variant="outline" size="lg" className="gap-2">
            <Download className="h-4 w-4" /> Export
          </Button>
        </div>
      </div>
    </div>
  );
}
