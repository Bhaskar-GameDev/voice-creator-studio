import { useRef, useState, type DragEvent } from "react";
import { UploadCloud, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  onFile: (file: File) => void;
}

const ACCEPT = "audio/*";
const MAX_BYTES = 100 * 1024 * 1024; // 100 MB

export function UploadDropzone({ onFile }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handle = (file: File | null | undefined) => {
    setError(null);
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      setError(`Unsupported format: ${file.type || file.name}. Please upload an audio file.`);
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 100 MB.`);
      return;
    }
    if (file.size === 0) {
      setError("File is empty or corrupted.");
      return;
    }
    onFile(file);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    handle(e.dataTransfer.files?.[0]);
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          "w-full rounded-xl border-2 border-dashed p-8 transition-all text-left",
          "hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          over ? "border-primary bg-primary/10" : "border-border bg-card/40",
        )}
      >
        <div className="flex items-center gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
            <UploadCloud className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <div className="font-display font-semibold">Drop an audio file here</div>
            <div className="text-sm text-muted-foreground">
              or click to browse · MP3, WAV, M4A, OGG, WebM up to 100 MB
            </div>
          </div>
        </div>
      </button>
      <input
        ref={ref}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => handle(e.target.files?.[0])}
      />
      {error ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  );
}
