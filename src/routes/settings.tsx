import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Mic, HardDrive, Trash2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listProjects, deleteProject, formatBytes } from "@/lib/projects";
import { toast } from "sonner";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Voice Studio" },
      { name: "description", content: "Configure Voice Studio preferences, microphone, and storage." },
    ],
  }),
  component: Settings,
});

const PREFS_KEY = "voice-studio:prefs";
type Prefs = { defaultMic: string; autoSave: boolean; quality: "standard" | "high" };
const DEFAULT_PREFS: Prefs = { defaultMic: "", autoSave: true, quality: "high" };

function loadPrefs(): Prefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") }; }
  catch { return DEFAULT_PREFS; }
}

function Settings() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [permission, setPermission] = useState<"granted" | "denied" | "prompt" | "unknown">("unknown");
  const [stats, setStats] = useState({ count: 0, size: 0 });

  useEffect(() => {
    setPrefs(loadPrefs());
    const refreshStats = () => {
      const list = listProjects();
      setStats({ count: list.length, size: list.reduce((s, p) => s + p.size, 0) });
    };
    refreshStats();
    window.addEventListener("projects:changed", refreshStats);

    (async () => {
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        setDevices(list.filter((d) => d.kind === "audioinput"));
      } catch { /* ignore */ }
      try {
        // @ts-expect-error - microphone permission
        const status = await navigator.permissions?.query({ name: "microphone" });
        if (status) {
          setPermission(status.state as any);
          status.onchange = () => setPermission(status.state as any);
        }
      } catch { /* ignore */ }
    })();

    return () => window.removeEventListener("projects:changed", refreshStats);
  }, []);

  const update = (next: Partial<Prefs>) => {
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    localStorage.setItem(PREFS_KEY, JSON.stringify(merged));
  };

  const requestMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === "audioinput"));
      setPermission("granted");
      toast.success("Microphone access granted");
    } catch {
      setPermission("denied");
      toast.error("Microphone access denied");
    }
  };

  const clearAll = async () => {
    const all = listProjects();
    for (const p of all) await deleteProject(p.id);
    toast.success("All projects deleted");
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14 space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold sm:text-4xl">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Configure your studio. Preferences are saved on this device.</p>
      </div>

      <Section title="Microphone" icon={Mic}>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Permission status</div>
              <div className="text-xs text-muted-foreground capitalize">{permission}</div>
            </div>
            {permission !== "granted" ? (
              <Button onClick={requestMic} variant="secondary" size="sm">Request access</Button>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs text-success"><ShieldCheck className="h-3.5 w-3.5" /> Granted</span>
            )}
          </div>
          <div>
            <Label className="text-xs uppercase tracking-widest text-muted-foreground">Default microphone</Label>
            <div className="mt-1.5">
              <Select value={prefs.defaultMic} onValueChange={(v) => update({ defaultMic: v })}>
                <SelectTrigger><SelectValue placeholder="System default" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">System default</SelectItem>
                  {devices.map((d) => (
                    <SelectItem key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${d.deviceId.slice(0, 6)}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-widest text-muted-foreground">Recording quality</Label>
            <div className="mt-1.5">
              <Select value={prefs.quality} onValueChange={(v) => update({ quality: v as Prefs["quality"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard (smaller files)</SelectItem>
                  <SelectItem value="high">High quality</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Workspace" icon={ShieldCheck}>
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="autosave" className="text-sm font-medium">Auto-save projects</Label>
            <p className="text-xs text-muted-foreground">Persist recordings to your device automatically.</p>
          </div>
          <Switch id="autosave" checked={prefs.autoSave} onCheckedChange={(v) => update({ autoSave: v })} />
        </div>
      </Section>

      <Section title="Storage" icon={HardDrive}>
        <div className="grid grid-cols-2 gap-4 text-center">
          <Stat label="Projects" value={String(stats.count)} />
          <Stat label="Total size" value={formatBytes(stats.size)} />
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          All audio is stored locally in your browser using IndexedDB. Clearing browser data will remove projects.
        </p>
        <Button onClick={clearAll} variant="destructive" size="sm" className="mt-4 gap-2" disabled={stats.count === 0}>
          <Trash2 className="h-4 w-4" /> Delete all projects
        </Button>
      </Section>
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card/60 p-6">
      <div className="mb-4 flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h2 className="font-display text-lg font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-secondary/60 p-4">
      <div className="font-display text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  );
}
