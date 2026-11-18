import { expect, it } from "vitest";
import { createMeeting, segment } from "../src/domain/model";
import { clientDraft, orderIncidentEvents } from "../src/domain/memo-templates";
import { normalizeMemo } from "../src/providers/api";
import {
  planAgentMemo,
  resumableAgentMemo,
} from "../src/providers/memo-agent-plan";
import { planMemo } from "../src/providers/memo-plan";
import { resumablePipeline } from "../src/jobs/memo-pipeline";

it("requires cited revisions and distinguishes UAT outcome from approval", () => {
  const meeting = createMeeting();
  const source = segment(
    "The invoice test passed. Pat will retest the empty PO case.",
  );
  meeting.segments = [source];
  const item = {
    type: "discussion",
    text: "发票场景通过。",
    fact_status: "confirmed",
    owner_speaker_id: null,
    due_date: null,
    due_original: null,
    source_segment_ids: [source.id],
    field_values: [{ field: "Test result", value: "pass" }],
  };
  const parse = (patch: Partial<typeof item>) =>
    normalizeMemo(
      { items: [{ ...item, ...patch }] },
      meeting,
      undefined,
      "uat",
      "zh-CN",
    )[0];
  const result = parse({});
  expect(result).toMatchObject({
    review: "pending",
    factStatus: "confirmed",
    sources: [{ id: source.id, revision: 1 }],
  });
  expect(result.text).toContain("测试状态: 通过");
  expect(result.text).toContain("版本: 待确认");
  expect(parse({ field_values: [] }).text).toContain("测试状态: 待确认");
  expect(() => parse({ source_segment_ids: ["absent"] })).toThrow();
  expect(() =>
    parse({
      type: "action",
      field_values: [{ field: "Sign-off status", value: "approved" }],
    }),
  ).toThrow(/approver/);
  expect(() =>
    parse({
      type: "action",
      field_values: [
        { field: "Sign-off status", value: "附条件批准" },
        { field: "Authorized approver", value: "Pat" },
      ],
    }),
  ).toThrow(/conditions/);
  expect(() =>
    parse({ field_values: [{ field: "Unrelated", value: "value" }] }),
  ).toThrow(/template fields/);
});

it("freezes each template in its own long and selective plan", () => {
  const meeting = createMeeting();
  meeting.segments = Array.from({ length: 1200 }, (_, i) =>
    segment(i + " " + "words ".repeat(20)),
  );
  const selection = { provider: "openai", model: "gpt-6-luna" } as const;
  const long = planMemo(
    meeting,
    selection.provider,
    selection.model,
    "incident",
  )!;
  const agent = planAgentMemo(meeting, selection, "en", "uat");
  meeting.memoPipelines = [long];
  meeting.memoAgents = [agent];
  expect(resumablePipeline(meeting, selection, true, "incident")?.id).toBe(
    long.id,
  );
  expect(
    resumablePipeline(meeting, selection, true, "requirements"),
  ).toBeUndefined();
  expect(resumableAgentMemo(meeting, selection, "uat")?.id).toBe(agent.id);
  expect(resumableAgentMemo(meeting, selection, "client")).toBeUndefined();
});

it("seeds client drafts only from separate customer wording and omits link-bearing paragraphs", () => {
  expect(
    clientDraft("client", [
      { clientText: "Please send a sample." },
      { clientText: "Ticket https://internal.example/test" },
      {},
    ]),
  ).toBe("Please send a sample.");
  expect(
    clientDraft("incident", [{ clientText: "Internal." }]),
  ).toBeUndefined();
});

it("orders incident events by actual event time while leaving unknown times unresolved", () => {
  const event = (time: string) => ({
    type: "discussion",
    field_values: [{ field: "Event time", value: time }],
  });
  const early = event("2026-11-05T09:00:00+08:00"),
    late = event("2026-11-05T05:00:00Z");
  const unknown = event("during the afternoon");
  expect(orderIncidentEvents([late, unknown, early])).toEqual([
    early,
    unknown,
    late,
  ]);
});
