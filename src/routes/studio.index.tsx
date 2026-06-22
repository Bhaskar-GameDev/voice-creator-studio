import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Mic, Upload } from "lucide-react";
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
      toast.error(e?.message ?? "Could not save project");
    } finally {
      setBusy(false);
    }
  };

  const onRecording = async (blob: Blob, duration: number) => {
    const name = `Recording ${new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;
    await createFromBlob(blob, name, duration, "recording");
  };

  const onUpload = async (file: File) => {
    const duration = await readDuration(file).catch(() => 0);
    await createFromBlob(file, file.name.replace(/\.[^.]+$/, ""), duration, "upload");
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
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

      {busy ? <div className="mt-6 text-sm text-muted-foreground">Saving project…</div> : null}
    </div>
  );
}

function readDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = "metadata";
    audio.src = url;
    audio.onloadedmetadata = () => {
      const d = audio.duration;
      URL.revokeObjectURL(url);
      resolve(isFinite(d) ? d : 0);
    };
    audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to read audio")); };
  });
}
