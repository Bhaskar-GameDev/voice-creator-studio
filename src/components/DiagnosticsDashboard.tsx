import { useState, useEffect } from "react";
import {
  Activity, X, AlertCircle, CheckCircle2, ShieldAlert,
  Database, RefreshCw, Trash2, HeartPulse, Clock, Play
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { diagnostics, type DiagnosticEvent } from "@/lib/diagnostics";
import { listProjects } from "@/lib/projects";

export function DiagnosticsDashboard() {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<DiagnosticEvent[]>([]);
  const [audioState, setAudioState] = useState<string>("unknown");
  const [storage, setStorage] = useState({ used: 0, total: 0, ratio: 0 });
  const [activeLock, setActiveLock] = useState(false);
  const [tab, setTab] = useState<"logs" | "metrics" | "tests">("logs");
  const [projectCount, setProjectCount] = useState(0);

  useEffect(() => {
    // Sync initial state
    setEvents(diagnostics.getEvents());
    setStorage(diagnostics.checkLocalStorageQuota());
    setActiveLock(diagnostics.checkActiveRecordLock());
    try {
      setProjectCount(listProjects().length);
    } catch {}

    diagnostics.checkAudioContextState().then(setAudioState);

    // Subscribe to updates
    const unsubscribe = diagnostics.subscribe(() => {
      setEvents(diagnostics.getEvents());
      setStorage(diagnostics.checkLocalStorageQuota());
      setActiveLock(diagnostics.checkActiveRecordLock());
      try {
        setProjectCount(listProjects().length);
      } catch {}
    });

    return unsubscribe;
  }, []);

  const triggerMockError = () => {
    diagnostics.log("error", "exception", "QA simulated unhandled exception", "Stack trace simulation: Error at DiagnosticsDashboard.tsx:34:10");
  };

  const simulateFailedSave = () => {
    diagnostics.saveFailures++;
    diagnostics.log("error", "save", "Save project metadata failed: localStorage quota exceeded");
  };

  const simulateFailedExport = () => {
    diagnostics.exportFailures++;
    diagnostics.log("error", "export", "Render task aborted: AudioBuffer source depleted");
  };

  const clearLocks = () => {
    localStorage.removeItem("voice-studio:active-recorder-lock");
    diagnostics.log("success", "state", "Cleared multi-tab recorder locks");
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = 2;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-4 right-4 z-50 flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:scale-105 transition-all focus:outline-none focus:ring-2 focus:ring-ring"
        aria-label="Toggle diagnostics dashboard"
        title="App Diagnostics & QA Audit"
      >
        <Activity className="h-5 w-5 animate-pulse" />
      </button>

      {/* Slide-out Dashboard */}
      {open && (
        <div className="fixed bottom-16 right-4 z-50 w-full max-w-md rounded-2xl border border-border/40 bg-card/95 p-5 shadow-2xl backdrop-blur-md animate-in slide-in-from-bottom-5 duration-200 flex flex-col max-h-[550px] overflow-hidden">
          <div className="flex items-center justify-between border-b pb-3 mb-3">
            <div className="flex items-center gap-2">
              <HeartPulse className="h-5 w-5 text-primary" />
              <div>
                <h3 className="font-display font-semibold text-sm">System Diagnostics</h3>
                <p className="text-[10px] text-muted-foreground">QA Real-time Application Inspector</p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="rounded p-1 hover:bg-secondary text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Navigation Tabs */}
          <div className="flex gap-1.5 border-b pb-2 mb-3">
            <Button
              variant={tab === "logs" ? "default" : "ghost"}
              size="xs"
              onClick={() => setTab("logs")}
              className="text-xs py-1 px-3 h-7"
            >
              Event Logs ({events.length})
            </Button>
            <Button
              variant={tab === "metrics" ? "default" : "ghost"}
              size="xs"
              onClick={() => setTab("metrics")}
              className="text-xs py-1 px-3 h-7"
            >
              Health Metrics
            </Button>
            <Button
              variant={tab === "tests" ? "default" : "ghost"}
              size="xs"
              onClick={() => setTab("tests")}
              className="text-xs py-1 px-3 h-7"
            >
              QA Test Controls
            </Button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto pr-1 text-xs space-y-3">
            {tab === "logs" && (
              <div className="space-y-2">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[10px] text-muted-foreground font-mono">Console & State Logs</span>
                  <button
                    onClick={() => diagnostics.clear()}
                    className="flex items-center gap-1 text-[10px] text-destructive hover:underline"
                  >
                    <Trash2 className="h-3 w-3" /> Clear logs
                  </button>
                </div>
                {events.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground font-mono text-[11px]">
                    No diagnostic events logged yet.
                  </div>
                ) : (
                  <div className="space-y-1.5 font-mono max-h-[350px] overflow-y-auto">
                    {events.map((e) => (
                      <div
                        key={e.id}
                        className="p-2 rounded bg-secondary/40 border border-border/20 text-[11px] leading-relaxed"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                            e.type === "error" ? "bg-destructive/20 text-destructive" :
                            e.type === "warning" ? "bg-amber-500/20 text-amber-500" :
                            e.type === "success" ? "bg-emerald-500/20 text-emerald-500" :
                            "bg-primary/20 text-primary"
                          }`}>
                            {e.type}
                          </span>
                          <span className="text-[9px] text-muted-foreground">
                            {new Date(e.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="font-semibold text-foreground">{e.message}</p>
                        {e.details && (
                          <pre className="mt-1 p-1 bg-background/50 rounded text-[9px] text-muted-foreground overflow-x-auto max-w-full">
                            {e.details}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === "metrics" && (
              <div className="space-y-4">
                {/* Audio Engine */}
                <div>
                  <h4 className="font-display font-medium text-xs flex items-center gap-1.5 text-primary mb-2">
                    <Activity className="h-3.5 w-3.5" /> Audio Engine Context
                  </h4>
                  <div className="grid grid-cols-2 gap-2 bg-secondary/30 p-2.5 rounded-lg border">
                    <div>
                      <span className="text-[10px] text-muted-foreground block">AudioContext state</span>
                      <span className="font-semibold capitalize font-mono text-xs">{audioState}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground block">Simultaneous recording lock</span>
                      <span className={`font-semibold font-mono text-xs ${activeLock ? "text-destructive" : "text-emerald-500"}`}>
                        {activeLock ? "Active Lock" : "Unlocked (Available)"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Storage Health */}
                <div>
                  <h4 className="font-display font-medium text-xs flex items-center gap-1.5 text-primary mb-2">
                    <Database className="h-3.5 w-3.5" /> Storage Health
                  </h4>
                  <div className="grid grid-cols-2 gap-2 bg-secondary/30 p-2.5 rounded-lg border">
                    <div>
                      <span className="text-[10px] text-muted-foreground block">LocalStorage usage</span>
                      <span className="font-semibold font-mono text-xs">{formatBytes(storage.used)} / 5 MB</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground block">Total projects stored</span>
                      <span className="font-semibold font-mono text-xs">{projectCount} projects</span>
                    </div>
                  </div>
                </div>

                {/* Event Totals */}
                <div>
                  <h4 className="font-display font-medium text-xs flex items-center gap-1.5 text-primary mb-2">
                    <ShieldAlert className="h-3.5 w-3.5" /> Event Audit Counters
                  </h4>
                  <div className="grid grid-cols-2 gap-2 bg-secondary/30 p-2.5 rounded-lg border">
                    <div>
                      <span className="text-[10px] text-muted-foreground block">Metadata saves</span>
                      <span className="font-semibold font-mono text-xs text-emerald-500">{diagnostics.saveCount} successful</span>
                      {diagnostics.saveFailures > 0 && (
                        <span className="text-[10px] text-destructive block">{diagnostics.saveFailures} failed</span>
                      )}
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground block">Audio exports</span>
                      <span className="font-semibold font-mono text-xs text-emerald-500">{diagnostics.exportCount} initiated</span>
                      {diagnostics.exportFailures > 0 && (
                        <span className="text-[10px] text-destructive block">{diagnostics.exportFailures} failed</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {tab === "tests" && (
              <div className="space-y-3">
                <p className="text-[11px] text-muted-foreground leading-normal">
                  Inject mock conditions, simulate boundary cases, or clear locks to test the application's self-healing and recovery algorithms.
                </p>

                <div className="flex flex-col gap-2 pt-2">
                  <Button
                    variant="outline"
                    onClick={triggerMockError}
                    className="w-full justify-start text-[11px] h-8 gap-2 hover:bg-destructive/10 hover:text-destructive"
                  >
                    <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                    Log Simulated Unhandled Exception
                  </Button>

                  <Button
                    variant="outline"
                    onClick={simulateFailedSave}
                    className="w-full justify-start text-[11px] h-8 gap-2 hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Database className="h-3.5 w-3.5 text-destructive" />
                    Simulate Failed Save (Quota Limit)
                  </Button>

                  <Button
                    variant="outline"
                    onClick={simulateFailedExport}
                    className="w-full justify-start text-[11px] h-8 gap-2 hover:bg-destructive/10 hover:text-destructive"
                  >
                    <RefreshCw className="h-3.5 w-3.5 text-destructive" />
                    Simulate Failed Export (Render Failure)
                  </Button>

                  <Button
                    variant="outline"
                    onClick={clearLocks}
                    className="w-full justify-start text-[11px] h-8 gap-2 hover:bg-emerald-500/10 hover:text-emerald-500"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    Clear Active Multi-Tab Locks
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
