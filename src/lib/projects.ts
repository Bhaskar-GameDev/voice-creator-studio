import { deleteAudio, getAudio, putAudio } from "./audio-db";
import { diagnostics } from "./diagnostics";

import { type EffectParams } from "./audio-engine";

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  duration: number; // seconds
  mimeType: string;
  size: number; // bytes
  source: "recording" | "upload";
  effects?: EffectParams;
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
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch (e: any) {
    diagnostics.recordSave(false);
    const quota = e?.name === "QuotaExceededError" || /quota/i.test(e?.message ?? "");
    diagnostics.log(
      "error",
      "save",
      quota ? "Save failed: localStorage quota exceeded" : "Save project metadata failed",
      e?.message || String(e),
    );
    throw e;
  }
  diagnostics.recordSave(true);
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

export async function duplicateProject(id: string): Promise<Project | null> {
  const p = getProject(id);
  if (!p) return null;
  const blob = await getAudio(id);
  if (!blob) return null;
  const copy: Project = {
    ...p,
    id: newId(),
    name: `${p.name} (copy)`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await putAudio(copy.id, blob);
  saveProject(copy); // may throw on quota — caller handles
  return copy;
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
