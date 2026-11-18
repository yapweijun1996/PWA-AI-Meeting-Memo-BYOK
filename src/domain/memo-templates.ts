export const MEMO_TEMPLATES = [
  "decision",
  "requirements",
  "incident",
  "uat",
  "client",
] as const;
export type MemoTemplate = (typeof MEMO_TEMPLATES)[number];
export type FactStatus = "proposed" | "confirmed" | "pending";
export const factLabels: Record<FactStatus, [string, string]> = {
  proposed: ["Proposed", "提议"],
  confirmed: ["Confirmed", "已确认"],
  pending: ["Pending confirmation", "待确认"],
} as const;

type Section = {
  type: "decision" | "action" | "question" | "summary" | "discussion" | "risk";
  name: [string, string];
  fields: [string, string][];
};
type Blueprint = { name: [string, string]; sections: Section[]; rules: string };
export const blueprints: Record<MemoTemplate, Blueprint> = {
  decision: {
    name: ["Decision & Action Memo", "决策与行动纪要"],
    sections: [
      {
        type: "action",
        name: ["Action items", "行动项"],
        fields: [
          ["Task", "任务"],
          ["Assignee", "负责人"],
          ["Deadline", "截止日期"],
          ["Completion criteria", "完成标准"],
          ["Proposer", "提议人"],
        ],
      },
      {
        type: "decision",
        name: ["Decisions", "决定"],
        fields: [
          ["Topic", "议题"],
          ["Decision", "决定"],
          ["Scope", "适用范围"],
          ["Effective time", "生效时间"],
        ],
      },
      {
        type: "question",
        name: ["Open questions", "未决问题"],
        fields: [
          ["Question", "待决事项"],
          ["Confirmer", "确认人"],
          ["Next follow-up", "下次跟进"],
        ],
      },
    ],
    rules: "A proposal remains proposed until explicitly agreed.",
  },
  requirements: {
    name: ["Requirements Memo", "需求确认纪要"],
    sections: [
      {
        type: "summary",
        name: ["Scope", "目标与范围"],
        fields: [
          ["Business goal", "业务目标"],
          ["Module or document", "模块或单据"],
          ["Company or role", "公司或角色"],
          ["Exclusions", "排除项"],
        ],
      },
      {
        type: "discussion",
        name: ["Business rules and exceptions", "业务规则与例外"],
        fields: [
          ["Trigger", "触发条件"],
          ["Expected behavior", "预期行为"],
          ["Exception", "例外"],
          ["Example", "示例"],
        ],
      },
      {
        type: "action",
        name: ["Acceptance criteria", "验收条件"],
        fields: [
          ["Scenario", "场景"],
          ["Input or operation", "输入或操作"],
          ["Expected result", "预期结果"],
        ],
      },
    ],
    rules:
      "Separate confirmed scope from proposed or pending scope. Write testable cases.",
  },
  incident: {
    name: ["Incident Memo", "故障处理纪要"],
    sections: [
      {
        type: "summary",
        name: ["Impact", "影响范围"],
        fields: [
          ["Environment", "环境"],
          ["Module", "模块"],
          ["Affected users or documents", "受影响用户或单据"],
          ["Quantity", "影响数量"],
          ["Impact period", "影响时段"],
        ],
      },
      {
        type: "discussion",
        name: ["Timeline", "事件时间线"],
        fields: [
          ["Event time", "事件时间"],
          ["Event", "事件"],
          ["Mitigation or verified recovery", "缓解或已验证恢复"],
          ["Recovery evidence", "恢复证据"],
        ],
      },
      {
        type: "action",
        name: ["Root cause and follow-up", "根因与后续"],
        fields: [
          ["Cause or hypothesis", "根因或假设"],
          ["Evidence", "依据"],
          ["Temporary mitigation", "临时措施"],
          ["Long-term fix", "长期修复"],
          ["Assignee", "负责人"],
        ],
      },
    ],
    rules:
      "Order events by evidenced event time, never recording offset. Use an ISO timestamp with offset only when date, time and timezone are known; otherwise preserve the original time wording. Label suspected causes as hypotheses. Confirm recovery and root cause separately only with evidence.",
  },
  uat: {
    name: ["UAT Memo", "用户验收纪要"],
    sections: [
      {
        type: "summary",
        name: ["Test scope", "验收范围"],
        fields: [
          ["Version", "版本"],
          ["Environment", "环境"],
          ["Business process", "业务流程"],
          ["Tester", "验收人"],
        ],
      },
      {
        type: "discussion",
        name: ["Scenario results", "场景结果"],
        fields: [
          ["Version", "版本"],
          ["Scenario", "场景"],
          ["Expected result", "预期结果"],
          ["Actual result", "实际结果"],
          ["Test result", "测试状态"],
          ["Failure or blocker", "失败或阻塞原因"],
        ],
      },
      {
        type: "action",
        name: ["Retest and sign-off", "复测与签核"],
        fields: [
          ["Defect", "缺陷"],
          ["Blocker severity", "阻塞级别"],
          ["Retest owner", "复测负责人"],
          ["Authorized approver", "签核人"],
          ["Sign-off status", "签核状态"],
          ["Conditions", "批准条件"],
        ],
      },
    ],
    rules:
      "Keep versions separate. Only explicit approval by an authorized approver supports sign-off. A scenario passing never implies overall approval. For Sign-off status use approved, conditional, declined or pending. Set Authorized approver only if the cited passage establishes both authority and approval. For conditional approval list every condition.",
  },
  client: {
    name: ["Client Recap", "客户跟进纪要"],
    sections: [
      {
        type: "action",
        name: ["Next steps", "双方待办"],
        fields: [
          ["Party", "客户方或我方"],
          ["Action", "行动"],
          ["Assignee", "负责人"],
          ["Deadline", "截止日期"],
        ],
      },
      {
        type: "decision",
        name: ["Agreements", "双方确认事项"],
        fields: [
          ["Scope", "范围"],
          ["Deliverable", "交付物"],
          ["Agreement", "约定"],
          ["Date and commitment level", "日期与承诺程度"],
        ],
      },
      {
        type: "question",
        name: ["Open points", "待确认事项"],
        fields: [
          ["Open point", "待确认问题"],
          ["Next follow-up", "下次跟进"],
        ],
      },
    ],
    rules:
      "Differentiate suggested, target and committed delivery dates. Return a separate client_copy string per item containing only the customer-ready agreement or next step; leave it empty for internal or sensitive content. Exclude links, evidence references and private details. Write client-facing language; omit private links and internal investigation details.",
  },
};

