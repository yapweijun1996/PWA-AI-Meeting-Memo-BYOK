import { Children, createElement, isValidElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { agentLocalFinalFixture } from "./fixtures/agent-local-final";
import { MemoGenerationConfirmation } from "../src/features/MemoGenerationConfirmation";
import { MeetingWorkspace } from "../src/features/MeetingWorkspace";
import { planAgentMemo } from "../src/providers/memo-agent-plan";
import { markInterruptedRequests } from "../src/jobs/memo-interruption";
import { acknowledgeAgentExport, retainAgentReceipt } from "../src/jobs/agent-recovery";
import { validateMeeting, type Meeting } from "../src/domain/model";

const { credentialAvailable } = vi.hoisted(() => ({ credentialAvailable: vi.fn(() => false) }));
vi.mock("../src/providers/credentials", async importOriginal => ({
  ...await importOriginal<typeof import("../src/providers/credentials")>(),
  getKey: () => credentialAvailable() ? "present" : "",
}));

afterEach(() => {
  credentialAvailable.mockReset();
  vi.unstubAllGlobals();
});

type ConfirmationProps = ComponentProps<typeof MemoGenerationConfirmation>;
function confirmationProps(meeting: Meeting, overrides: Partial<ConfirmationProps> = {}): ConfirmationProps {
  const plan = meeting.memoAgents![0];
  return {
    meeting, language: "en", confirmation: {
      selection: { provider: plan.provider, model: plan.model }, template: "decision", agentPlan: plan,
      outputLanguage: plan.outputLanguage,
    },
    costAcknowledged: false, reviewedRetry: false,
    onCostAcknowledged: vi.fn(), onReviewedRetry: vi.fn(), onToggleReview: vi.fn(), onRouteChange: vi.fn(),
    onReview: vi.fn(), onClose: vi.fn(), onGenerate: vi.fn(),
    ...overrides,
  };
}

function confirmation(meeting: Meeting, overrides?: Partial<ConfirmationProps>) {
  return renderToStaticMarkup(createElement(MemoGenerationConfirmation, confirmationProps(meeting, overrides)));
}

function buttonAttributes(html: string, label: string) {
  return html.match(new RegExp(`<button([^>]*)>${label}</button>`))?.[1];
}

test.each([2, 100])("a saved final after %i attempts can be recovered without a provider key or paid consent", attempts => {
  const html = confirmation(agentLocalFinalFixture({ attempts, fullHistory: true }));
  const recovery = buttonAttributes(html, "Recover saved notes");
  expect(recovery).toBeDefined();
  expect(recovery).not.toContain("disabled");
  expect(buttonAttributes(html, "Generate new notes")).toBeUndefined();
  expect(html).not.toContain("Add your key in Settings first");
  expect(html).not.toContain("I understand the selected data will be sent");
});

test("the confirmation shows the saved Pi plan's actual template when resuming a pre-template review", () => {
  const html = confirmation(agentLocalFinalFixture({ attempts: 2 }));
  expect(html).toContain("<dt>Memo type</dt><dd>Meeting notes</dd>");
});

test("manual interruption blocks the corresponding Pi plan without losing its cumulative attempts or paid output", () => {
  const meeting = agentLocalFinalFixture({ attempts: 3 });
  const plan = meeting.memoAgents![0];
  const job = { ...meeting.jobs.at(-1)!, id: crypto.randomUUID(), stepIndex: 3, state: "in_flight" as const };
  delete job.assistantRecord;
  const interrupted = validateMeeting({
    ...meeting, jobs: [...meeting.jobs, job], memoAgents: [{ ...plan, state: "running", jobIds: [...plan.jobIds, job.id] }],
  });
  const resolved = validateMeeting(markInterruptedRequests(interrupted));
  expect(resolved.jobs.at(-1)).toMatchObject({ id: job.id, state: "outcome_unknown", billing: "possibly_charged" });
  expect(resolved.jobs.slice(0, -1)).toEqual(meeting.jobs);
  expect(resolved.memoAgents![0]).toEqual({ ...interrupted.memoAgents![0], state: "blocked" });
});

test("an unsaved receipt blocks overwriting a known outcome and opening saved-plan continuation", () => {
  const received = agentLocalFinalFixture({ attempts: 2 });
  const plan = received.memoAgents![0];
  const finalJob = received.jobs.at(-1)!;
  const { assistantRecord, ...receipt } = finalJob;
  expect(assistantRecord).toBeDefined();
  const meeting = validateMeeting({
    ...received,
    jobs: [received.jobs[0], { ...receipt, state: "in_flight" }],
    memoAgents: [{ ...plan, state: "running", context: plan.context.slice(0, -1) }],
  });
  vi.stubGlobal("window", new EventTarget());
  retainAgentReceipt({ meetingId: meeting.id, agentId: plan.id, job: finalJob });
  try {
    const html = renderToStaticMarkup(createElement(MeetingWorkspace, {
      meeting, onUpdate: vi.fn(), onDelete: vi.fn(), onError: vi.fn(),
    }));
    expect(buttonAttributes(html, "Retry local save only")).toBeDefined();
    expect(buttonAttributes(html, "Review generation plan")).toContain("disabled");
    expect(buttonAttributes(html, "Review interruption")).toContain("disabled");
  } finally {
    acknowledgeAgentExport(meeting.id);
  }
});

test("attempting Pi opt-in revokes prior standard-send consent even when selective planning fails", () => {
  const meeting = agentLocalFinalFixture({ attempts: 2 });
  const authorize = vi.fn();
  const reviewBilling = vi.fn();
  const selection = { provider: "openai", model: "gpt-6-luna" } as const;
  const full = { ...meeting, memos: Array.from({ length: 30 }, () => ({ ...meeting.memos[0], id: crypto.randomUUID() })) };
  const denied = vi.fn(() => planAgentMemo(full, selection, "en"));
  const props = confirmationProps(meeting, {
    confirmation: { selection },
    costAcknowledged: true, reviewedRetry: true,
    onToggleReview: denied, onCostAcknowledged: authorize, onReviewedRetry: reviewBilling,
  });
  // Invoke the native checkbox handler without mounting a browser or supplying a credential.
  const labelText = "Use selective transcript review (Pi, optional)";
  let changeReview: ((event: { target: { checked: boolean } }) => void) | undefined;
  function visit(node: ReactNode) {
    if (!isValidElement<{ children?: ReactNode }>(node)) return;
    const [input, caption] = Children.toArray(node.props.children);
    if (node.type === "label" && isValidElement<{ children?: ReactNode }>(caption) && caption.props.children === labelText &&
      isValidElement<{ onChange: typeof changeReview }>(input)) changeReview = input.props.onChange;
    else Children.forEach(node.props.children, visit);
  }
  visit(MemoGenerationConfirmation(props));
  expect(changeReview).toBeDefined();
  expect(() => changeReview!({ target: { checked: true } })).toThrow("cannot retain another bounded review");
  expect(denied).toHaveBeenCalledWith(true);
  expect(authorize).toHaveBeenCalledWith(false);
  expect(reviewBilling).toHaveBeenCalledWith(false);
});


test("an unresolved attempt requires both paid consents while its saved final remains locally recoverable", () => {
  credentialAvailable.mockReturnValue(true);
  const meeting = agentLocalFinalFixture({ attempts: 3, invalid: true });
  const html = confirmation(meeting, { costAcknowledged: true });
  expect(buttonAttributes(html, "Generate new notes")).toContain("disabled");
  expect(buttonAttributes(html, "Recover saved notes")).toBeDefined();
  expect(buttonAttributes(html, "Recover saved notes")).not.toContain("disabled");
  const approved = confirmation(meeting, { costAcknowledged: true, reviewedRetry: true });
  expect(buttonAttributes(approved, "Generate new notes")).toBeDefined();
  expect(buttonAttributes(approved, "Generate new notes")).not.toContain("disabled");
});

test("a tool-only response at the ceiling cannot authorize local finalization or another paid request", () => {
  credentialAvailable.mockReturnValue(true);
  const meeting = agentLocalFinalFixture();
  const plan = meeting.memoAgents![0];
  const html = confirmation(validateMeeting({
    ...meeting, memoAgents: [{ ...plan, context: plan.context.slice(0, 1) }],
  }), { costAcknowledged: true, reviewedRetry: true });
  expect(buttonAttributes(html, "Recover saved notes")).toBeUndefined();
  expect(buttonAttributes(html, "Generate new notes")).toContain("disabled");
  expect(html).toContain("100-request limit");
});

test("standalone memo confirmation requires billing review for the same unknown revision and route", () => {
  credentialAvailable.mockReturnValue(true);
  const meeting = agentLocalFinalFixture({ attempts: 2 });
  const selection = { provider: "openai" as const, model: "gpt-6-luna" };
  meeting.jobs.push({ ...meeting.jobs[0], id: crypto.randomUUID(), agentId: undefined, assistantRecord: undefined,
    state: "outcome_unknown", ...selection });
  const props = { confirmation: { selection, plan: null }, costAcknowledged: true };
  const consent = confirmation(meeting, props);
  expect(consent).toContain("I reviewed the previous request outcome and billing.");
  expect(buttonAttributes(consent, "Generate new notes")).toContain("disabled");
  expect(buttonAttributes(confirmation(meeting, { ...props, reviewedRetry: true }), "Generate new notes")).not.toContain("disabled");
  expect(buttonAttributes(confirmation({ ...meeting, revision: meeting.revision + 1 }, props), "Generate new notes")).not.toContain("disabled");
  expect(buttonAttributes(confirmation(meeting, { ...props, confirmation: { selection: { ...selection, model: "other" } } }), "Generate new notes")).not.toContain("disabled");
});

test.each(["in_flight", "outcome_unknown"] as const)(
  "standalone memo confirmation requires billing review for the same legacy %s attempt",
  state => {
    credentialAvailable.mockReturnValue(true);
    const meeting = agentLocalFinalFixture({ attempts: 2 });
    const selection = { provider: "openai" as const, model: "gpt-6-luna" };
    const legacy = { ...meeting.jobs[0], id: crypto.randomUUID(), agentId: undefined, assistantRecord: undefined,
      provider: undefined, model: undefined, inputRevision: meeting.revision, state };
    meeting.jobs.push(legacy);
    const props = { confirmation: { selection, plan: null }, costAcknowledged: true };
    const consent = confirmation(meeting, props);
    expect(consent).toContain("I reviewed the previous request outcome and billing.");
    expect(buttonAttributes(consent, "Generate new notes")).toContain("disabled");
    expect(buttonAttributes(confirmation({ ...meeting, revision: meeting.revision + 1 }, props), "Generate new notes")).not.toContain("disabled");
    const otherProvider = { ...meeting, jobs: [...meeting.jobs.slice(0, -1), { ...legacy, provider: "openrouter" as const }] };
    expect(buttonAttributes(confirmation(otherProvider, props), "Generate new notes")).not.toContain("disabled");
  },
);
