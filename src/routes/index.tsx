import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { FolderOpen, Mic, Trash2, Clock, FileAudio, Plus, Search, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { listProjects, deleteProject, duplicateProject, formatDuration, formatBytes, type Project } from "@/lib/projects";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Projects — Voice Studio" },
      { name: "description", content: "Your saved voice recording projects." },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const load = () => {
      const list = listProjects();
      setProjects(list);
      setLoaded(true);

      const id = localStorage.getItem("voice-studio:active-project-id");
      if (id && list.some((p) => p.id === id)) {
        setActiveProjectId(id);
      } else {
        setActiveProjectId(null);
      }
    };
    load();
    window.addEventListener("projects:changed", load);
    return () => window.removeEventListener("projects:changed", load);
  }, []);

  const onDelete = async (id: string, name: string) => {
    await deleteProject(id);
    if (activeProjectId === id) {
      localStorage.removeItem("voice-studio:active-project-id");
      setActiveProjectId(null);
    }
    toast.success(`Deleted "${name}"`);
  };

  const onDuplicate = async (id: string) => {
    try {
      const copy = await duplicateProject(id);
      if (copy) toast.success(`Duplicated as "${copy.name}"`);
      else toast.error("Could not duplicate project.");
    } catch {
      toast.error("Could not duplicate. Device storage may be full.");
    }
  };

  const activeProject = useMemo(() => {
    return projects.find((p) => p.id === activeProjectId) ?? null;
  }, [projects, activeProjectId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects;
  }, [projects, query]);

  const dismissSession = () => {
    localStorage.removeItem("voice-studio:active-project-id");
    setActiveProjectId(null);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
      {activeProject && (
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-primary/30 bg-primary/5 p-4 sm:p-5 backdrop-blur-md animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <div className="font-semibold text-sm">Resume your last session</div>
              <p className="text-xs text-muted-foreground mt-0.5">
                You were recently working on "{activeProject.name}" (modified {new Date(activeProject.updatedAt).toLocaleDateString()}).
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild size="sm" className="gap-1.5 shadow-sm">
              <Link to="/studio/$projectId" params={{ projectId: activeProject.id }}>
                Resume Editing
              </Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={dismissSession} className="text-muted-foreground hover:text-foreground">
              Dismiss
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 sm:flex sm:flex-wrap sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-bold sm:text-4xl">Your projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Record, edit, and export voice projects. Everything stays on your device.
          </p>
        </div>
        <Button onClick={() => navigate({ to: "/studio" })} size="lg" className="gap-2 shrink-0">
          <Plus className="h-4 w-4" /> New project
        </Button>
      </div>

      {loaded && projects.length > 0 && (
        <div className="mt-8 relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects…"
            aria-label="Search projects"
            className="pl-9"
          />
        </div>
      )}

      <div className="mt-6">
        {!loaded ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-36 animate-pulse rounded-xl border bg-card/40" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <EmptyState />
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-card/30 p-12 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-secondary text-muted-foreground">
              <Search className="h-6 w-6" />
            </div>
            <h2 className="mt-4 font-display text-lg font-semibold">No matches</h2>
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
              No projects match "{query}". Try a different search.
            </p>
            <Button variant="secondary" size="sm" className="mt-4" onClick={() => setQuery("")}>Clear search</Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((p) => (
              <ProjectCard key={p.id} project={p} onDelete={onDelete} onDuplicate={onDuplicate} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectCard({ project, onDelete, onDuplicate }: { project: Project; onDelete: (id: string, name: string) => void; onDuplicate: (id: string) => void }) {
  return (
    <div className="group relative rounded-xl border bg-card/60 p-5 transition-colors hover:border-primary/40 hover:bg-card">
      <Link to="/studio/$projectId" params={{ projectId: project.id }} className="block space-y-3">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-secondary text-primary">
            {project.source === "recording" ? <Mic className="h-4 w-4" /> : <FileAudio className="h-4 w-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-display font-semibold">{project.name}</div>
            <div className="text-xs text-muted-foreground">
              {new Date(project.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground font-mono tabular-nums">
          <span className="inline-flex items-center gap-1.5"><Clock className="h-3 w-3" /> {formatDuration(project.duration)}</span>
          <span>{formatBytes(project.size)}</span>
        </div>
      </Link>
      <div className="absolute right-3 top-3 flex items-center gap-1 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 opacity-100">
      <button
        type="button"
        aria-label={`Duplicate ${project.name}`}
        title="Duplicate"
        onClick={() => onDuplicate(project.id)}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <Copy className="h-4 w-4" />
      </button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button
            aria-label={`Delete ${project.name}`}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              "{project.name}" will be permanently removed. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => onDelete(project.id, project.name)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed bg-card/30 p-12 text-center">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-secondary text-primary">
        <FolderOpen className="h-7 w-7" />
      </div>
      <h2 className="mt-5 font-display text-xl font-semibold">No projects yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Start by recording your voice or uploading an audio file. Your projects will appear here.
      </p>
      <div className="mt-6">
        <Button asChild size="lg" className="gap-2">
          <Link to="/studio"><Mic className="h-4 w-4" /> Start a recording</Link>
        </Button>
      </div>
    </div>
  );
}
