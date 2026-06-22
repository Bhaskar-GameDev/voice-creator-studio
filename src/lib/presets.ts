import type { EffectParams } from "./audio-engine";
import { DEFAULT_PARAMS } from "./audio-engine";

export interface Preset {
  id: string;
  name: string;
  builtIn?: boolean;
  params: EffectParams;
}

const p = (overrides: Partial<EffectParams>): EffectParams => ({ ...DEFAULT_PARAMS, ...overrides });

export const BUILTIN_PRESETS: Preset[] = [
  { id: "bi:natural",     name: "Natural Voice",      builtIn: true, params: p({}) },
  { id: "bi:podcast",     name: "Podcast",            builtIn: true,
    params: p({ warmth: 25, presence: 30, clarity: 20, compression: 55, brightness: 10, voiceDepth: 15 }) },
  { id: "bi:deep",        name: "Deep Narrator",      builtIn: true,
    params: p({ pitch: -28, bass: 40, warmth: 40, voiceDepth: 70, treble: -10, compression: 40 }) },
  { id: "bi:radio",       name: "Radio Host",         builtIn: true,
    params: p({ presence: 55, clarity: 40, compression: 80, brightness: 25, bass: 20, warmth: 15 }) },
  { id: "bi:doc",         name: "Documentary",        builtIn: true,
    params: p({ pitch: -10, warmth: 45, voiceDepth: 40, presence: 20, reverb: 25, compression: 50 }) },
  { id: "bi:storyteller", name: "Warm Storyteller",   builtIn: true,
    params: p({ warmth: 55, voiceDepth: 30, presence: 15, brightness: -15, reverb: 15, compression: 35 }) },
  { id: "bi:bright",      name: "Bright Creator",     builtIn: true,
    params: p({ brightness: 60, treble: 35, presence: 35, clarity: 30, compression: 45 }) },
  { id: "bi:energetic",   name: "Energetic Speaker",  builtIn: true,
    params: p({ pitch: 10, presence: 45, clarity: 50, brightness: 40, compression: 70, stereoWidth: 30 }) },
];

const KEY = "voice-studio:presets";

export function listCustomPresets(): Preset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Preset[];
  } catch { return []; }
}

export function listAllPresets(): Preset[] {
  return [...BUILTIN_PRESETS, ...listCustomPresets()];
}

export function saveCustomPreset(preset: Preset): void {
  const all = listCustomPresets().filter((p) => p.id !== preset.id);
  all.push(preset);
  localStorage.setItem(KEY, JSON.stringify(all));
  window.dispatchEvent(new CustomEvent("presets:changed"));
}

export function deleteCustomPreset(id: string): void {
  const all = listCustomPresets().filter((p) => p.id !== id);
  localStorage.setItem(KEY, JSON.stringify(all));
  window.dispatchEvent(new CustomEvent("presets:changed"));
}

export function newPresetId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

// Compact base64url share encoding
export function encodePreset(name: string, params: EffectParams): string {
  const payload = { n: name, p: params };
  const json = JSON.stringify(payload);
  const b64 = typeof window !== "undefined"
    ? btoa(unescape(encodeURIComponent(json)))
    : Buffer.from(json).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodePreset(code: string): { name: string; params: EffectParams } | null {
  try {
    const b64 = code.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(escape(atob(b64)));
    const obj = JSON.parse(json);
    if (!obj?.p) return null;
    return { name: obj.n ?? "Imported preset", params: { ...DEFAULT_PARAMS, ...obj.p } };
  } catch { return null; }
}
