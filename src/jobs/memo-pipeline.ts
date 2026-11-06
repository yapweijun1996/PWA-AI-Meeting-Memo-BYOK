import { id, type Meeting, type Job, type MemoItem } from "../domain/model";
import { getMeeting, saveMeeting } from "../storage/repository";
import { generateMemo, ProviderError } from "../providers/api";
import { getKey, type Selection } from "../providers/credentials";
import {
  captureExtraction,
  extractionInput,
  pipelineMeeting,
  synthesisInput,
  type MemoPipeline,
} from "../providers/memo-plan";

let controller: AbortController | undefined;
let meetingId: string | undefined;
export const pipelineActive = (target?: string) =>
  !!controller && (!target || target === meetingId);
export const cancelPipeline = () => controller?.abort();

/** One confirmed foreground plan; checkpoints never schedule themselves after reload. */
export async function runMemoPipeline(
  m: Meeting,
  selection: Selection,
  proposed: MemoPipeline,
  reviewedRetry = false,
  onCheckpoint?: (m: Meeting) => void,
): Promise<Meeting> {
  if (controller)
    throw new Error("Finish the current request before starting another.");
  const key = getKey(selection.provider);
  if (!key) throw new Error("Add the selected provider key in Settings first.");
  if (
    proposed.sourceRevision !== m.revision ||
    proposed.provider !== selection.provider ||
    proposed.model !== selection.model
  )
    throw new Error(
      "The confirmed memo plan changed. Open the confirmation again.",
    );
  if (
    m.jobs.some(
      (j) => j.pipelineId === proposed.id && j.state !== "completed",
    ) &&
    !reviewedRetry
  )
    throw new Error(
      "Review the previous paid outcome before confirming another attempt.",
    );
  controller = new AbortController();
  meetingId = m.id;
  const signal = controller.signal;
  window.dispatchEvent(new Event("memo-processing-changed"));
  const execute = async () => {
    let current = await getMeeting(m.id);
    if (
      !current ||
      current.version !== m.version ||
      current.jobs.some((j) => j.state === "in_flight")
    )
      throw new Error(
        "This meeting changed or has an unfinished request. Reload before submitting.",
      );
    let p = structuredClone(proposed);
    const existing = current.memoPipelines?.find((v) => v.id === p.id);
    if (existing) p = structuredClone(existing);
    else
      current = await saveMeeting({
        ...current,
        schemaVersion: 2,
        memoPipelines: [...(current.memoPipelines ?? []), p],
      });
    const persist = async (update: (value: Meeting) => Meeting) => {
      const latest = await getMeeting(m.id);
      if (!latest) throw new Error("The meeting was removed while processing.");
      current = await saveMeeting(update(latest));
      onCheckpoint?.(current);
      window.dispatchEvent(new Event("memo-storage-changed"));
    };
    const checkpoint = (value: Meeting) => ({
      ...value,
      memoPipelines: value.memoPipelines!.map((v) => (v.id === p.id ? p : v)),
    });
    for (let index = 0; index <= p.chunks.length; index++) {
      if (index < p.chunks.length && p.results[index]) continue;
      if (signal.aborted) {
        p.state = "paused";
        await persist(checkpoint);
        throw new Error("Memo plan paused. Saved steps were retained.");
      }
      const frozen = pipelineMeeting(m, p);
      const leaf =
        index < p.chunks.length ? extractionInput(m, p, index) : frozen;
      // Validate the entire synthesis payload before recording a submitted attempt.
      const prepared =
        index === p.chunks.length ? synthesisInput(p) : undefined;
      const job: Job = {
        id: id(),
        stage: "memo",
        pipelineId: p.id,
        stepIndex: index,
        state: "in_flight",
        billing: "possibly_charged",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        requestId: null,
        inputRevision: p.sourceRevision,
        provider: p.provider,
        model: p.model,
        message: `Memo step ${index + 1}/${p.chunks.length + 1}. Keep this page open.`,
        estimateUsd: null,
      };
      p.state = "running";
      await persist((value) => {
        if (value.jobs.some((j) => j.state === "in_flight"))
          throw new Error("Another tab is processing this meeting.");
        return checkpoint({ ...value, jobs: [...value.jobs, job] });
      });
      let usage: Job["usage"] = null,
        requestId: string | null = null,
        cost: number | null = null;
      const timer = setTimeout(() => controller?.abort(), 9 * 60 * 1000);
      try {
        const items = await generateMemo(
          leaf,
          key,
          signal,
          (u, r, c) => {
            usage = u;
            requestId = r;
            cost = c;
          },
          selection,
          prepared,
          prepared
            ? " Synthesize only the supplied candidate facts and their exact source quotations. Cite candidate item ids in source_segment_ids. Preserve contradictions and uncertainty; these candidates are not human-verified. Never resolve a conflict by guessing."
            : " Extract evidence-grounded candidate facts for a later synthesis step. Preserve numbers, dates, conditions, disagreements and brief replies. Be concise. These candidates remain subject to human review.",
        );
        if (prepared) {
          p.memoId = id();
          p.state = "completed";
        } else p.results[index] = captureExtraction(leaf, items);
        const memoId = p.memoId;
        await persist((value) => {
          const result = checkpoint({
            ...value,
            jobs: value.jobs.map((j) =>
              j.id === job.id
                ? {
                    ...j,
                    state: "completed",
                    billing:
                      cost === null ? "possibly_charged" : "provider_reported",
                    usage,
                    requestId,
                    reportedCostUsd: cost,
                    updatedAt: new Date().toISOString(),
                    message: `Saved memo step ${index + 1}/${p.chunks.length + 1}.`,
                  }
                : j,
            ),
          });
          if (prepared && memoId) {
            const known = new Set(
              [...value.segments, ...value.history].map(
                (s) => `${s.id}:${s.revision}`,
              ),
            );
            const old = p.snapshot.segments.filter(
              (s) => !known.has(`${s.id}:${s.revision}`),
            );
            return {
              ...result,
              history: [...value.history, ...old],
              memos: [
                ...value.memos,
                {
                  id: memoId,
                  createdAt: new Date().toISOString(),
                  sourceRevision: p.sourceRevision,
                  model: `${p.provider}: ${p.model}`.slice(0, 100),
                  items,
                  originalItems: structuredClone(items),
                },
              ],
            };
          }
          return result;
        });
      } catch (error) {
        p.state = "blocked";
        const uncertain = !(error instanceof ProviderError) || error.uncertain;
        // Do not persist an in-memory result when its atomic save failed.
        const saved = await getMeeting(m.id);
        const persisted = saved?.memoPipelines?.find((v) => v.id === p.id);
        if (persisted) p = { ...persisted, state: "blocked" };
        await persist((value) =>
          checkpoint({
            ...value,
            jobs: value.jobs.map((j) =>
              j.id === job.id
                ? {
                    ...j,
                    state: uncertain ? "outcome_unknown" : "failed",
                    billing:
                      cost === null ? "possibly_charged" : "provider_reported",
                    usage,
                    requestId,
                    reportedCostUsd: cost,
                    updatedAt: new Date().toISOString(),
                    message:
                      "Memo plan stopped. Review this attempt and provider billing before a new generation.",
                  }
                : j,
            ),
          }),
        );
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
    return current!;
  };
  try {
    if (navigator.locks)
      return await navigator.locks.request(
        `meeting-memo-job:${m.id}`,
        { ifAvailable: true },
        (lock) => {
          if (!lock) throw new Error("Another tab is processing this meeting.");
          return execute();
        },
      );
    return await execute();
  } finally {
    controller = undefined;
    meetingId = undefined;
    window.dispatchEvent(new Event("memo-processing-changed"));
  }
}

/** Resume only saved successes; a prior submitted failure needs a separately confirmed generation. */
export function resumablePipeline(
  m: Meeting,
  selection: Selection,
  includeFailures = false,
): MemoPipeline | undefined {
  return [...(m.memoPipelines ?? [])]
    .reverse()
    .find(
      (p) =>
        p.state !== "completed" &&
        (includeFailures || p.state !== "blocked") &&
        p.sourceRevision === m.revision &&
        p.provider === selection.provider &&
        p.model === selection.model &&
        (includeFailures ||
          !m.jobs.some(
            (j) => j.pipelineId === p.id && j.state !== "completed",
          )),
    );
}

export function extractionItems(p: MemoPipeline): MemoItem[] {
  return p.results.flatMap((r) => r?.items ?? []);
}
