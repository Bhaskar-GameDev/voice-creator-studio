import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Mic, Trash2, Save, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { EditorWorkspace } from "@/components/EditorWorkspace";
import { Recorder } from "@/components/Recorder";
import { getProject, saveProject, deleteProject, formatBytes, formatDuration, type Project } from "@/lib/projects";
import { getAudio, putAudio } from "@/lib/audio-db";
import { toast } from "sonner";

export const Route = createFileRoute("/studio/$projectId")({
  head: ({ params }) => ({
    meta: [
      { title: `Project — Voice Studio` },
      { name: "description", content: `Editing voice project ${params.projectId}.` },
    ],
  }),
  component: ProjectStudio,
});

function ProjectStudio() {
  const { projectId } = useParams({ from: "/studio/$projectId" });
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [reRecording, setReRecording] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const p = getProject(projectId);
      if (!p) { if (!cancelled) { setError("Project not found"); setLoading(false); } return; }
      try {
        const b = await getAudio(projectId);
        if (cancelled) return;
        if (!b) { setError("Audio data missing for this project"); setLoading(false); return; }
        setProject(p);
        setName(p.name);
        setBlob(b);
        setLoading(false);
      } catch (e: any) {
        if (!cancelled) { setError(e?.message ?? "Failed to load audio"); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const rename = () => {
    if (!project) return;
    const trimmed = name.trim();
    if (!trimmed) { toast.error("Name cannot be empty"); return; }
    const next = { ...project, name: trimmed, updatedAt: Date.now() };
    try {
      saveProject(next);
      setProject(next);
      toast.success("Saved");
    } catch {
      toast.error("Could not save name. Device storage may be full.");
    }
  };

  const onRemove = async () => {
    await deleteProject(projectId);
    toast.success("Project deleted");
    navigate({ to: "/" });
  };

  const onReRecorded = async (newBlob: Blob, duration: number) => {
    if (!project) return;
    try {
      await putAudio(project.id, newBlob);
      const next = { ...project, mimeType: newBlob.type, size: newBlob.size, duration, updatedAt: Date.now() };
      saveProject(next);
      setProject(next);
      setBlob(newBlob);
      setReRecording(false);
      toast.success("Recording replaced");
    } catch {
      toast.error("Could not replace recording. Device storage may be full.");
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All projects
      </Link>

      {loading ? (
        <div className="mt-8 h-64 animate-pulse rounded-xl border bg-card/40" />
      ) : error ? (
        <div className="mt-8 rounded-xl border border-destructive/40 bg-destructive/10 p-6">
          <div className="flex items-center gap-2 font-medium"><AlertCircle className="h-5 w-5 text-destructive" /> {error}</div>
          <p className="mt-2 text-sm text-muted-foreground">The project file may be corrupted or was deleted from this browser.</p>
          <div className="mt-4 flex gap-2">
            <Button asChild variant="secondary"><Link to="/">Back to projects</Link></Button>
            <Button asChild><Link to="/studio">New project</Link></Button>
          </div>
        </div>
      ) : project && blob ? (
        <>
          <div className="mt-6 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 sm:flex sm:flex-wrap sm:justify-between">
            <div className="min-w-0 flex-1 max-w-xl">
              <Label htmlFor="name" className="text-xs uppercase tracking-widest text-muted-foreground">Project name</Label>
              <div className="mt-1.5 flex gap-2">
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={rename}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  className="font-display text-lg"
                />
                <Button onClick={rename} size="icon" variant="secondary" aria-label="Save name"><Save className="h-4 w-4" /></Button>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button variant="secondary" onClick={() => setReRecording((v) => !v)} className="gap-2">
                <Mic className="h-4 w-4" /> {reRecording ? "Cancel re-record" : "Re-record"}
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Delete project" className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this project?</AlertDialogTitle>
                    <AlertDialogDescription>This will permanently remove the audio and metadata.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={onRemove}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground font-mono">
            <span>Duration: {formatDuration(project.duration)}</span>
            <span>Size: {formatBytes(project.size)}</span>
            <span>Type: {project.mimeType || "audio"}</span>
            <span>Source: {project.source}</span>
          </div>

          <div className="mt-6">
            <EditorWorkspace
              key={project.id}
              blob={blob}
              fileName={project.name}
              projectId={project.id}
              initialParams={project.effects}
            />
          </div>

          {reRecording ? (
            <div className="mt-6">
              <h2 className="font-display text-lg font-semibold mb-3">Re-record</h2>
              <Recorder onComplete={onReRecorded} />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
