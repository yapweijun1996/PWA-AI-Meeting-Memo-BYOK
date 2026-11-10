import { describe, expect, it } from "vitest";
import { avatarWritesPending, flushAvatarWrites, trackAvatarWrite, validAvatar } from "../src/storage/speaker-avatars";

describe("speaker avatar persistence guards", () => {
  it("keeps backup and update flushes waiting for image preparation", async () => {
    let finish!: () => void;
    const write = trackAvatarWrite(new Promise<void>((resolve) => { finish = resolve; }));
    expect(avatarWritesPending()).toBe(true);
    let flushed = false;
    const flush = flushAvatarWrites().then(() => { flushed = true; });
    await Promise.resolve();
    expect(flushed).toBe(false);
    finish();
    await Promise.all([write, flush]);
    expect(avatarWritesPending()).toBe(false);
  });
  it("accepts only bounded raster data URLs", () => {
    expect(validAvatar("data:image/png;base64,AAAA")).toBe(true);
    expect(validAvatar("data:image/svg+xml;base64,AAAA")).toBe(false);
    expect(validAvatar(`data:image/png;base64,${"A".repeat(100_001)}`)).toBe(false);
  });
});