export function templateInstruction(template?: MemoTemplate) {
  if (!template) return "";
  const { name, sections, rules } = blueprints[template];
  return ` Produce a ${name[0]}. ${rules} Use these item types and fields: ${sections.map((section) => section.type + " = " + section.name[0] + " (" + section.fields.map(([field]) => field).join(", ") + ")").join("; ")}. Give every item fact_status proposed, confirmed or pending, independent of human review. Preserve conflicting statements as separate cited claims. Never infer ownership from who proposed work. Use original numbered speaker labels for unconfirmed identities. Return field_values as an array of {field,value} objects. Use the exact English field keys listed for this item type. Each value must be supported by the cited passages; omit unknown fields. For field values preserve timeframe, scope and qualifiers. For Test result use pass, fail, blocked or untested; absence of evidence is not proof a test was untested. Omit unsupported claims. Use the requested output language for values.`;
}

export function memoSpeakerLabel(
  speaker: { name: string; confirmed: boolean },
  index: number,
) {
  return speaker.confirmed || /^Speaker \d+(?:\b|$)/i.test(speaker.name)
    ? speaker.name
    : `Speaker ${index + 1}`;
}

/** Only the separately proposed customer wording may seed an external draft. */
export function clientDraft(
  template: MemoTemplate | undefined,
  items: readonly { clientText?: string }[],
) {
  if (template !== "client") return undefined;
  const paragraphs = items.flatMap((item) => {
    const text = item.clientText?.trim();
    return text &&
      !/(?:[a-z][a-z0-9+.-]*:\/\/|www\.|mailto:|\]\(|(?:^|\s)\/\S)/i.test(text)
      ? [text]
      : [];
  });
  const draft = paragraphs.join("\n\n");
  return draft.length <= 20_000 ? draft : "";
}

/** Sort only comparable event times. Undated events keep their supplied position. */
export function orderIncidentEvents<
  T extends { type: string; field_values?: { field: string; value: string }[] },
>(items: T[]): T[] {
  const slots: number[] = [];
  const events: { item: T; time: number }[] = [];
  for (const [index, item] of items.entries()) {
    if (item.type !== "discussion") continue;
    const value =
      item.field_values
        ?.find((field) => field.field === "Event time")
        ?.value.trim() ?? "";
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(
        value,
      )
    )
      continue;
    const time = Date.parse(value);
    if (!Number.isFinite(time)) continue;
    slots.push(index);
    events.push({ item, time });
  }
  events.sort((left, right) => left.time - right.time);
  const result = [...items];
  slots.forEach((slot, index) => {
    result[slot] = events[index].item;
  });
  return result;
}
