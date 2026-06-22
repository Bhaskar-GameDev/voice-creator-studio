// Server function: pull audio from a media URL (Instagram, TikTok, YouTube, …)
// using yt-dlp, and hand it back to the browser for voice-profile analysis.
//
// Reliability note: this depends on the `yt-dlp` binary being on the host PATH.
// On hosts without it (e.g. a bare Render free Node service) the function fails
// gracefully with `ok:false` and a clear message — the client then tells the
// user to upload a file instead. yt-dlp is also inherently fragile against
// Instagram changes / login-walled content; treat the file-upload path as the
// dependable one.

import { createServerFn } from "@tanstack/react-start";

export interface ExtractResult {
  ok: boolean;
  /** base64-encoded audio bytes (no data: prefix) when ok. */
  base64?: string;
  mimeType?: string;
  title?: string;
  error?: string;
  /** True when yt-dlp itself is unavailable (vs. a per-URL failure). */
  unavailable?: boolean;
}

// Keep transfers small: reject anything over this once downloaded.
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
// yt-dlp can hang on auth walls / slow CDNs — bound it.
const TIMEOUT_MS = 45_000;
// Hosts that bundle yt-dlp at a fixed path (e.g. Render build downloads it to
// ./bin/yt-dlp) set YT_DLP_PATH. Falls back to a PATH-resolved "yt-dlp".
const YT_DLP = process.env.YT_DLP_PATH || "yt-dlp";

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export const extractAudio = createServerFn({ method: "POST" })
  .validator((url: unknown): string => {
    if (typeof url !== "string" || !url.trim()) throw new Error("A URL is required.");
    const trimmed = url.trim();
    if (!isHttpUrl(trimmed)) throw new Error("Enter a valid http(s) URL.");
    return trimmed;
  })
  .handler(async ({ data: url }): Promise<ExtractResult> => {
    // Lazy-load Node built-ins so this module stays import-safe on the client.
    const { spawn } = await import("node:child_process");
    const { mkdtemp, readdir, readFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    // Probe for yt-dlp first so we can give the "unavailable" signal cleanly.
    const hasYtDlp = await new Promise<boolean>((resolve) => {
      try {
        const probe = spawn(YT_DLP, ["--version"]);
        probe.on("error", () => resolve(false));
        probe.on("close", (code) => resolve(code === 0));
      } catch {
        resolve(false);
      }
    });
    if (!hasYtDlp) {
      return {
        ok: false,
        unavailable: true,
        error:
          "Audio extraction from links isn't available on this server (yt-dlp not installed). Please download the clip and upload the file instead.",
      };
    }

    let dir: string | undefined;
    try {
      dir = await mkdtemp(join(tmpdir(), "vs-extract-"));
      const outTpl = join(dir, "audio.%(ext)s");

      // Download the native audio stream WITHOUT post-processing so we don't
      // depend on ffmpeg being installed. The browser's decodeAudioData reads
      // m4a/webm/mp4/ogg containers directly for analysis. Prefer an m4a-only
      // audio stream, then any audio, then the full file as a last resort
      // (decodeAudioData can still pull the audio track out of an mp4 video).
      const args = [
        "--no-playlist",
        "--no-warnings",
        "-f",
        "bestaudio[ext=m4a]/bestaudio/best",
        "--max-filesize",
        String(MAX_BYTES),
        "-o",
        outTpl,
        url,
      ];

      const result = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
        const proc = spawn(YT_DLP, args);
        let stderr = "";
        const timer = setTimeout(() => {
          try {
            proc.kill("SIGKILL");
          } catch {
            /* ignore */
          }
        }, TIMEOUT_MS);
        proc.stderr.on("data", (d) => {
          stderr += String(d);
        });
        proc.on("error", (e) => {
          clearTimeout(timer);
          resolve({ code: -1, stderr: String(e) });
        });
        proc.on("close", (code) => {
          clearTimeout(timer);
          resolve({ code, stderr });
        });
      });

      if (result.code !== 0) {
        const reason = /login|private|sign in|cookies/i.test(result.stderr)
          ? "That link needs login or is private. Try a public post, or upload the file."
          : "Could not extract audio from that link. Try uploading the file instead.";
        return { ok: false, error: reason };
      }

      // Find the produced audio file
      const files = (await readdir(dir)).filter((f) => f.startsWith("audio."));
      if (!files.length) {
        return { ok: false, error: "No audio could be extracted from that link." };
      }
      const filePath = join(dir, files[0]);
      const buf = await readFile(filePath);
      if (buf.byteLength === 0) return { ok: false, error: "Extracted audio was empty." };
      if (buf.byteLength > MAX_BYTES) {
        return {
          ok: false,
          error: "Extracted audio is too large (max 25 MB). Trim the clip and upload it.",
        };
      }

      const ext = files[0].split(".").pop()?.toLowerCase();
      const mimeType =
        ext === "mp3"
          ? "audio/mpeg"
          : ext === "webm"
            ? "audio/webm"
            : ext === "ogg" || ext === "opus"
              ? "audio/ogg"
              : "audio/mp4"; // m4a / mp4 / aac

      return {
        ok: true,
        base64: buf.toString("base64"),
        mimeType,
        title: new URL(url).hostname.replace(/^www\./, ""),
      };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Extraction failed unexpectedly.",
      };
    } finally {
      if (dir) {
        try {
          await rm(dir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    }
  });
