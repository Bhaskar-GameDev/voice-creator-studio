export interface DiagnosticEvent {
  id: string;
  timestamp: number;
  type: "info" | "warning" | "error" | "success";
  category: "navigation" | "state" | "exception" | "save" | "export" | "audio" | "performance";
  message: string;
  details?: string;
}

class DiagnosticsTracker {
  private events: DiagnosticEvent[] = [];
  private listeners: (() => void)[] = [];
  public saveCount = 0;
  public saveFailures = 0;
  public exportCount = 0;
  public exportFailures = 0;

  constructor() {
    if (typeof window !== "undefined") {
      // Listen to unhandled errors
      window.addEventListener("error", (e) => {
        this.log("error", "exception", `Unhandled exception: ${e.message}`, e.error?.stack);
      });
      // Listen to unhandled promise rejections
      window.addEventListener("unhandledrejection", (e) => {
        this.log("error", "exception", `Unhandled promise rejection: ${e.reason?.message || String(e.reason)}`, e.reason?.stack);
      });
    }
  }

  public log(
    type: "info" | "warning" | "error" | "success",
    category: "navigation" | "state" | "exception" | "save" | "export" | "audio" | "performance",
    message: string,
    details?: string
  ) {
    const ev: DiagnosticEvent = {
      id: Math.random().toString(36).slice(2, 9),
      timestamp: Date.now(),
      type,
      category,
      message,
      details,
    };
    this.events.unshift(ev);
    if (this.events.length > 50) {
      this.events.pop();
    }
    this.notify();
  }

  // Counter bumps that also notify subscribers so the dashboard refreshes live.
  public recordSave(success: boolean) {
    if (success) this.saveCount++;
    else this.saveFailures++;
    this.notify();
  }

  public recordExport(success: boolean) {
    if (success) this.exportCount++;
    else this.exportFailures++;
    this.notify();
  }

  public getEvents() {
    return [...this.events];
  }

  public clear() {
    this.events = [];
    this.notify();
  }

  public subscribe(cb: () => void) {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private notify() {
    this.listeners.forEach((l) => {
      try { l(); } catch {}
    });
  }

  // Diagnostic status queries
  public async checkAudioContextState(): Promise<string> {
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return "unsupported";
      const dummy = new Ctx();
      const state = dummy.state;
      await dummy.close();
      return state;
    } catch {
      return "failed_to_initialize";
    }
  }

  public checkLocalStorageQuota(): { used: number; total: number; ratio: number } {
    let used = 0;
    try {
      for (const key in localStorage) {
        if (Object.prototype.hasOwnProperty.call(localStorage, key)) {
          used += (localStorage[key].length + key.length) * 2; // approximation in bytes (UTF-16)
        }
      }
    } catch {}
    const total = 5 * 1024 * 1024; // typical limit is 5MB
    return { used, total, ratio: used / total };
  }

  public checkActiveRecordLock(): boolean {
    const lock = localStorage.getItem("voice-studio:active-recorder-lock");
    if (!lock) return false;
    const lockTime = parseInt(lock, 10);
    return Date.now() - lockTime < 60000;
  }
}

export const diagnostics = new DiagnosticsTracker();
