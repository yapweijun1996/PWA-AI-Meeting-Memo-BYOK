import { it, expect, vi, afterEach } from "vitest";
import {
  normalizeSpeech,
  normalizeMemo,
  transcribe,
} from "../src/providers/api";
import { sampleMeeting } from "../src/domain/model";
afterEach(() => vi.unstubAllGlobals());
it("normalizes words into actual speaker turns without confirming identities", () => {
  const result = normalizeSpeech({
    results: {
      channels: [
        {
          alternatives: [
            {
              words: [
                { word: "hi", start: 0, end: 1, speaker: 0 },
                { word: "yes", start: 1, end: 2, speaker: 1 },
              ],
            },
          ],
        },
      ],
    },
  });
  expect(result.segments).toHaveLength(2);
  expect(result.speakers.every((s) => !s.confirmed)).toBe(true);
});
it("never invents time for unsupported output", () => {
  expect(() => normalizeSpeech({ text: "No timing" })).toThrow("contract");
});
it("rejects invented evidence IDs in a memo", () => {
  expect(() =>
    normalizeMemo(
      {
        items: [
          {
            type: "action",
            text: "Do something",
            owner_speaker_id: null,
            due_date: null,
            due_original: null,
            source_segment_ids: ["fake-id"],
          },
        ],
      },
      sampleMeeting(),
    ),
  ).toThrow("unknown passage");
});
it("does not retry an uncertain paid submission or expose a key in errors", async () => {
  const fetch = vi.fn().mockRejectedValue(new Error("secret-key"));
  vi.stubGlobal("fetch", fetch);
  await expect(
    transcribe(new Blob(["audio"]), "secret-key", new AbortController().signal),
  ).rejects.toThrow("may have been charged");
  expect(fetch).toHaveBeenCalledTimes(1);
});
