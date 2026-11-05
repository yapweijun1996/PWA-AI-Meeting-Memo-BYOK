import { describe, expect, it } from "vitest";
import {
  buildYouTubeEmbedUrl,
  buildYouTubeUrl,
  parseVideoUrl,
  ReferenceVideoSchema,
  suggestVideoId,
} from "../src/domain/reference-video";

const videoId = "yslXlV2BP_Y";

describe("reference video boundaries", () => {
  it("accepts only explicit HTTPS YouTube URLs", () => {
    expect(parseVideoUrl(`https://www.youtube.com/watch?v=${videoId}`)).toBe(videoId);
    expect(parseVideoUrl(`https://youtu.be/${videoId}?t=30`)).toBe(videoId);
    expect(parseVideoUrl(`https://www.youtube.com/embed/${videoId}`)).toBe(videoId);
    expect(parseVideoUrl(`https://www.youtube.com/shorts/${videoId}`)).toBe(videoId);
    expect(parseVideoUrl(`https://www.youtube.com/watch/extra?v=${videoId}`)).toBeNull();
    expect(parseVideoUrl(`https://user:pass@www.youtube.com/watch?v=${videoId}`)).toBeNull();
    expect(parseVideoUrl(`https://youtu.be/${videoId}/extra`)).toBeNull();
    expect(parseVideoUrl(`http://www.youtube.com/watch?v=${videoId}`)).toBeNull();
    expect(parseVideoUrl(`https://youtube.com.evil.test/watch?v=${videoId}`)).toBeNull();
    expect(parseVideoUrl(`https://www.youtube.com/watch?v=too-short`)).toBeNull();
  });

  it("treats an id in an audio filename as a suggestion only", () => {
    expect(suggestVideoId(`The State of Startups in 2026 [${videoId}].mp3`)).toBe(videoId);
    expect(suggestVideoId("meeting.mp3")).toBeNull();
    expect(suggestVideoId("[too-short].mp3")).toBeNull();
  });

  it("builds timestamped privacy-enhanced URLs", () => {
    expect(buildYouTubeUrl(videoId, 90)).toContain("https://www.youtube.com/watch?v=yslXlV2BP_Y&t=90s");
    expect(buildYouTubeEmbedUrl(videoId, { start: 12.8, end: 24.1 })).toBe(
      `https://www.youtube-nocookie.com/embed/${videoId}?start=12&end=25`,
    );
    expect(buildYouTubeEmbedUrl(videoId, { start: -12, end: 4 })).toBe(
      `https://www.youtube-nocookie.com/embed/${videoId}?start=0&end=4`,
    );
    expect(() => buildYouTubeEmbedUrl(videoId, { start: -20, end: -1 })).toThrow(
      "Reference range ends before the video start",
    );
    expect(buildYouTubeEmbedUrl(videoId, null)).toBe(
      `https://www.youtube-nocookie.com/embed/${videoId}`,
    );
  });

  it("bounds the persisted offset and rejects extra fields", () => {
    expect(ReferenceVideoSchema.safeParse({ youtubeId: videoId, offsetSeconds: 0 }).success).toBe(true);
    expect(ReferenceVideoSchema.safeParse({ youtubeId: videoId, offsetSeconds: 86401 }).success).toBe(false);
    expect(ReferenceVideoSchema.safeParse({ youtubeId: videoId, offsetSeconds: 0, key: "secret" }).success).toBe(false);
  });
});
