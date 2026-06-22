import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Mic, Upload, Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Recorder } from "@/components/Recorder";
import { UploadDropzone } from "@/components/UploadDropzone";
import { newId, saveProject } from "@/lib/projects";
import { putAudio } from "@/lib/audio-db";
import { toast } from "sonner";

export const Route = createFileRoute("/studio/")({
  head: () => ({
    meta: [
      { title: "New Project — Voice Studio" },
      { name: "description", content: "Record or upload a new audio project." },
    ],
  }),
  component: NewStudio,
});

function NewStudio() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  // Prevent browser close/reload during active project save/import
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (busy) {
        e.preventDefault();
        e.returnValue = "Saving project in progress. Leaving now might corrupt the project storage.";
        return e.returnValue;
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [busy]);

  const createFromBlob = async (blob: Blob, name: string, duration: number, source: "recording" | "upload") => {
    setBusy(true);
    try {
      const id = newId();
      await putAudio(id, blob);
      saveProject({
        id,
        name,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        duration,
        mimeType: blob.type,
        size: blob.size,
        source,
      });
      toast.success("Project saved");
      navigate({ to: "/studio/$projectId", params: { projectId: id } });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save project. Storage might be full.");
    } finally {
      setBusy(false);
    }
  };

  const onRecording = async (blob: Blob, duration: number) => {
    const name = `Recording ${new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;
    await createFromBlob(blob, name, duration, "recording");
  };

  const onUpload = async (file: File) => {
    try {
      const duration = await readDuration(file);
      if (duration < 0.5) {
        toast.error("Audio file is too short (minimum 0.5 seconds is required).");
        return;
      }
      await createFromBlob(file, file.name.replace(/\.[^.]+$/, ""), duration, "upload");
    } catch (e: any) {
      toast.error("The audio file format is unsupported or corrupted. Please upload a valid audio file (e.g. WAV, MP3, M4A, OGG).");
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14 relative">
      {busy && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="rounded-xl border bg-card p-6 shadow-xl flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <div className="font-semibold text-sm">Saving project...</div>
            <div className="text-xs text-muted-foreground">Please do not refresh or close the page.</div>
          </div>
        </div>
      )}

      <div className="space-y-1">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">New project</h1>
        <p className="text-sm text-muted-foreground">Record from your microphone or upload an audio file to get started.</p>
      </div>

      <div className="mt-8">
        <Tabs defaultValue="record" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="record" className="gap-2"><Mic className="h-4 w-4" /> Record</TabsTrigger>
            <TabsTrigger value="upload" className="gap-2"><Upload className="h-4 w-4" /> Upload</TabsTrigger>
          </TabsList>
          <TabsContent value="record" className="mt-6">
            <Recorder onComplete={onRecording} />
          </TabsContent>
          <TabsContent value="upload" className="mt-6">
            <UploadDropzone onFile={onUpload} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function readDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = "metadata";
    let settled = false;
    const cleanup = () => { URL.revokeObjectURL(url); window.clearTimeout(timer); };
    // Guard against files whose metadata never loads (corrupt headers, unsupported codec)
    // so the upload flow can't hang indefinitely with no feedback.
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Timed out reading audio metadata"));
    }, 15000);
    audio.onloadedmetadata = () => {
      if (settled) return;
      settled = true;
      const d = audio.duration;
      cleanup();
      resolve(isFinite(d) ? d : 0);
    };
    audio.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Failed to read audio"));
    };
    audio.src = url;
  });
}
