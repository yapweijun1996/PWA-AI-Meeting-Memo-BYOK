import "fake-indexeddb/auto";
import { describe, it, expect, vi } from "vitest";
import { createMeeting } from "../src/domain/model";
vi.stubGlobal("window", new EventTarget());
const repo = await import("../src/storage/repository");
describe("atomic local repository", () => {
  it("rejects stale writes and preserves the winning version", async () => {
    const a = await repo.saveMeeting(createMeeting());
    const b = await repo.saveMeeting({ ...a, title: "Winning edit" });
    await expect(
      repo.saveMeeting({ ...a, title: "Stale edit" }),
    ).rejects.toThrow("another tab");
    expect((await repo.getMeeting(a.id))?.title).toBe("Winning edit");
    expect(b.version).toBe(a.version + 1);
  });
  it("deletes only the chosen meeting and its audio", async () => {
    const a = await repo.saveMeeting(createMeeting(), new Blob(["a"]));
    const b = await repo.saveMeeting(createMeeting(), new Blob(["b"]));
    await repo.deleteMeeting(a.id);
    expect(await repo.getAudio(a.id)).toBeUndefined();
    expect((await repo.getAudio(b.id))?.size).toBe(1);
  });
  it("marks interrupted work as possibly charged, never queued", async () => {
    const m = createMeeting();
    m.jobs = [
      {
        id: crypto.randomUUID(),
        stage: "speech",
        state: "in_flight",
        billing: "possibly_charged",
        createdAt: "now",
        updatedAt: "now",
        requestId: null,
        message: "",
        inputRevision: 1,
      },
    ];
    const restored = await repo.recoverJobs(await repo.saveMeeting(m));
    expect(restored.jobs[0].state).toBe("outcome_unknown");
    expect(restored.jobs[0].billing).toBe("possibly_charged");
  });
});
