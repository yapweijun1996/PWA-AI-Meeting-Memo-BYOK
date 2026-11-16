import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync, zipSync } from "fflate";
import { createMeeting, MAX_MEETING_JSON_BYTES, segment, validateMeeting, type Meeting } from "../src/domain/model";
import { assignSegments, replaceTranscript } from "../src/domain/operations";
import { planMemo } from "../src/providers/memo-plan";
import { backupMeeting, readBackup } from "../src/storage/backup";
import { deleteMeeting, saveMeeting } from "../src/storage/repository";
import { formatBytes, measureMeetingRecord, scanStorage } from "../src/storage/storage-report";

vi.stubGlobal("window", new EventTarget());

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const OLD_MEMO_BUDGET = 10 * 1024 * 1024;
const OLD_IMPORT_LIMIT = 12 * 1024 * 1024;

/** A one-hour word-level transcript (12,584 passages) after `regroups` automatic regroupings. */
function longRegroupedMeeting(regroups = 1): Meeting {
  const a = "part-0:voice-a";
  const b = "part-0:voice-b";
  const speakers = [a, b].map((id) => ({ id, name: id, confirmed: false, sourceLabels: [] }));
  const words = Array.from({ length: 12_584 }, (_, index) => segment(`word${index} `, [a], index * 0.28, index * 0.28 + 0.25));
  const transcribed = replaceTranscript(createMeeting(), speakers, words, "OpenRouter", "scribe", {
    originalSpeakers: speakers,
    originalSegments: words,
  });
  // Every regrouping changes the speaker of every passage: a history copy and an undo copy appear each time.
  let meeting = transcribed;
  for (let round = 0; round < regroups; round += 1) {
    meeting = assignSegments(meeting, meeting.segments.map((item) => item.id), [round % 2 === 0 ? b : a]);
  }
  return meeting;
}

describe("meeting size limit", () => {
  it("is one limit, large enough for a long word-level meeting and still bounded", () => {
    expect(MAX_MEETING_JSON_BYTES).toBeGreaterThan(OLD_IMPORT_LIMIT);
    // Far below the roughly 512 MiB a JavaScript string can hold in Chromium.
    expect(MAX_MEETING_JSON_BYTES).toBeLessThan(256 * 1024 * 1024);
  });

  it("plans a memo for the meeting that was refused at 10 MiB", () => {
    const meeting = longRegroupedMeeting();
    expect(bytes(meeting)).toBeGreaterThan(OLD_MEMO_BUDGET);
    // Too large for one request, so a plan is returned instead of the budget error.
    const plan = planMemo(meeting, "openai", "model");
    expect(plan?.chunks.length).toBeGreaterThan(0);
    expect(bytes({ ...meeting, memoPipelines: [plan] })).toBeLessThan(MAX_MEETING_JSON_BYTES);
  }, 60_000);

  it("backs up and restores a meeting between the old and new limits", async () => {
    const meeting = await saveMeeting(longRegroupedMeeting(2));
    expect(bytes(meeting)).toBeGreaterThan(OLD_IMPORT_LIMIT);
    expect(bytes(meeting)).toBeLessThan(MAX_MEETING_JSON_BYTES);
    const archive = new Uint8Array(await (await backupMeeting(meeting)).arrayBuffer());
    expect(strFromU8(unzipSync(archive)["meeting.json"]!).length).toBeGreaterThan(OLD_IMPORT_LIMIT);
    const restored = await readBackup(new File([archive], "meeting.zip"));
    expect(restored.meeting.segments).toHaveLength(12_584);
    await deleteMeeting(meeting.id);
  }, 60_000);

  it("rejects a backup whose meeting document is over the limit", async () => {
    const json = await readBackup(new File([new Uint8Array(MAX_MEETING_JSON_BYTES + 1)], "meeting.json")).catch((error: Error) => error);
    expect((json as Error).message).toMatch(/exceeds 64 MB/);
    const zip = zipSync({ "meeting.json": new Uint8Array(MAX_MEETING_JSON_BYTES + 1) }, { level: 0 });
    await expect(readBackup(new File([new Uint8Array(zip)], "meeting.zip"))).rejects.toThrow(/too large/);
  });
});

describe("storage report", () => {
  it("splits a meeting record into sections that add up to its size", () => {
    const meeting = longRegroupedMeeting();
    const { total, parts } = measureMeetingRecord(meeting);
    expect(parts.segments).toBeGreaterThan(2_000_000);
    expect(parts.history).toBeGreaterThan(2_000_000);
    expect(parts.undo).toBeGreaterThan(2_000_000);
    expect(parts.providerRuns).toBeGreaterThan(2_000_000);
    expect(parts.memoPlans).toBeLessThan(100);
    // Sections are measured separately; only the commas and braces between them are not counted.
    expect(Math.abs(total - bytes(meeting))).toBeLessThan(1_000);
  }, 60_000);

  it("reports each saved meeting, its limit share and the browser's estimate, and changes nothing", async () => {
    vi.stubGlobal("navigator", {
      storage: { estimate: async () => ({ usage: 50_000_000, quota: 1_000_000_000 }), persisted: async () => true },
    });
    const saved = await saveMeeting(validateMeeting({ ...createMeeting(), title: "Weekly sync" }));
    const report = await scanStorage();
    const row = report.meetings.find((item) => item.meetingId === saved.id)!;
    expect(row.title).toBe("Weekly sync");
    expect(row.recordBytes).toBeGreaterThan(100);
    expect(row.limitShare).toBeCloseTo(row.recordBytes / MAX_MEETING_JSON_BYTES, 10);
    expect(row.recordingBytes).toBe(0);
    expect(row.totalBytes).toBe(row.recordBytes + row.voiceAndPartBytes + row.imageBytes);
    expect(report).toMatchObject({ usageBytes: 50_000_000, quotaBytes: 1_000_000_000, persisted: true, meetingLimitBytes: MAX_MEETING_JSON_BYTES });
    const again = await scanStorage();
    expect(again.meetings.find((item) => item.meetingId === saved.id)?.recordBytes).toBe(row.recordBytes);
    await deleteMeeting(saved.id);
    vi.unstubAllGlobals();
    vi.stubGlobal("window", new EventTarget());
  });

  it("formats byte counts", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(14.6 * 1024 * 1024)).toBe("14.6 MB");
    expect(formatBytes(2.5 * 1024 ** 3)).toBe("2.5 GB");
    expect(formatBytes(Number.NaN)).toBe("—");
  });
});
