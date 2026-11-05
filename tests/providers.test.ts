import { it, expect, vi, afterEach } from "vitest";
import {
  normalizeSpeech,
  normalizeMemo,
  transcribe,
  generateMemo,
} from "../src/providers/api";
import { sampleMeeting } from "../src/domain/model";
afterEach(() => vi.unstubAllGlobals());
it.each([
  [401, false],
  [429, false],
  [503, true],
] as const)(
  "records HTTP %i as submitted, keeping rejection separate from billing",
  async (status, uncertain) => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      transcribe(
        new Blob(["audio"]),
        "synthetic-test",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ submitted: true, uncertain });
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);
it("normalizes words into actual speaker turns without confirming identities", () => {
  const result = normalizeSpeech({
    words: [
      { word: "hi", start: 0, end: 1, speaker: 0 },
      { word: "yes", start: 1, end: 2, speaker: 1 },
    ],
  });
  expect(result.segments).toHaveLength(2);
  expect(result.speakers.every((s) => !s.confirmed)).toBe(true);
});
it("never invents time or speakers for text-only output", () => {
  const result = normalizeSpeech({ text: "No timing" });
  expect(result.speakers).toEqual([]);
  expect(result.segments[0]).toMatchObject({
    start: null,
    end: null,
    speakerIds: [],
  });
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
    words: [{ word: "Hello", start: 0, end: 1 }],
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

it("sends an OpenRouter Scribe request with diarization and a provider-specific key", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        text: "Hello",
        words: [{ word: "Hello", start: 0, end: 1, speaker: 2 }],
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal("fetch", fetch);
  const result = await transcribe(
    new Blob(["audio"]),
    "router-key",
    new AbortController().signal,
    { provider: "openrouter", model: "elevenlabs/scribe-v2" },
    "sample.wav",
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe("https://openrouter.ai/api/v1/audio/transcriptions");
  expect(options.headers.Authorization).toBe("Bearer router-key");
  expect(JSON.parse(options.body.get("provider"))).toEqual({
    options: { elevenlabs: { diarize: true } },
  });
  expect(result.segments[0]).toMatchObject({ start: 0, end: 1 });
  expect(result.speakers).toHaveLength(1);
});
it("rejects oversized audio before submission", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(
    transcribe(
      new Blob([new Uint8Array(25000001)]),
      "test",
      new AbortController().signal,
    ),
  ).rejects.toThrow("25 MB");
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects malformed timestamps instead of inventing evidence", () => {
  expect(() =>
    normalizeSpeech({
      segments: [{ text: "Hello", start: 2, end: 1, speaker: 0 }],
    }),
  ).toThrow("No valid transcript");
});
it("keeps word speaker evidence when a provider also returns unlabelled segments", () => {
  const result = normalizeSpeech({
    text: "Hello yes",
    segments: [{ text: "Hello yes", start: 0, end: 2 }],
    words: [
      { word: "Hello", start: 0, end: 1, speaker: 0 },
      { word: "yes", start: 1, end: 2, speaker: 1 },
    ],
  });
  expect(result.speakers).toHaveLength(2);
  expect(result.segments).toHaveLength(2);
});

it("sends OpenAI diarization with the documented response format and automatic chunking", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        text: "Hello",
        duration: 2,
        segments: [{ text: "Hello", start: 0, end: 2, speaker: "A" }],
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal("fetch", fetch);
  const result = await transcribe(
    new Blob(["audio"], { type: "audio/mpeg" }),
    "synthetic-test",
    new AbortController().signal,
    { provider: "openai", model: "gpt-4o-transcribe-diarize" },
    "meeting.mp3",
  );
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
  expect(options.body.get("model")).toBe("gpt-4o-transcribe-diarize");
  expect(options.body.get("response_format")).toBe("diarized_json");
  expect(options.body.get("chunking_strategy")).toBe("auto");
  expect(options.body.get("file").name).toBe("meeting.mp3");
  expect(result.segments[0]).toMatchObject({ text: "Hello", start: 0, end: 2 });
  expect(result.speakers).toHaveLength(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("reports safe duration guidance from an error without exposing response data", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: "Audio recording is too long; private-test-secret",
            code: null,
            param: null,
          },
        }),
        { status: 400 },
      ),
    );
  vi.stubGlobal("fetch", fetch);
  try {
    await transcribe(
      new Blob(["audio"]),
      "synthetic-test",
      new AbortController().signal,
    );
    throw new Error("Expected provider rejection");
  } catch (error) {
    expect(error).toMatchObject({ submitted: true, uncertain: false });
    expect(String(error)).toContain("duration or length limit");
    expect(String(error)).not.toContain("private-test-secret");
  }
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("keeps an unknown 400 reason generic without leaking the response", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: "private-test-secret",
            code: "invalid_request_error",
          },
        }),
        { status: 400 },
      ),
    );
  vi.stubGlobal("fetch", fetch);
  await expect(
    transcribe(
      new Blob(["audio"]),
      "synthetic-test",
      new AbortController().signal,
    ),
  ).rejects.toThrow("exact reason was not available");
  expect(fetch).toHaveBeenCalledTimes(1);
});
