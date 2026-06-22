import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FolderOpen, Mic, Trash2, Clock, FileAudio, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { listProjects, deleteProject, formatDuration, formatBytes, type Project } from "@/lib/projects";
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

  useEffect(() => {
    const load = () => { setProjects(listProjects()); setLoaded(true); };
    load();
    window.addEventListener("projects:changed", load);
    return () => window.removeEventListener("projects:changed", load);
  }, []);

  const onDelete = async (id: string, name: string) => {
    await deleteProject(id);
    toast.success(`Deleted "${name}"`);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
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

      <div className="mt-10">
        {!loaded ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-36 animate-pulse rounded-xl border bg-card/40" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} onDelete={onDelete} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectCard({ project, onDelete }: { project: Project; onDelete: (id: string, name: string) => void }) {
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
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button
            aria-label={`Delete ${project.name}`}
            className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/20 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
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
