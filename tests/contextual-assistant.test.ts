import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sampleMeeting, type Meeting } from "../src/domain/model";
import { getMeeting, saveMeeting } from "../src/storage/repository";
import * as repository from "../src/storage/repository";
import { applyContextualSuggestion, hasUnresolvedContextualAttempt, runContextualAssistant } from "../src/jobs/contextual-assistant";
import { backupMeeting, readBackup } from "../src/storage/backup";

vi.mock("../src/providers/credentials", () => ({
  getSelection: () => ({ provider: "openrouter", model: "test/model" }),
  getKey: () => "synthetic-contextual-key",
  getSpeechEstimate: () => null,
}));
vi.stubGlobal("window", new EventTarget());

async function meetingFixture(): Promise<Meeting> {
  const meeting = sampleMeeting();
  const source = meeting.segments[0];
  const note = { id: crypto.randomUUID(), type: "summary" as const, text: "Before selected phrase after", ownerId: null, dueDate: null, dueOriginal: null, sources: [{ id: source.id, revision: source.revision }], review: "accepted" as const, reviewedRevision: meeting.revision };
  meeting.memos = [{ id: crypto.randomUUID(), createdAt: new Date().toISOString(), sourceRevision: meeting.revision, model: "test", items: [note], originalItems: [structuredClone(note)] }];
  return saveMeeting(meeting);
}
function selected(meeting: Meeting) {
  const item = meeting.memos[0].items[0];
  return { memoId: meeting.memos[0].id, itemId: item.id, originalText: item.text, start: 7, end: 22 };
}
const selection = { provider: "openrouter" as const, model: "test/model" };
const answer = () => new Response(JSON.stringify({ id: "synthetic-response", status: "completed", usage: { input_tokens: 10, output_tokens: 4, cost: 0.001 }, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ text: "improved" }) }] }] }), { status: 200 });

beforeEach(() => { vi.restoreAllMocks(); });

