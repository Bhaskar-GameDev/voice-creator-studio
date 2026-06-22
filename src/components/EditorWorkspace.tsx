import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import {
  Play, Pause, Square, Download, RotateCcw, Undo2, Redo2,
  Save, Share2, Copy, Trash2, Pencil, Sparkles, Check, X,
  Repeat, SkipForward, SkipBack, Loader2, AlertCircle, Import,
  Volume2, VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AudioEngine, DEFAULT_PARAMS, PARAM_META, type EffectParams } from "@/lib/audio-engine";
import {
  BUILTIN_PRESETS, decodePreset, deleteCustomPreset, encodePreset, listCustomPresets,
  newPresetId, sanitizeParams, saveCustomPreset, type Preset,
} from "@/lib/presets";
import { getProject, saveProject, formatDuration } from "@/lib/projects";
import { VoiceMatchCard } from "@/components/VoiceMatchCard";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { diagnostics } from "@/lib/diagnostics";

interface Props {
  blob: Blob;
  fileName: string;
  projectId?: string;
  initialParams?: EffectParams;
}

const PARAM_KEYS = Object.keys(PARAM_META) as (keyof EffectParams)[];
const HISTORY_LIMIT = 50;

// Strip characters illegal in filenames (/, \, :, *, ?, ", <, >, |) so downloads
// of projects named from toLocaleString (e.g. "Recording 6/22/2026, 3:45 PM") work.
function safeFileName(name: string): string {
  const cleaned = name.replace(/[/\\:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  return cleaned || "voice-studio-export";
}

export function EditorWorkspace({ blob, fileName, projectId, initialParams: rawInitialParams }: Props) {
  // Persisted effects may be corrupted (manual storage edits, version drift); sanitize
  // so out-of-range/NaN values can't reach Web Audio params and brick the workspace.
  const initialParams = useMemo(
    () => (rawInitialParams ? sanitizeParams(rawInitialParams) : DEFAULT_PARAMS),
    [rawInitialParams],
  );
  // ----- Engine + audio state -----
  const engineRef = useRef<AudioEngine | null>(null);
  const waveContainer = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bypass, setBypass] = useState(false);

  // Playback enhancements
  const [speed, setSpeed] = useState(1.0);
  const [loop, setLoop] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [exportingOriginal, setExportingOriginal] = useState(false);

  // ----- Params + history -----
  const [params, setParams] = useState<EffectParams>(initialParams ?? DEFAULT_PARAMS);
  const historyRef = useRef<EffectParams[]>([initialParams ?? DEFAULT_PARAMS]);
  const historyIndex = useRef(0);
  const [historyVersion, setHistoryVersion] = useState(0); // triggers re-render for undo/redo button state
  const commitTimer = useRef<number | null>(null);

  // ----- Presets -----
  const [customPresets, setCustomPresets] = useState<Preset[]>([]);

  // Lock for rapid button clicks
  const startTransition = () => {
    setIsTransitioning(true);
    setTimeout(() => setIsTransitioning(false), 300);
  };

  // Cleanup timers on unmount to prevent memory leaks/stale updates
  useEffect(() => {
    return () => {
      if (commitTimer.current) window.clearTimeout(commitTimer.current);
    };
  }, []);

  // Session recovery: save active project ID to local storage
  useEffect(() => {
    if (projectId) {
      localStorage.setItem("voice-studio:active-project-id", projectId);
    }
  }, [projectId]);

  // Auto-save effects parameters to project in local storage
  const autoSaveParams = useCallback((nextParams: EffectParams) => {
    if (!projectId) return;
    try {
      const p = getProject(projectId);
      if (p) {
        p.effects = nextParams;
        p.updatedAt = Date.now();
        saveProject(p);
      }
    } catch (err) {
      console.error("Auto-save parameters failed:", err);
    }
  }, [projectId]);

  // ===== Load engine + waveform =====
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setLoadError(null);
    setCurrent(0);
    setPlaying(false);

    const engine = new AudioEngine();
    engineRef.current = engine;
    engine.onTimeUpdate = (t) => { if (!cancelled) setCurrent(t); };
    engine.onPlayingChange = (p) => { if (!cancelled) setPlaying(p); };
    engine.onEnded = () => { if (!cancelled) { setCurrent(0); setPlaying(false); } };

    engine.load(blob).then(() => {
      if (cancelled) return;
      const dur = engine.duration();
      if (dur < 0.5) {
        setLoadError("Audio clip is too short (minimum 0.5 seconds is required).");
        diagnostics.log("error", "audio", "Load aborted: Audio clip is too short (less than 0.5s)");
        return;
      }
      engine.setAll(params, true);
      engine.setPlaybackSpeed(speed);
      engine.setLoop(loop);
      engine.setVolume(muted ? 0 : volume);
      setDuration(dur);
      setReady(true);
      diagnostics.log("success", "audio", `Decoded audio buffer successfully (Duration: ${dur.toFixed(2)}s)`);
    }).catch((e) => {
      if (!cancelled) {
        setLoadError(e?.message ?? "Could not decode audio file");
        diagnostics.log("error", "audio", "Could not decode audio file", e?.message || String(e));
      }
    });

    return () => {
      cancelled = true;
      engine.dispose();
    };
  }, [blob]);

  // Visual waveform (separate from playback engine)
  useEffect(() => {
    if (!waveContainer.current) return;
    const styles = getComputedStyle(document.documentElement);
    const waveColor = styles.getPropertyValue("--waveform").trim() || "#6b7280";
    const progressColor = styles.getPropertyValue("--waveform-progress").trim() || "#f59e0b";
    const ws = WaveSurfer.create({
      container: waveContainer.current,
      waveColor, progressColor, cursorColor: progressColor,
      cursorWidth: 2, barWidth: 2, barGap: 2, barRadius: 2,
      height: 96, normalize: true, interact: true,
    });
    wsRef.current = ws;
    const url = URL.createObjectURL(blob);
    ws.load(url).catch(() => { /* engine error already shows */ });
    ws.setVolume(0); // muted — engine is the audio source
    // Click-to-seek
    ws.on("interaction", (newTime: number) => {
      engineRef.current?.seek(newTime);
    });
    return () => {
      ws.destroy();
      URL.revokeObjectURL(url);
      wsRef.current = null;
    };
  }, [blob]);

  // Sync wavesurfer cursor with engine's playback time
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    try { ws.setTime(current); } catch { /* loading */ }
  }, [current]);

  // ===== Presets list =====
  useEffect(() => {
    const refresh = () => setCustomPresets(listCustomPresets());
    refresh();
    window.addEventListener("presets:changed", refresh);
    return () => window.removeEventListener("presets:changed", refresh);
  }, []);

  // ===== Transport =====
  const toggle = () => {
    if (isTransitioning) return;
    startTransition();
    playing ? engineRef.current?.pause() : engineRef.current?.play();
  };
  const stop = () => {
    if (isTransitioning) return;
    startTransition();
    engineRef.current?.stop();
  };
  const onSeek = (v: number[]) => {
    engineRef.current?.seek(v[0] ?? 0);
  };
  const handleBypass = (b: boolean) => {
    setBypass(b);
    engineRef.current?.setBypass(b);
  };

  const handleSpeedChange = (v: string) => {
    const newSpeed = parseFloat(v);
    setSpeed(newSpeed);
    engineRef.current?.setPlaybackSpeed(newSpeed);
    toast.success(`Speed: ${newSpeed}x`);
  };

  const handleVolume = (v: number[]) => {
    const nv = (v[0] ?? 100) / 100;
    setVolume(nv);
    if (muted && nv > 0) setMuted(false);
    engineRef.current?.setVolume(nv);
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    engineRef.current?.setVolume(next ? 0 : volume);
  };

  const toggleLoop = () => {
    if (isTransitioning) return;
    startTransition();
    const next = !loop;
    setLoop(next);
    engineRef.current?.setLoop(next);
    toast.success(next ? "Looping enabled" : "Looping disabled");
  };

  const handleJump = (offset: number) => {
    if (isTransitioning) return;
    startTransition();
    engineRef.current?.jump(offset);
  };

  // ===== Param updates =====
  // While the user drags, update audio in real time but DEBOUNCE history commits.
  const commitHistory = useCallback((next: EffectParams) => {
    const stack = historyRef.current.slice(0, historyIndex.current + 1);
    stack.push(next);
    if (stack.length > HISTORY_LIMIT) stack.shift();
    historyRef.current = stack;
    historyIndex.current = stack.length - 1;
    setHistoryVersion((v) => v + 1);
    autoSaveParams(next);
  }, [autoSaveParams]);

  const updateParam = useCallback((key: keyof EffectParams, value: number) => {
    setParams((prev) => {
      if (prev[key] === value) return prev;
      const next = { ...prev, [key]: value };
      engineRef.current?.setParam(key, value);
      // Debounce history so a slider drag becomes one undo step
      if (commitTimer.current) window.clearTimeout(commitTimer.current);
      commitTimer.current = window.setTimeout(() => commitHistory(next), 400);
      return next;
    });
  }, [commitHistory]);

  const applyParams = useCallback((next: EffectParams, recordHistory = true) => {
    setParams(next);
    engineRef.current?.setAll(next);
    if (commitTimer.current) { window.clearTimeout(commitTimer.current); commitTimer.current = null; }
    if (recordHistory) commitHistory(next);
  }, [commitHistory]);

  const resetParam = useCallback((key: keyof EffectParams) => updateParam(key, DEFAULT_PARAMS[key]), [updateParam]);
  const resetAll = () => {
    if (isTransitioning) return;
    startTransition();
    applyParams(DEFAULT_PARAMS);
  };

  const canUndo = historyIndex.current > 0;
  const canRedo = historyIndex.current < historyRef.current.length - 1;
  
  const undo = useCallback(() => {
    if (!canUndo || isTransitioning) return;
    startTransition();
    historyIndex.current -= 1;
    const next = historyRef.current[historyIndex.current];
    setParams(next);
    engineRef.current?.setAll(next);
    setHistoryVersion((v) => v + 1);
    autoSaveParams(next);
    diagnostics.log("info", "state", "Undo effects parameters edit");
  }, [canUndo, isTransitioning, autoSaveParams]);

  const redo = useCallback(() => {
    if (!canRedo || isTransitioning) return;
    startTransition();
    historyIndex.current += 1;
    const next = historyRef.current[historyIndex.current];
    setParams(next);
    engineRef.current?.setAll(next);
    setHistoryVersion((v) => v + 1);
    autoSaveParams(next);
    diagnostics.log("info", "state", "Redo effects parameters edit");
  }, [canRedo, isTransitioning, autoSaveParams]);

  // Keep references fresh for shortcuts to avoid stale closures
  const toggleRef = useRef(toggle);
  const undoRef = useRef(undo);
  const redoRef = useRef(redo);
  const handleBypassRef = useRef(handleBypass);
  const toggleLoopRef = useRef(toggleLoop);
  const handleJumpRef = useRef(handleJump);
  const toggleMuteRef = useRef(toggleMute);

  useEffect(() => {
    toggleRef.current = toggle;
    undoRef.current = undo;
    redoRef.current = redo;
    handleBypassRef.current = handleBypass;
    toggleLoopRef.current = toggleLoop;
    handleJumpRef.current = handleJump;
    toggleMuteRef.current = toggleMute;
  }, [toggle, undo, redo, handleBypass, toggleLoop, handleJump, toggleMute]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const role = (e.target as HTMLElement)?.getAttribute("role");
      const isInteractive =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "BUTTON" ||
        tag === "SELECT" ||
        tag === "A" ||
        (e.target as HTMLElement)?.isContentEditable ||
        role === "button" ||
        role === "combobox" ||
        role === "slider" ||
        role === "tab" ||
        role === "option";

      if (isInteractive) {
        if (e.code === "Space" || e.code === "Enter") return;
      }
      const meta = e.metaKey || e.ctrlKey;
      
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redoRef.current();
        else undoRef.current();
        return;
      }
      if (meta && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redoRef.current();
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        toggleRef.current();
        return;
      }
      if (e.key.toLowerCase() === "b") {
        e.preventDefault();
        handleBypassRef.current(!bypass);
        return;
      }
      if (e.key.toLowerCase() === "l") {
        e.preventDefault();
        toggleLoopRef.current();
        return;
      }
      if (e.key.toLowerCase() === "m") {
        e.preventDefault();
        toggleMuteRef.current();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        handleJumpRef.current(-5);
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        handleJumpRef.current(5);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bypass]);

  // ===== Presets =====
  const applyPreset = useCallback((preset: Preset) => {
    applyParams(preset.params);
    toast.success(`Applied "${preset.name}"`);
  }, [applyParams]);

  const isDirty = useMemo(
    () => PARAM_KEYS.some((k) => params[k] !== DEFAULT_PARAMS[k]),
    [params],
  );

  // ===== Export with effects =====
  const [exporting, setExporting] = useState(false);
  
  const exportProcessed = async () => {
    const engine = engineRef.current;
    if (!engine || !engine.buffer || exporting || exportingOriginal) return;
    setExporting(true);
    diagnostics.exportCount++;
    diagnostics.log("info", "export", "Started exporting edited WAV audio");
    toast.info("Rendering edited audio... please wait.");
    try {
      const wav = await renderProcessedToWav(engine.buffer, params);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(wav);
      a.download = `${safeFileName(fileName)} - processed.wav`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast.success("Edited audio exported successfully!");
      diagnostics.log("success", "export", "Edited WAV audio exported successfully");
    } catch (e: any) {
      diagnostics.exportFailures++;
      diagnostics.log("error", "export", "Edited WAV audio export failed", e?.message || String(e));
      toast.error(e?.message ?? "Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  const exportOriginal = async () => {
    if (!ready || exporting || exportingOriginal) return;
    setExportingOriginal(true);
    diagnostics.exportCount++;
    diagnostics.log("info", "export", "Started exporting original audio file");
    toast.info("Preparing original audio export...");
    try {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const ext = blob.type.includes("wav") ? "wav" : blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
      a.download = `${safeFileName(fileName)} - original.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast.success("Original audio exported successfully!");
      diagnostics.log("success", "export", "Original audio exported successfully");
    } catch (e: any) {
      diagnostics.exportFailures++;
      diagnostics.log("error", "export", "Original audio export failed", e?.message || String(e));
      toast.error(e?.message ?? "Original export failed.");
    } finally {
      setExportingOriginal(false);
    }
  };

  // Warn if browser closes during export
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (exporting || exportingOriginal) {
        e.preventDefault();
        e.returnValue = "An export is in progress. Leaving will abort the export.";
        return e.returnValue;
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [exporting, exportingOriginal]);

  // ===== Render =====
  if (loadError) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm">
        <div className="flex items-center gap-2 font-medium text-destructive"><AlertCircle className="h-4 w-4" /> Could not load workspace</div>
        <p className="mt-2 text-muted-foreground">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      {/* ====== Left: waveform + transport + controls ====== */}
      <div className="space-y-6 min-w-0">
        <div className="rounded-xl border bg-card/60 p-4 sm:p-6 space-y-4">
          {/* A/B compare bar */}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:justify-between">
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Compare</div>
              <div className="font-display font-semibold truncate">
                {bypass ? "Original (A)" : "Modified (B)"} {!bypass && !isDirty && <span className="text-muted-foreground font-normal">· no effects</span>}
              </div>
            </div>
            <Tabs value={bypass ? "a" : "b"} onValueChange={(v) => handleBypass(v === "a")}>
              <TabsList aria-label="A/B compare">
                <TabsTrigger value="a" className="gap-1.5 px-4">A · Original</TabsTrigger>
                <TabsTrigger value="b" className="gap-1.5 px-4">B · Modified</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div ref={waveContainer} className="min-h-[96px]" aria-label="Audio waveform" />

          {/* Seek */}
          <div className="space-y-1.5">
            <Slider
              value={[current]}
              max={Math.max(0.01, duration)}
              step={0.01}
              onValueChange={onSeek}
              disabled={!ready}
              aria-label="Seek"
            />
            <div className="flex justify-between text-xs font-mono text-muted-foreground tabular-nums">
              <span>{formatDuration(current)}</span>
              <span>{formatDuration(duration)}</span>
            </div>
          </div>

          {/* Transport */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Button onClick={toggle} disabled={!ready || isTransitioning} size="lg" className="gap-2">
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {playing ? "Pause" : "Play"}
              </Button>
              <Button onClick={stop} disabled={!ready || isTransitioning} variant="secondary" size="lg" className="gap-2">
                <Square className="h-4 w-4" /> Stop
              </Button>
            </div>

            <div className="flex items-center gap-1 border-l border-r px-2 py-0.5">
              <Button
                variant="ghost"
                size="icon"
                disabled={!ready || isTransitioning}
                onClick={() => handleJump(-5)}
                title="Jump backward 5s (←)"
                aria-label="Jump backward 5s"
              >
                <SkipBack className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={!ready || isTransitioning}
                onClick={() => handleJump(5)}
                title="Jump forward 5s (→)"
                aria-label="Jump forward 5s"
              >
                <SkipForward className="h-4 w-4" />
              </Button>
              <Button
                variant={loop ? "secondary" : "ghost"}
                size="icon"
                disabled={!ready || isTransitioning}
                onClick={toggleLoop}
                title="Loop playback (L)"
                aria-label="Loop playback"
                className={cn(loop && "bg-primary/20 text-primary hover:bg-primary/30")}
              >
                <Repeat className="h-4 w-4" />
              </Button>
              <Select value={String(speed)} onValueChange={handleSpeedChange} disabled={!ready}>
                <SelectTrigger className="w-[85px] h-9 ml-1" aria-label="Playback speed">
                  <SelectValue placeholder="1.0x" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0.5">0.5x</SelectItem>
                  <SelectItem value="0.75">0.75x</SelectItem>
                  <SelectItem value="1">1.0x</SelectItem>
                  <SelectItem value="1.25">1.25x</SelectItem>
                  <SelectItem value="1.5">1.5x</SelectItem>
                  <SelectItem value="2">2.0x</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2 border-r pr-2">
              <Button
                variant="ghost"
                size="icon"
                disabled={!ready}
                onClick={toggleMute}
                title={muted ? "Unmute (M)" : "Mute (M)"}
                aria-label={muted ? "Unmute" : "Mute"}
              >
                {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </Button>
              <Slider
                value={[muted ? 0 : Math.round(volume * 100)]}
                max={100}
                step={1}
                onValueChange={handleVolume}
                disabled={!ready}
                aria-label="Output volume"
                className="w-24"
              />
            </div>

            <div className="ml-auto flex items-center gap-2 flex-1 sm:flex-initial justify-between sm:justify-start w-full sm:w-auto">
              <div className="flex items-center gap-1">
                <Button onClick={undo} disabled={!canUndo || isTransitioning} variant="ghost" size="icon" aria-label="Undo" title="Undo (⌘Z)">
                  <Undo2 className="h-4 w-4" />
                </Button>
                <Button onClick={redo} disabled={!canRedo || isTransitioning} variant="ghost" size="icon" aria-label="Redo" title="Redo (⌘⇧Z)">
                  <Redo2 className="h-4 w-4" />
                </Button>
                <Button onClick={resetAll} disabled={!isDirty || isTransitioning} variant="ghost" size="sm" className="gap-1.5">
                  <RotateCcw className="h-3.5 w-3.5" /> Reset all
                </Button>
              </div>

              <div className="flex items-center gap-2 ml-auto">
                <Button
                  onClick={exportOriginal}
                  disabled={!ready || exportingOriginal || exporting}
                  variant="outline"
                  size="sm"
                  className="gap-2"
                >
                  {exportingOriginal ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Original
                </Button>
                <Button
                  onClick={exportProcessed}
                  disabled={!ready || exporting || exportingOriginal}
                  size="sm"
                  className="gap-2 bg-gradient-to-r from-primary to-primary-foreground shadow"
                >
                  {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {exporting ? "Rendering…" : "Export"}
                </Button>
              </div>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Tips: <kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]">Space</kbd> play/pause ·
            {" "}<kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]">B</kbd> A/B compare ·
            {" "}<kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]">L</kbd> Loop ·
            {" "}<kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]">M</kbd> Mute ·
            {" "}<kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]">← / →</kbd> Jump 5s ·
            {" "}<kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]">⌘Z</kbd> undo
          </p>
        </div>

        {/* Sliders panel */}
        <div className="rounded-xl border bg-card/60 p-4 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">Voice Controls</h2>
            {bypass && <span className="text-xs text-muted-foreground">Bypass active — switch to B to hear</span>}
          </div>
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
            {PARAM_KEYS.map((key) => (
              <ParamSlider
                key={key}
                paramKey={key}
                value={params[key]}
                onChange={updateParam}
                onReset={resetParam}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ====== Right: voice match + presets ====== */}
      <PresetSidebar
        currentParams={params}
        customPresets={customPresets}
        onApply={applyPreset}
        headerSlot={
          <VoiceMatchCard
            getSourceBuffer={() => engineRef.current?.buffer ?? null}
            onApply={(p) => {
              applyParams(p);
              // Auto-preview: start playback so the match is immediately audible
              // (params only reach the live signal while audio is playing).
              if (!playing) engineRef.current?.play();
            }}
            disabled={!ready}
          />
        }
      />
    </div>
  );
}

// ---------- Slider row ----------
// Memoized so the 60fps playback-time re-renders of the parent don't re-render
// every slider — only the slider whose value actually changed updates.
const ParamSlider = memo(function ParamSlider({
  paramKey, value, onChange, onReset,
}: {
  paramKey: keyof EffectParams;
  value: number;
  onChange: (key: keyof EffectParams, value: number) => void;
  onReset: (key: keyof EffectParams) => void;
}) {
  const meta = PARAM_META[paramKey];
  const isDefault = value === DEFAULT_PARAMS[paramKey];
  const display = meta.bipolar
    ? `${value > 0 ? "+" : ""}${value}`
    : `${value}`;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <Label className="text-sm font-medium" htmlFor={`p-${paramKey}`}>{meta.label}</Label>
        <div className="flex items-center gap-2">
          <span className={cn("font-mono text-xs tabular-nums", isDefault ? "text-muted-foreground" : "text-primary")}>
            {display}{meta.unit ? "" : ""}
          </span>
          <button
            type="button"
            onClick={() => onReset(paramKey)}
            disabled={isDefault}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
            aria-label={`Reset ${meta.label}`}
            title="Reset"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        </div>
      </div>
      <Slider
        id={`p-${paramKey}`}
        value={[value]}
        min={meta.min}
        max={meta.max}
        step={1}
        onValueChange={(v) => onChange(paramKey, v[0] ?? 0)}
        aria-label={meta.label}
      />
      <p className="mt-1 text-[11px] text-muted-foreground">{meta.description}</p>
    </div>
  );
});

// ---------- Preset sidebar ----------
const PresetSidebar = memo(function PresetSidebar({
  currentParams, customPresets, onApply, headerSlot,
}: {
  currentParams: EffectParams;
  customPresets: Preset[];
  onApply: (p: Preset) => void;
  headerSlot?: React.ReactNode;
}) {
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [shareCode, setShareCode] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importCode, setImportCode] = useState("");

  const doImport = () => {
    const decoded = decodePreset(importCode.trim());
    if (!decoded) {
      toast.error("Invalid preset code. Check you copied the whole thing.");
      return;
    }
    saveCustomPreset({ id: newPresetId(), name: decoded.name, params: decoded.params });
    setImportOpen(false);
    setImportCode("");
    toast.success(`Imported "${decoded.name}"`);
  };

  const doSave = () => {
    const name = saveName.trim();
    if (!name) return;
    saveCustomPreset({ id: newPresetId(), name, params: currentParams });
    setSaveOpen(false);
    setSaveName("");
    toast.success(`Saved "${name}"`);
  };

  const doDuplicate = (preset: Preset) => {
    saveCustomPreset({ id: newPresetId(), name: `${preset.name} copy`, params: preset.params });
    toast.success("Preset duplicated");
  };

  const doDelete = (preset: Preset) => {
    deleteCustomPreset(preset.id);
    toast.success(`Deleted "${preset.name}"`);
  };

  const doRename = (preset: Preset) => {
    const next = renameValue.trim();
    if (!next) return;
    saveCustomPreset({ ...preset, name: next });
    setRenameId(null);
    toast.success("Renamed");
  };

  const doShare = (preset: Preset) => {
    const code = encodePreset(preset.name, preset.params);
    setShareCode(code);
  };

  return (
    <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
      {headerSlot}
      <div className="rounded-xl border bg-card/60 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Voice Presets
          </h3>
        </div>
        <div className="space-y-1.5">
          {BUILTIN_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onApply(preset)}
              className="flex w-full items-center justify-between rounded-lg border border-transparent bg-secondary/40 px-3 py-2 text-left text-sm transition-colors hover:border-primary/40 hover:bg-secondary"
            >
              <span className="font-medium">{preset.name}</span>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Built-in</span>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border bg-card/60 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="font-display font-semibold">My Presets</h3>
          <div className="flex items-center gap-1.5">
          <Dialog open={importOpen} onOpenChange={setImportOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="ghost" className="gap-1.5"><Import className="h-3.5 w-3.5" /> Import</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Import preset</DialogTitle>
                <DialogDescription>Paste a shared preset code to add it to your presets.</DialogDescription>
              </DialogHeader>
              <textarea
                value={importCode}
                onChange={(e) => setImportCode(e.target.value)}
                placeholder="Paste preset code here…"
                className="h-32 w-full resize-none rounded-md border bg-background p-3 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                autoFocus
              />
              <DialogFooter>
                <Button variant="ghost" onClick={() => setImportOpen(false)}>Cancel</Button>
                <Button onClick={doImport} disabled={!importCode.trim()}>Import preset</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="secondary" className="gap-1.5"><Save className="h-3.5 w-3.5" /> Save</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Save preset</DialogTitle>
                <DialogDescription>Save your current settings as a reusable preset.</DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label htmlFor="preset-name">Preset name</Label>
                <Input
                  id="preset-name"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="e.g. My Podcast Voice"
                  onKeyDown={(e) => { if (e.key === "Enter") doSave(); }}
                  autoFocus
                />
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setSaveOpen(false)}>Cancel</Button>
                <Button onClick={doSave} disabled={!saveName.trim()}>Save preset</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </div>
        </div>

        {customPresets.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No custom presets yet. Adjust the controls and save your favorite combinations.
          </p>
        ) : (
          <div className="space-y-1.5">
            {customPresets.map((preset) => (
              <div key={preset.id} className="group rounded-lg border border-transparent bg-secondary/40 px-3 py-2 hover:border-primary/40">
                {renameId === preset.id ? (
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") doRename(preset);
                        if (e.key === "Escape") setRenameId(null);
                      }}
                      autoFocus
                      className="h-8"
                    />
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => doRename(preset)} aria-label="Save name">
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setRenameId(null)} aria-label="Cancel">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onApply(preset)}
                      className="flex-1 truncate text-left text-sm font-medium"
                    >
                      {preset.name}
                    </button>
                    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <IconBtn label="Rename" onClick={() => { setRenameId(preset.id); setRenameValue(preset.name); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </IconBtn>
                      <IconBtn label="Duplicate" onClick={() => doDuplicate(preset)}>
                        <Copy className="h-3.5 w-3.5" />
                      </IconBtn>
                      <IconBtn label="Share" onClick={() => doShare(preset)}>
                        <Share2 className="h-3.5 w-3.5" />
                      </IconBtn>
                      <IconBtn label="Delete" onClick={() => doDelete(preset)} danger>
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconBtn>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!shareCode} onOpenChange={(o) => !o && setShareCode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share preset</DialogTitle>
            <DialogDescription>Copy this code and share it. Anyone can paste it to load the same settings.</DialogDescription>
          </DialogHeader>
          <textarea
            readOnly
            value={shareCode ?? ""}
            className="h-32 w-full resize-none rounded-md border bg-background p-3 font-mono text-xs"
            onFocus={(e) => e.currentTarget.select()}
          />
          <DialogFooter>
            <Button
              onClick={() => {
                if (shareCode) navigator.clipboard.writeText(shareCode).then(() => toast.success("Copied to clipboard"));
              }}
              className="gap-2"
            >
              <Copy className="h-4 w-4" /> Copy code
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
});

function IconBtn({
  children, label, onClick, danger,
}: { children: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "rounded p-1 text-muted-foreground transition-colors hover:bg-secondary",
        danger ? "hover:text-destructive" : "hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

// =========================================================
// OFFLINE RENDER for export (mirrors live engine graph)
// =========================================================
async function renderProcessedToWav(buffer: AudioBuffer, params: EffectParams): Promise<Blob> {
  const numChannels = Math.max(2, buffer.numberOfChannels);
  const ctx = new OfflineAudioContext(numChannels, Math.ceil(buffer.duration * buffer.sampleRate), buffer.sampleRate);

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.detune.value = lerp(params.pitch, -100, 100, -1200, 1200);

  const mk = (type: BiquadFilterType, f: number, gain: number, q?: number) => {
    const n = ctx.createBiquadFilter();
    n.type = type; n.frequency.value = f; n.gain.value = gain; if (q != null) n.Q.value = q;
    return n;
  };

  const bass = mk("lowshelf", 100, lerp(params.bass, -100, 100, -12, 12));
  const warmth = mk("lowshelf", 250, lerp(params.warmth, -100, 100, -6, 6));
  const depth = mk("lowshelf", 120, lerp(params.voiceDepth, 0, 100, 0, 9));
  const pres = mk("peaking", 3000, lerp(params.presence, -100, 100, -8, 8), 1);
  const clar = mk("peaking", 5000, lerp(params.clarity, -100, 100, -6, 6), 1.2);
  const treb = mk("highshelf", 6000, lerp(params.treble, -100, 100, -12, 12));
  const brig = mk("highshelf", 10000, lerp(params.brightness, -100, 100, -8, 8));

  const comp = ctx.createDynamicsCompressor();
  const amount = params.compression / 100;
  comp.threshold.value = lerp(amount, 0, 1, -10, -50);
  comp.ratio.value = lerp(amount, 0, 1, 1, 8);
  comp.knee.value = 18; comp.attack.value = 0.006; comp.release.value = 0.18;

  const conv = ctx.createConvolver();
  conv.buffer = makeImpulseFor(ctx, 2.4, 2.6);
  const wetMix = lerp(params.reverb, 0, 100, 0, 0.55);
  const dry = ctx.createGain(); dry.gain.value = 1 - wetMix * 0.6;
  const wet = ctx.createGain(); wet.gain.value = wetMix;
  const sum = ctx.createGain();

  const splitter = ctx.createChannelSplitter(2);
  const merger = ctx.createChannelMerger(2);
  const delayR = ctx.createDelay(0.05);
  delayR.delayTime.value = lerp(params.stereoWidth, 0, 100, 0, 0.028);

  src.connect(bass).connect(warmth).connect(depth).connect(pres).connect(clar).connect(treb).connect(brig).connect(comp);
  comp.connect(dry).connect(sum);
  comp.connect(conv).connect(wet).connect(sum);
  sum.connect(splitter);
  splitter.connect(merger, 0, 0);
  splitter.connect(delayR, 1, 0);
  delayR.connect(merger, 0, 1);
  merger.connect(ctx.destination);

  src.start(0);
  const rendered = await ctx.startRendering();
  return audioBufferToWav(rendered);
}

function lerp(v: number, inMin: number, inMax: number, outMin: number, outMax: number) {
  const t = (v - inMin) / (inMax - inMin);
  return outMin + t * (outMax - outMin);
}

function makeImpulseFor(ctx: BaseAudioContext, duration: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * duration));
  const ir = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
  }
  return ir;
}

function audioBufferToWav(buf: AudioBuffer): Blob {
  const numCh = buf.numberOfChannels;
  const sampleRate = buf.sampleRate;
  const len = buf.length * numCh * 2 + 44;
  const arr = new ArrayBuffer(len);
  const view = new DataView(arr);
  let pos = 0;
  const writeString = (s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(pos++, s.charCodeAt(i)); };
  const w16 = (v: number) => { view.setUint16(pos, v, true); pos += 2; };
  const w32 = (v: number) => { view.setUint32(pos, v, true); pos += 4; };
  writeString("RIFF"); w32(len - 8); writeString("WAVE");
  writeString("fmt "); w32(16); w16(1); w16(numCh);
  w32(sampleRate); w32(sampleRate * numCh * 2); w16(numCh * 2); w16(16);
  writeString("data"); w32(buf.length * numCh * 2);
  const channels: Float32Array[] = [];
  for (let i = 0; i < numCh; i++) channels.push(buf.getChannelData(i));
  for (let i = 0; i < buf.length; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      let s = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      pos += 2;
    }
  }
  return new Blob([arr], { type: "audio/wav" });
}
