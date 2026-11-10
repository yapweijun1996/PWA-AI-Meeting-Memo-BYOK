import { describe, expect, it } from "vitest";
import { createMeeting, segment, validateMeeting } from "../src/domain/model";
import { replaceTranscript } from "../src/domain/operations";
import { deriveLegacyPartSpeech } from "../src/jobs/acoustic-continuity";
import type { LongAudioManifest } from "../src/storage/long-audio-store";

const hash = "a".repeat(64);
const meetingId = "00000000-0000-4000-8000-000000000001";
const manifest: LongAudioManifest = {
  meetingId,
  format: "mp3",
  mimeType: "audio/mpeg",
  totalSeconds: 20,
  sampleRate: 44_100,
  totalBytes: 1,
  createdAt: new Date().toISOString(),
  chunks: [
    { index: 0, byteLength: 1, sha256: hash, ownStartSeconds: 0, ownDurationSeconds: 10, leadInSeconds: 0 },
    { index: 1, byteLength: 1, sha256: hash, ownStartSeconds: 10, ownDurationSeconds: 10, leadInSeconds: 1 },
  ],
  manifestSha256: hash,
};

describe("legacy paged-source recovery", () => {
  it("reconstructs per-part local speech from an old raw run without a paid request", () => {
    const speakers = [
      { id: "part-0:A", name: "Speaker 1", confirmed: false, sourceLabels: [] },
      { id: "part-1:A", name: "Speaker 1", confirmed: false, sourceLabels: [] },
    ];
    const raw = [
      segment("first", ["part-0:A"], 1, 2),
      segment("second", ["part-1:A"], 11, 12),
      segment("untimed", [], null, null),
    ];
    const initial = validateMeeting({ ...createMeeting(), id: manifest.meetingId, speakers, segments: raw });
    const withRun = replaceTranscript(initial, speakers, raw, "OpenRouter", "scribe", {
      originalSpeakers: speakers,
      originalSegments: raw,
    });
    const parts = deriveLegacyPartSpeech(withRun, manifest);
    expect(parts.get(0)?.segments.map((value) => value.text)).toEqual(["first", "untimed"]);
    expect(parts.get(1)?.segments.map((value) => value.text)).toEqual(["second"]);
    expect(parts.get(1)?.segments[0]?.start).toBe(2);
    expect(parts.get(1)?.segments[0]?.speakerIds).toEqual(["A"]);
  });
});
