import { z } from "zod";

/** A user-provided public video reference. It is metadata only; it never replaces source audio. */
export const youtubeIdPattern = /^[A-Za-z0-9_-]{11}$/;

export const ReferenceVideoSchema = z
  .object({
    youtubeId: z.string().regex(youtubeIdPattern),
    offsetSeconds: z.number().finite().min(-86400).max(86400),
  })
  .strict();

export type ReferenceVideo = z.infer<typeof ReferenceVideoSchema>;

const youtubeHosts = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
]);

function validId(value: string | null | undefined): string | null {
  return value && youtubeIdPattern.test(value) ? value : null;
}

/**
 * Extract a video id from a URL without accepting arbitrary embed hosts or URLs.
 * Only explicit HTTPS YouTube links are accepted.
 */
export function parseVideoUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      !youtubeHosts.has(url.hostname.toLowerCase())
    )
      return null;
    if (url.hostname.toLowerCase() === "youtu.be") {
      const path = url.pathname.split("/").filter(Boolean);
      return path.length === 1 ? validId(path[0]) : null;
    }
    const path = url.pathname.split("/").filter(Boolean);
    if (path.length === 1 && path[0] === "watch")
      return validId(url.searchParams.get("v"));
    if (path[0] === "embed" || path[0] === "shorts" || path[0] === "live")
      return validId(path[1]);
    return null;
  } catch {
    return null;
  }
}

/** Extract the id in a filename such as "Episode [yslXlV2BP_Y].mp3". */
export function suggestVideoId(audioName?: string): string | null {
  if (!audioName) return null;
  return validId(audioName.match(/\[([A-Za-z0-9_-]{11})\]/)?.[1]);
}

export function buildYouTubeUrl(videoId: string, startSeconds?: number): string {
  const id = validId(videoId);
  if (!id) throw new Error("Invalid YouTube video id");
  const url = new URL("https://www.youtube.com/watch");
  url.searchParams.set("v", id);
  if (Number.isFinite(startSeconds) && (startSeconds ?? 0) > 0)
    url.searchParams.set("t", `${Math.max(0, Math.floor(startSeconds!))}s`);
  return url.toString();
}

export function buildYouTubeEmbedUrl(
  videoId: string,
  range?: { start: number; end: number } | null,
): string {
  const id = validId(videoId);
  if (!id) throw new Error("Invalid YouTube video id");
  const url = new URL(`https://www.youtube-nocookie.com/embed/${id}`);
  if (range) {
    if (
      !Number.isFinite(range.start) ||
      !Number.isFinite(range.end) ||
      range.end <= 0 ||
      range.end <= range.start
    )
      throw new Error("Reference range ends before the video start");
    const start = Math.max(0, Math.floor(range.start));
    const end = Math.ceil(range.end);
    if (end <= start) throw new Error("Reference range is too short");
    url.searchParams.set("start", String(start));
    url.searchParams.set("end", String(end));
  }
  return url.toString();
}

export function makeReferenceVideo(
  videoId: string,
  offsetSeconds: number,
): ReferenceVideo | null {
  const parsed = ReferenceVideoSchema.safeParse({ youtubeId: videoId, offsetSeconds });
  return parsed.success ? parsed.data : null;
}
