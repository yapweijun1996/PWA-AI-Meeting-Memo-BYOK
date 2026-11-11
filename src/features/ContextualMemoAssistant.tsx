import { useMemo, useState } from "react";
import type { Meeting } from "../domain/model";
import { Modal } from "../components/ui";
import { cancelProcessing } from "../jobs/runner";
import { applyContextualSuggestion, contextualSnapshot, hasUnresolvedContextualAttempt, runContextualAssistant, type ContextualSelection } from "../jobs/contextual-assistant";
import { getSelection } from "../providers/credentials";
import type { ContextualAction } from "../providers/contextual-rewrite";
import { useUiLanguage } from "../ui-language";
import { translateUi } from "../i18n";
import "./contextual-memo.css";

export interface ContextualMemoAssistantProps {
  meeting: Meeting;
  selection: ContextualSelection;
  onMeetingUpdate: (meeting: Meeting) => void;
  onOpenEvidence: () => void;
  onClose: () => void;
}

/** The caller must first save the note draft, then provide its exact UTF-16 selection. */
export function ContextualMemoAssistant({ meeting, selection, onMeetingUpdate, onOpenEvidence, onClose }: ContextualMemoAssistantProps) {
  const language = useUiLanguage();
  const t = (en: string, zh: string) => translateUi(language, en, zh);
  const [current, setCurrent] = useState(meeting);
  const [action, setAction] = useState<ContextualAction>("simplify");
  const [reviewedUnknown, setReviewedUnknown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<string>();
  const provider = getSelection("memo");
  const snapshot = useMemo(() => {
    try { return contextualSnapshot(current, selection, action); }
    catch { return null; }
  }, [current, selection, action]);
  const matching = current.jobs.filter(job => job.state === "completed" && job.contextual?.suggestion && snapshot && job.contextual.memoId === snapshot.memoId && job.contextual.itemId === snapshot.itemId && job.contextual.action === action && job.contextual.originalText === snapshot.originalText && job.contextual.start === snapshot.start && job.contextual.end === snapshot.end && job.contextual.sourceRevision === snapshot.sourceRevision && JSON.stringify(job.contextual.sources) === JSON.stringify(snapshot.sources));
  const job = selectedJobId ? matching.find(value => value.id === selectedJobId) : matching.at(-1);
  const suggestion = job?.contextual?.action === action ? job.contextual.suggestion : null;
  const unresolved = hasUnresolvedContextualAttempt(current);
  const unresolvedJobs = current.jobs.filter(value => !!value.contextual && (value.state === "in_flight" || value.state === "outcome_unknown"));
  const unresolvedCount = unresolvedJobs.length;

  const checkpoint = (saved: Meeting) => { setCurrent(saved); onMeetingUpdate(saved); };
  async function send() {
    if (!snapshot) { setError(t("Save the note and select 1–4,000 characters within it first.", "请先保存笔记，再在同一条笔记中选择 1–4,000 个字符。")); return; }
    if (unresolved && !reviewedUnknown) { setError(t("Review the previous outcome and provider billing first.", "请先核对上次请求结果和服务商账单。")); return; }
    setError(""); setSelectedJobId(undefined); setBusy(true);
    try {
      const result = await runContextualAssistant(current, selection, action, provider, reviewedUnknown, checkpoint);
      setCurrent(result.meeting); setSelectedJobId(result.jobId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("The suggestion could not be completed.", "无法完成改写建议。")); }
    finally { setReviewedUnknown(false); setBusy(false); }
  }
  async function apply() {
    if (!job) return;
    setError(""); setBusy(true);
    try {
      const saved = await applyContextualSuggestion(current, job.id);
      checkpoint(saved);
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("The suggestion could not be applied.", "无法应用建议。")); }
    finally { setBusy(false); }
  }
  return <Modal title={t("Improve selected text", "优化所选文字")} onClose={onClose}>
    <div className="modal-body contextual-memo" aria-busy={busy}>
      <p>{t("Only the selected note text will be sent. No transcript or recording is included.", "仅发送选中的笔记文字，不包含转录或录音。")}</p>
      <label>{t("Action", "操作")}
        <select value={action} disabled={busy} onChange={event => { setAction(event.target.value as ContextualAction); setSelectedJobId(undefined); }}>
          <option value="simplify">{t("Simplify", "简化")}</option>
          <option value="rewrite">{t("Rewrite", "改写")}</option>
          <option value="shorten">{t("Shorten", "缩短")}</option>
        </select>
      </label>
      <div className="contextual-destination"><strong>{t("Provider and model", "服务商及模型")}</strong>: {provider.provider === "openai" ? "OpenAI" : "OpenRouter"} · {provider.model}<br />{t("Cost: unknown. One confirmed request may be charged.", "费用未知。确认后将发送一次可能收费的请求。")}</div>
      <h3>{t("Selected text", "所选文字")}</h3>
      <div className="contextual-text">{selection.originalText.slice(selection.start, selection.end)}</div>
      <button type="button" className="text-button" disabled={busy} onClick={onOpenEvidence}>{t("Check original sources", "核实原话")}</button>
      {unresolved && <><p>{t("Review these unresolved requests in the relevant provider accounts:", "请在对应服务商账户中核对以下未确定请求：")}</p><ul>{unresolvedJobs.map(value => <li key={value.id}>{value.provider} · {value.model} · {value.createdAt} · {t("Request ID", "请求 ID")}: {value.requestId || t("unavailable", "不可用")}</li>)}</ul><label className="contextual-review"><input type="checkbox" checked={reviewedUnknown} onChange={event => setReviewedUnknown(event.target.checked)} disabled={busy} /> {t(`I checked the provider account for all ${unresolvedCount} unresolved suggestion request(s) and understand another attempt may be charged.`, `我已核对全部 ${unresolvedCount} 次未确定建议请求的服务商账单，并了解再次请求可能收费。`)}</label></>}
      {error && <div role="alert" className="notice danger">{error}</div>}
      {suggestion && <section className="contextual-comparison">
        <h3>{t("Suggested replacement", "建议替换为")}</h3>
        <div className="contextual-text">{suggestion}</div>
        <p className="small muted">{t("Review the meaning yourself. Applying changes only the selection, keeps source references and marks this note for review; the suggestion is not verified evidence.", "请自行核对含义。应用只更改所选文字，保留来源并将笔记标为待复核；建议不代表证据已验证。")}</p>
        <button type="button" className="button primary" disabled={busy} onClick={() => void apply()}>{t("Apply selected change", "应用所选修改")}</button>
      </section>}
      <div className="contextual-actions">
        {busy ? <button type="button" className="button secondary" onClick={cancelProcessing}>{t("Stop waiting", "停止等待")}</button> : <button type="button" className="button secondary" disabled={!snapshot || (unresolved && !reviewedUnknown)} onClick={() => void send()}>{t("Confirm and send", "确认并发送")}</button>}
        <button type="button" className="button secondary" onClick={onClose}>{t("Close", "关闭")}</button>
      </div>
      {busy && <p role="status">{t("Waiting for the provider. Closing the page may leave a billable unknown outcome.", "正在等待服务商。关闭页面可能留下仍会计费的未知结果。")}</p>}
    </div>
  </Modal>;
}
