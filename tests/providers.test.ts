import { it, expect, vi, afterEach } from "vitest";
import {
  normalizeSpeech,
  normalizeMemo,
  transcribe,
  generateMemo,
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
it("retains billing uncertainty when a successful response body is interrupted", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response('{"results":', { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  await expect(
    transcribe(
      new Blob(["audio"]),
      "synthetic-test",
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ uncertain: true, charged: true });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("keeps owner and invalid dates unknown even when a model fills them", () => {
  const m = sampleMeeting();
  const [item] = normalizeMemo(
    {
      items: [
        {
          type: "action",
          text: "Check inventory",
          owner_speaker_id: m.speakers[0].id,
          due_date: "2026-02-30",
          due_original: "next month",
          source_segment_ids: [m.segments[0].id],
        },
      ],
    },
    m,
  );
  expect(item.ownerId).toBeNull();
  expect(item.dueDate).toBeNull();
  expect(item.dueOriginal).toBe("next month");
});
it("keeps missing speaker metadata anonymous", () => {
  const result = normalizeSpeech({
    results: {
      channels: [
        { alternatives: [{ words: [{ word: "Hello", start: 0, end: 1 }] }] },
      ],
    },
  });
  expect(result.speakers).toEqual([]);
  expect(result.segments[0].speakerIds).toEqual([]);
});

it("treats a refusal as a failed billed result without a retry", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        status: "completed",
        output: [{ type: "message", content: [{ type: "refusal" }] }],
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal("fetch", fetch);
  await expect(
    generateMemo(
      sampleMeeting(),
      "synthetic-test",
      new AbortController().signal,
    ),
  ).rejects.toThrow("declined");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("rejects unsupported long memo inputs before making a request", async () => {
  const m = sampleMeeting();
  m.segments = Array.from({ length: 5 }, (_, i) => ({
    ...m.segments[0],
    id: crypto.randomUUID(),
    text: "x".repeat(19000),
    revision: i + 1,
  }));
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(
    generateMemo(m, "synthetic-test", new AbortController().signal),
  ).rejects.toThrow("80,000");
  expect(fetch).not.toHaveBeenCalled();
});
