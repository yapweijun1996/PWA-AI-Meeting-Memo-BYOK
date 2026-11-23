import { afterEach, expect, test, vi } from "vitest";
import { reviewTurnContinuity } from "../src/domain/turn-context";

afterEach(() => vi.unstubAllGlobals());

test.each(["downloadable", "downloading", "unavailable"])(
  "does not create a model when availability is %s",
  async (availability) => {
    const create = vi.fn();
    vi.stubGlobal("LanguageModel", {
      availability: async () => availability,
      create,
    });
    expect(
      await reviewTurnContinuity(
        "The next step is",
        "to check it",
        "before opening",
      ),
    ).toBe("unavailable");
    expect(create).not.toHaveBeenCalled();
  },
);

test.each([
  '"turn_change"',
  '"supports"',
  '"uncertain"',
  '"Speaker A"',
  "invalid",
])("accepts only the structured discourse verdict %s", async (reply) => {
  const destroy = vi.fn();
  const prompt = vi.fn(async (input: string) => {
    void input;
    return reply;
  });
  vi.stubGlobal("LanguageModel", {
    availability: async () => "available",
    create: async () => ({ prompt, destroy }),
  });
  const verdict = await reviewTurnContinuity("If we", "stop now", "then what");
  expect(verdict).toBe(
    reply === '"turn_change"'
      ? "turn_change"
      : reply === '"supports"'
        ? "supports"
        : "uncertain",
  );
  expect(JSON.parse(prompt.mock.calls[0]![0] as string)).toEqual({
    left: "If we",
    middle: "stop now",
    right: "then what",
  });
  expect(destroy).toHaveBeenCalledOnce();
});

test("keeps an unusable input uncertain and respects cancellation", async () => {
  expect(await reviewTurnContinuity("", "reply", "after")).toBe("uncertain");
  await expect(
    reviewTurnContinuity("before", "reply", "after", AbortSignal.abort()),
  ).rejects.toMatchObject({ name: "AbortError" });
});

test("cancels a pending availability probe without creating a session", async () => {
  const controller = new AbortController();
  const create = vi.fn();
  vi.stubGlobal("LanguageModel", {
    availability: () => new Promise(() => {}),
    create,
  });
  const pending = reviewTurnContinuity(
    "before",
    "reply",
    "after",
    controller.signal,
  );
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(create).not.toHaveBeenCalled();
});