describe("contextual suggestion", () => {
  it("sends only a confirmed selection once, saves suggestion and applies an undoable unreviewed edit", async () => {
    const meeting = await meetingFixture();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => answer());
    vi.stubGlobal("fetch", fetchMock);
    const result = await runContextualAssistant(meeting, selected(meeting), "simplify", selection, false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const options = fetchMock.mock.calls[0][1]!;
    const payload = JSON.parse(options.body as string);
    expect(payload.input).toBe(JSON.stringify({ selected_text: "selected phrase" }));
    expect(JSON.stringify(payload)).not.toContain("Before selected phrase after");
    expect(payload.provider).toEqual({ allow_fallbacks: false, require_parameters: true });
    expect(options.redirect).toBe("error");
    const stored = (await getMeeting(meeting.id))!;
    const job = stored.jobs.find(value => value.id === result.jobId)!;
    expect(job.state).toBe("completed");
    expect(job.contextual?.suggestion).toBe("improved");
    expect(job.reportedCostUsd).toBe(0.001);
    expect(stored.memos[0].items[0].text).toBe("Before selected phrase after");
    expect(JSON.stringify(stored)).not.toContain("synthetic-contextual-key");
    const changed = await applyContextualSuggestion(stored, job.id);
    expect(changed.memos[0].items[0].text).toBe("Before improved after");
    expect(changed.memos[0].items[0].review).toBe("edited");
    expect(changed.memos[0].items[0].reviewedRevision).toBeNull();
    expect(changed.memos[0].items[0].sources).toEqual(meeting.memos[0].items[0].sources);
    expect(changed.memos[0].originalItems).toEqual(meeting.memos[0].originalItems);
    expect(changed.memos[0].editUndo?.[0].before.text).toBe("Before selected phrase after");
    await expect(applyContextualSuggestion(changed, job.id)).rejects.toThrow("select the text again");
  });

  it("keeps unknown outcomes durable, requires a fresh billing review, and never retries automatically", async () => {
    const meeting = await meetingFixture();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(runContextualAssistant(meeting, selected(meeting), "rewrite", selection, false)).rejects.toThrow("provider billing");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const unknown = (await getMeeting(meeting.id))!;
    expect(hasUnresolvedContextualAttempt(unknown)).toBe(true);
    expect(unknown.jobs.at(-1)?.state).toBe("outcome_unknown");
    const archive = await backupMeeting(unknown);
    const restored = await readBackup(new File([archive], "meeting.zip", { type: "application/zip" }));
    expect(restored.meeting.jobs.at(-1)?.state).toBe("outcome_unknown");
    expect(JSON.stringify(restored.meeting)).not.toContain("synthetic-contextual-key");
    await expect(runContextualAssistant(unknown, selected(unknown), "rewrite", selection, false)).rejects.toThrow("Review provider billing");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(answer());
    await runContextualAssistant(unknown, selected(unknown), "rewrite", selection, true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects stale note selections and source revisions before applying a saved suggestion", async () => {
    const meeting = await meetingFixture();
    vi.stubGlobal("fetch", vi.fn(async () => answer()));
    const result = await runContextualAssistant(meeting, selected(meeting), "shorten", selection, false);
    const changed = await saveMeeting({ ...result.meeting, revision: result.meeting.revision + 1 });
    await expect(applyContextualSuggestion(changed, result.jobId)).rejects.toThrow("transcript changed");
    expect((await getMeeting(meeting.id))?.memos[0].items[0].text).toBe(meeting.memos[0].items[0].text);
  });

  it("does not send for changed or invalid selections", async () => {
    const meeting = await meetingFixture();
    const fetchMock = vi.fn(async () => answer());
    vi.stubGlobal("fetch", fetchMock);
    await expect(runContextualAssistant(meeting, { ...selected(meeting), originalText: "old content" }, "rewrite", selection, false)).rejects.toThrow("Save the note");
    await expect(runContextualAssistant(meeting, { ...selected(meeting), end: 999 }, "rewrite", selection, false)).rejects.toThrow("Select 1–4,000");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("never sends when the pre-request checkpoint cannot be saved", async () => {
    const meeting = await meetingFixture();
    const fetchMock = vi.fn(async () => answer());
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(repository, "saveMeeting").mockRejectedValueOnce(new Error("storage full"));
    await expect(runContextualAssistant(meeting, selected(meeting), "rewrite", selection, false)).rejects.toThrow("storage full");
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await getMeeting(meeting.id))!.jobs).toHaveLength(0);
  });

  it("retains an unresolved checkpoint if the response cannot be saved", async () => {
    const meeting = await meetingFixture();
    const fetchMock = vi.fn(async () => answer());
    vi.stubGlobal("fetch", fetchMock);
    const realSave = repository.saveMeeting;
    let writes = 0;
    vi.spyOn(repository, "saveMeeting").mockImplementation(async value => {
      if (++writes > 1) throw new Error("storage full");
      return realSave(value);
    });
    await expect(runContextualAssistant(meeting, selected(meeting), "rewrite", selection, false)).rejects.toThrow("billing");
    const stored = (await getMeeting(meeting.id))!;
    expect(stored.jobs.at(-1)?.state).toBe("in_flight");
    expect(hasUnresolvedContextualAttempt(stored)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(runContextualAssistant(stored, selected(stored), "rewrite", selection, false)).rejects.toThrow("Review provider billing");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("allows at most one concurrent request and rejects a stale meeting before sending", async () => {
    const meeting = await meetingFixture();
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const first = runContextualAssistant(meeting, selected(meeting), "rewrite", selection, false);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await expect(runContextualAssistant(meeting, selected(meeting), "rewrite", selection, false)).rejects.toThrow("current request");
    finish(answer());
    await first;
    await expect(runContextualAssistant(meeting, selected(meeting), "rewrite", selection, false)).rejects.toThrow("meeting changed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses to apply if the saved text or citation references changed", async () => {
    const meeting = await meetingFixture();
    vi.stubGlobal("fetch", vi.fn(async () => answer()));
    const result = await runContextualAssistant(meeting, selected(meeting), "rewrite", selection, false);
    const original = result.meeting.memos[0].items[0];
    const otherRef = { id: result.meeting.segments[1].id, revision: result.meeting.segments[1].revision };
    const altered = structuredClone(result.meeting);
    altered.memos[0].items[0].sources = [otherRef];
    const withChangedSources = await saveMeeting(altered);
    await expect(applyContextualSuggestion(withChangedSources, result.jobId)).rejects.toThrow("citations changed");
    const textAltered = structuredClone(withChangedSources);
    textAltered.memos[0].items[0].sources = original.sources;
    textAltered.memos[0].items[0].text += " human edit";
    const withChangedText = await saveMeeting(textAltered);
    await expect(applyContextualSuggestion(withChangedText, result.jobId)).rejects.toThrow("select the text again");
  });

  it("does not send when the pretty-printed backup plus result reserve exceeds the limit", async () => {
    const meeting = await meetingFixture();
    const padded = Object.assign(structuredClone(meeting), { padding: Array(400_000).fill(0), filler: "x".repeat(9_500_000) });
    expect(new TextEncoder().encode(JSON.stringify(padded)).byteLength).toBeLessThan(12 * 1024 * 1024 - 304_384);
    expect(new TextEncoder().encode(JSON.stringify(padded, null, 2)).byteLength).toBeGreaterThan(12 * 1024 * 1024 - 304_384);
    vi.spyOn(repository, "getMeeting").mockResolvedValue(padded);
    const fetchMock = vi.fn(async () => answer());
    vi.stubGlobal("fetch", fetchMock);
    await expect(runContextualAssistant(padded, selected(padded), "rewrite", selection, false)).rejects.toThrow("backup budget");
    expect(fetchMock).not.toHaveBeenCalled();
  });

});
