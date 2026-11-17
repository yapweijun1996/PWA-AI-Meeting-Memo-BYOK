import "fake-indexeddb/auto";
import { afterEach, expect, test, vi } from "vitest";
import { agentLocalFinalFixture } from "./fixtures/agent-local-final";
import { runJob } from "../src/jobs/runner";
import { getMeeting, saveMeeting } from "../src/storage/repository";
import { backupMeeting, readBackup } from "../src/storage/backup";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function fixture(options = {}) {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network allowed for local recovery"); }));
  const original = agentLocalFinalFixture(options);
  const restored = await readBackup(new File([await backupMeeting(original)], "synthetic-final.zip"));
  const meeting = await saveMeeting(restored.meeting);
  return { meeting, confirmed: { selection: { provider: "openai" as const, model: "gpt-6-luna" }, agentPlan: meeting.memoAgents![0], localOnly: true } };
}

test("local final recovery needs no key or billing confirmation and works with full request and run ledgers", async () => {
  const { meeting, confirmed } = await fixture({ fullHistory: true });
  const recovered = await runJob(meeting, "memo", confirmed);
  expect(fetch).not.toHaveBeenCalled();
  expect(recovered.jobs).toEqual(meeting.jobs);
  expect(recovered.runs).toEqual(meeting.runs);
  expect(recovered.memos[0]).toEqual(meeting.memos[0]);
  expect(recovered.memos[1].items[0].text).toBe("Recovered from saved evidence.");
  expect(recovered.memoAgents![0].state).toBe("completed");
});

test("invalid local final content never falls through to a paid correction even below the ceiling", async () => {
  const { meeting, confirmed } = await fixture({ attempts: 2, invalid: true });
  await expect(runJob(meeting, "memo", confirmed)).rejects.toThrow("did not read");
  expect(fetch).not.toHaveBeenCalled();
  expect(await getMeeting(meeting.id)).toEqual(meeting);
});

test("local recovery retains source, exact-plan and processing-lock checks", async () => {
  const { meeting, confirmed } = await fixture();
  await expect(runJob({ ...meeting, revision: 2 }, "memo", confirmed)).rejects.toThrow("confirmed review changed");
  await expect(runJob(meeting, "memo", { ...confirmed, agentPlan: { ...confirmed.agentPlan, requestLimit: null } })).rejects.toThrow("confirmed review changed");
  vi.stubGlobal("navigator", { locks: { request: async (_key: string, _options: object, callback: (lock: null) => unknown) => callback(null) } });
  await expect(runJob(meeting, "memo", confirmed)).rejects.toThrow("Another tab");
  expect(fetch).not.toHaveBeenCalled();
  expect(await getMeeting(meeting.id)).toEqual(meeting);
});

test("a local-only request cannot use a tool response as permission for another model turn", async () => {
  const { meeting, confirmed } = await fixture({ attempts: 2 });
  const saved = await saveMeeting({ ...meeting, memoAgents: [{ ...confirmed.agentPlan, context: confirmed.agentPlan.context.slice(0, 1) }] });
  await expect(runJob(saved, "memo", { ...confirmed, agentPlan: saved.memoAgents![0] })).rejects.toThrow("No saved final response");
  expect(fetch).not.toHaveBeenCalled();
  expect(await getMeeting(saved.id)).toEqual(saved);
});
