import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  readSettings,
  writeSettings,
  type SettingsRecord,
} from "../src/storage/settings";

describe("local settings storage", () => {
  it("saves validated settings atomically and rejects stale revisions", async () => {
    expect(await readSettings()).toBeNull();
    const initial: SettingsRecord = {
      version: 1,
      revision: 0,
      keys: { openai: "synthetic-key", openrouter: "" },
      speech: { provider: "openrouter", model: "elevenlabs/scribe-v2" },
      memo: { provider: "openai", model: "gpt-6-luna" },
      speechRate: 0.01,
    };
    const saved = await writeSettings(initial, 0);
    expect(saved.revision).toBe(1);
    expect(await readSettings()).toEqual(saved);
    await expect(
      writeSettings(
        { ...initial, keys: { openai: "stale-key", openrouter: "" } },
        0,
      ),
    ).rejects.toThrow("another tab");
    expect(await readSettings()).toEqual(saved);
    const cleared = await writeSettings(
      { ...saved, keys: { openai: "", openrouter: "" } },
      1,
    );
    expect(cleared.revision).toBe(2);
    expect((await readSettings())?.keys.openai).toBe("");
    expect((await readSettings())?.speech.model).toBe("elevenlabs/scribe-v2");
  });
});
