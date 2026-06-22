import { deleteAudio } from "./audio-db";

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  duration: number; // seconds
  mimeType: string;
  size: number; // bytes
  source: "recording" | "upload";
}

const KEY = "voice-studio:projects";

export function listProjects(): Project[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as Project[]).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function getProject(id: string): Project | null {
  return listProjects().find((p) => p.id === id) ?? null;
}

export function saveProject(p: Project): void {
  const all = listProjects().filter((x) => x.id !== p.id);
  all.push(p);
  localStorage.setItem(KEY, JSON.stringify(all));
  window.dispatchEvent(new CustomEvent("projects:changed"));
}

export async function deleteProject(id: string): Promise<void> {
  const all = listProjects().filter((x) => x.id !== id);
  localStorage.setItem(KEY, JSON.stringify(all));
  try {
    await deleteAudio(id);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("projects:changed"));
}

export function newId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function formatDuration(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}
