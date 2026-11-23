import { blueprints, type MemoTemplate } from "../domain/memo-templates";
import { Button, Field } from "../components/controls";
import { Icon } from "../components/Icon";
import { CheckCircle2, CircleAlert, Settings2, ShieldCheck, Sparkles, Wallet } from "lucide-react";
import type { Meeting, MemoAgentPlan } from "../domain/model";
import type { MemoOutputLanguage } from "../domain/memo-language";
import { memoLanguageLabel, translateUi, type UiLanguage } from "../i18n";
import { getKey, type Selection } from "../providers/credentials";
import { needsMemoBillingReview, type MemoPipeline } from "../providers/memo-plan";
import { hasSavedAgentFinal, supportsAgentMemo } from "../providers/memo-agent-plan";
import { translateMessage } from "../ui-messages";
import { resolveAgentRoute, type AgentRoute } from "../domain/memo-agent-route";
import { MEMO_AGENT_MAX_REQUESTS } from "../domain/memo-agent-contract";
import { remainingAgentRequests, AGENT_REQUEST_LIMIT_MESSAGE } from "../domain/memo-agent-requests";
import "./memo-confirmation.css";

export type MemoConfirmation = {
  selection: Selection;
  template?: MemoTemplate;
  outputLanguage?: MemoOutputLanguage;
  plan?: MemoPipeline | null;
  planError?: string;
  agentPlan?: MemoAgentPlan;
  agentPlanError?: string;
  draftRoute?: AgentRoute;
};

export function MemoGenerationConfirmation({
  meeting,
  confirmation,
  language,
  costAcknowledged,
  reviewedRetry,
  onCostAcknowledged,
  onReviewedRetry,
  onToggleReview,
  onRouteChange,
  onReview,
  onClose,
  onGenerate,
}: {
  meeting: Meeting;
  confirmation: MemoConfirmation;
  language: UiLanguage;
  costAcknowledged: boolean;
  reviewedRetry: boolean;
  onCostAcknowledged: (value: boolean) => void;
  onReviewedRetry: (value: boolean) => void;
  onToggleReview: (value: boolean) => void;
  onRouteChange: (route: AgentRoute) => void;
  onReview: (target: "speakers" | "transcript" | "fields") => void;
  onClose: () => void;
  onGenerate: (action: "generate" | "recover") => void;
}) {
  const t = (en: string, zh: string) => translateUi(language, en, zh);
  const { selection, plan, agentPlan } = confirmation;
  const route = agentPlan ? resolveAgentRoute(agentPlan) : undefined;
  const routeLocked = Boolean(agentPlan && meeting.memoAgents?.some(saved => saved.id === agentPlan.id));
  const speakers = meeting.speakers.filter(speaker => !speaker.confirmed).length;
  const passages = meeting.segments.filter(segment => !segment.reviewed).length;
  const missingFields = meeting.segments.filter(segment => !segment.speakerIds.length || segment.start === null || segment.end === null).length;
  const previousAttempts = meeting.jobs.some(job => job.stage === "memo");
  const template = agentPlan ? agentPlan.template : confirmation.template;
  const savedFinal = Boolean(routeLocked && agentPlan && hasSavedAgentFinal(meeting, agentPlan));
  const requestLimitReached = Boolean(agentPlan && remainingAgentRequests(agentPlan) === 0);
  const missingKey = !(savedFinal && requestLimitReached) && !getKey(selection.provider);
  const localRecovery = savedFinal && (requestLimitReached || missingKey);
  const needsRetryReview = !localRecovery && needsMemoBillingReview(meeting, confirmation);
  const planError = confirmation.agentPlanError ?? confirmation.planError;
  const planBlocked = Boolean(planError && !agentPlan);
  const requestBlocked = requestLimitReached && !localRecovery;
  const canGenerate = !missingKey && !planBlocked && !requestLimitReached && costAcknowledged && (!needsRetryReview || reviewedRetry);
  const recoveryDescription = t("Recover notes from the saved final response and frozen source evidence. Nothing is sent to a provider.", "根据已保存的最终回应和冻结的来源证据恢复笔记，不会向服务商发送任何内容。");
  const recoverButton = <Button type="button" className={localRecovery ? "button primary" : "button secondary"} onClick={() => onGenerate("recover")}>{t("Recover saved notes", "恢复已保存的笔记")}</Button>;
  const checks = [
    { count: speakers, description: t(`${speakers} unconfirmed speakers`, `${speakers} 位说话人未确认`), action: t("Review speakers", "查看说话人"), target: "speakers" as const },
    { count: passages, description: t(`${passages} unreviewed passages`, `${passages} 段转录未审阅`), action: t("Review transcript", "查看转录"), target: "transcript" as const },
    { count: missingFields, description: t(`${missingFields} passages missing speaker or time`, `${missingFields} 段缺少说话人或时间`), action: t("Review fields", "查看字段"), target: "fields" as const },
  ];

  return <>
    <div className="memo-confirm-scroll">
      <p className="memo-confirm-intro">{localRecovery ? recoveryDescription : t("Uses the existing transcript to generate notes; it does not make a new recording. Nothing is sent until you confirm.", "使用现有转录生成笔记，不会重新录音。确认之前不会发送任何内容。")}</p>

      <section className="memo-confirm-section" aria-labelledby="memo-settings-title">
        <h3 id="memo-settings-title"><Icon glyph={Settings2} size="control" />{t("Generation settings", "生成设置")}</h3>
        <dl className="memo-confirm-settings">
          <div><dt>{localRecovery ? t("Original provider", "原服务商") : t("Provider", "接收方")}</dt><dd>{selection.provider === "openai" ? "OpenAI · api.openai.com" : "OpenRouter · openrouter.ai"}</dd></div>
          <div><dt>{t("AI model", "AI 模型")}</dt><dd>{selection.model}</dd></div>
          <div><dt>{t("Memo type","纪要类型")}</dt><dd>{template ? t(...blueprints[template].name) : t("Meeting notes", "会议笔记")}</dd></div>
          <div><dt>{t("Output language", "输出语言")}</dt><dd>{memoLanguageLabel(confirmation.outputLanguage ?? "meeting", language)}</dd></div>
          <div><dt>{t("Data source", "数据来源")}</dt><dd>{agentPlan ? t("Selected excerpts, speakers and context", "选取的片段、说话人和背景") : t("Transcript, speakers and context", "转录、说话人和背景")}</dd></div>
          <div><dt>{t("Transcript size", "转录规模")}</dt><dd>{t(`${meeting.segments.length.toLocaleString()} passages`, `${meeting.segments.length.toLocaleString()} 段`)}</dd></div>
          <div><dt>{t("Estimated cost", "预计费用")}</dt><dd>{localRecovery ? t("No new API charge", "无新增 API 费用") : t("Unknown; provider may charge", "未知；服务商可能收费")}</dd></div>
        </dl>
        <details className="memo-confirm-details">
          <summary>{t("Technical details", "技术详情")}</summary>
          <p>{localRecovery ? t("Saved responses and source evidence are validated in this browser. No API key is needed.", "在此浏览器中校验已保存的回应和来源证据，不需要 API 密钥。") : agentPlan
            ? t("Selected transcript excerpts, speaker names and meeting context (title, date, timezone, languages, type and glossary) are sent. This is not a complete transcript review.", "会发送选取的转录片段、说话人姓名和会议背景（标题、日期、时区、语言、类型和术语）。这不代表完整审阅转录。")
            : t("Transcript, speaker names and meeting context (title, date, timezone, languages, type and glossary) are sent.", "会发送转录、说话人姓名和会议背景（标题、日期、时区、语言、类型和术语）。")}</p>
          {!localRecovery && selection.provider === "openrouter" && <p>{t("OpenRouter routes the request to a model provider.", "OpenRouter 会将请求转发给模型服务商。")}</p>}
          {!localRecovery && <p>{t("Review your provider's data retention policy for your account.", "请查看服务商对您账户的数据保留政策。")}</p>}
        </details>
      </section>

      <section className="memo-confirm-section" aria-labelledby="memo-checks-title">
        <h3 id="memo-checks-title"><Icon glyph={ShieldCheck} size="control" />{t("Pre-generation checks", "生成前检查")}</h3>
        <p className="memo-confirm-hint">{t("Review is recommended but does not block generation.", "建议先核对；这些事项不会阻止生成。")}</p>
        <ul className="memo-confirm-checks">{checks.map(check => <li key={check.target} className={check.count ? "needs-review" : undefined}>
          <Icon glyph={check.count ? CircleAlert : CheckCircle2} size="inline" aria-hidden="true" />
          <span>{check.description}</span>
          {check.count > 0 && <Button type="button" className="text-button" onClick={() => onReview(check.target)}>{check.action}</Button>}
        </li>)}</ul>
      </section>

      <section className="memo-confirm-section" aria-labelledby="memo-review-title">
        <h3 id="memo-review-title"><Icon glyph={Sparkles} size="control" />{t("Optional review", "可选复核")}</h3>
        {supportsAgentMemo(selection) ? <>
          <label className="checkbox-label confirmation-consent memo-confirm-checkbox"><input type="checkbox" checked={!!agentPlan || !!confirmation.agentPlanError} onChange={event => {
            onCostAcknowledged(false);
            onReviewedRetry(false);
            onToggleReview(event.target.checked);
          }} /><span>{t("Use selective transcript review (Pi, optional)", "使用选择性转录复核（Pi，可选）")}</span></label>
          {agentPlan ? <>
            {route && <>
              <div className="memo-route-fields">
                <Field label={t("Reasoning effort", "推理强度")}><select disabled={routeLocked} value={route.reasoning} onChange={event => onRouteChange({ ...route, reasoning: event.target.value as AgentRoute["reasoning"] })}>
                  <option value="low">{t("Low", "低")}</option><option value="medium">{t("Medium", "中")}</option><option value="high">{t("High", "高")}</option>
                </select></Field>
                <Field label={t("Output token limit", "输出 token 上限")}><select disabled={routeLocked} value={route.maxOutputTokens} onChange={event => onRouteChange({ ...route, maxOutputTokens: Number(event.target.value) as AgentRoute["maxOutputTokens"] })}>
                  <option value={4096}>4,096</option><option value={16384}>16,384</option><option value={32768}>32,768</option>
                </select></Field>
              </div>
              {routeLocked && <p className="memo-confirm-hint">{t("Continuing the saved route and parameters. They cannot change during this review.", "将继续使用已保存的路线和参数；本轮复核中不可更换。")}</p>}
              <p className="memo-confirm-hint">{t("Manual route; live account compatibility and memo quality are not benchmark-verified. Higher limits do not guarantee better results.", "手动路线；真实账户兼容性及纪要质量尚未经基准验证。更高上限不保证更好的结果。")}</p>
              {selection.provider === "openrouter" && <p className="memo-confirm-hint">{t("OpenRouter → OpenAI only. Automatic provider fallback is disabled; unavailable routes stop the review.", "仅使用 OpenRouter → OpenAI。已禁用服务商自动回退；路线不可用时会停止复核。")}</p>}
            </>}
            {!localRecovery && <p className="memo-confirm-hint">{t("Pi gathers evidence through multiple tool calls, up to 100 requests per review. Repeated lookups without progress pause the review. This is selective coverage; total cost is unknown.", "Pi 通过多轮工具调用收集证据，每轮复核最多 100 次请求；重复查询没有进展时会暂停。这仍是选择性覆盖，总费用未知。")}</p>}
            <p className="memo-confirm-hint">{t(`${agentPlan.jobIds.length} of ${MEMO_AGENT_MAX_REQUESTS} requests recorded; ${remainingAgentRequests(agentPlan)} remaining. Continuing or restoring a backup does not reset this count.`, `已记录 ${agentPlan.jobIds.length} / ${MEMO_AGENT_MAX_REQUESTS} 次请求；剩余 ${remainingAgentRequests(agentPlan)} 次。继续复核或恢复备份不会重置次数。`)}</p>
            <p className="memo-confirm-hint">{t("Space is checked before each request. If the meeting record fills, review pauses and saved responses remain.", "每次请求前都会检查空间；会议记录空间不足时复核会暂停，已保存的回应仍保留。")}</p>
            <details className="memo-confirm-details"><summary>{t("Review limits", "复核限制")}</summary><p>{t("Request or save failure stops the run. Reload never resumes it automatically. Limits: 256 KiB per request, 4 MiB per response, 8 KiB per lookup.", "请求或保存失败即停止；重新加载不会自动恢复。限制：每次请求 256 KiB、每次回应 4 MiB、每次查询 8 KiB。")}</p></details>
          </> : <p className="memo-confirm-hint">{confirmation.agentPlanError ? t("Clear this option to choose standard memo generation.", "取消勾选即可使用标准纪要生成。") : t("Standard memo generation is selected.", "已选择标准纪要生成。")}</p>}
        </> : <p className="memo-confirm-hint">{t("Pi review supports OpenAI gpt-6-luna or OpenRouter openai/gpt-6-luna. Select an explicit route in Settings.", "Pi 复核支持 OpenAI gpt-6-luna 或 OpenRouter openai/gpt-6-luna。请在设置中选择明确路线。")}</p>}
      </section>

      <section className="memo-confirm-section memo-confirm-cost" aria-labelledby="memo-cost-title">
        <h3 id="memo-cost-title"><Icon glyph={Wallet} size="control" />{t("Cost & processing", "费用与处理")}</h3>
        <p>{localRecovery ? t("Local recovery makes no API request and creates no new provider charge. Previous attempts may already have been charged.", "本地恢复不会发送 API 请求，也不会产生新的服务商费用。之前的请求可能已经收费。") : t("API requests may incur charges. Keep this page open; cancellation does not guarantee remote processing or billing stops. The app does not automatically retry.", "API 请求可能产生费用。请保持页面打开；取消不保证远端处理或计费停止。应用不会自动重试。")}</p>
        {plan && !agentPlan && <p role="status">{t(`Long memo: ${plan.chunks.length} extraction requests and one synthesis request. ${plan.results.filter(Boolean).length} extraction steps are already saved. Total cost is unknown; each request may be charged. This confirmation authorizes the remaining steps in order. Any error stops the plan; reloading never resumes requests automatically.`, `长纪要：${plan.chunks.length} 次提取和 1 次合成。已保存 ${plan.results.filter(Boolean).length} 步提取。总费用未知，每次请求均可能收费。本次确认允许按顺序执行剩余步骤；出现错误即停止，重新加载不会自动恢复请求。`)}</p>}
        {!localRecovery && previousAttempts && <p>{t("Previous memo attempts may already be charged. Check provider billing; this confirmation submits a new paid request, not a free retry.", "之前的纪要请求可能已经收费。请核对服务商账单；本次确认将提交新的付费请求，不是免费重试。")}</p>}
        {savedFinal && !localRecovery && <div>
          <p className="memo-confirm-hint">{recoveryDescription}</p>
          {recoverButton}
        </div>}
        {needsRetryReview && <label className="checkbox-label confirmation-consent memo-confirm-checkbox"><input type="checkbox" checked={reviewedRetry} onChange={event => onReviewedRetry(event.target.checked)} /><span>{t("I reviewed the previous request outcome and billing. I authorize a new paid attempt for the unfinished step.", "我已核对之前请求的结果和账单，并允许为未完成步骤提交新的付费请求。")}</span></label>}
      </section>
    </div>
    <footer className="memo-confirm-footer">
      {!localRecovery && <p className="memo-confirm-safety">{t("API requests may incur charges; cancellation may not stop remote processing or billing.", "API 请求可能收费；取消可能无法停止远端处理或计费。")}{previousAttempts && ` ${t("Previous attempts may already be charged.", "之前的请求可能已经收费。")}`}</p>}
      {agentPlan && !localRecovery && <p className="memo-confirm-safety">{t("Up to 100 requests per review; total cost is unknown.", "每轮复核最多 100 次请求；总费用未知。")}</p>}
      {plan && !agentPlan && <p className="memo-confirm-safety">{t(`${plan.chunks.length - plan.results.filter(Boolean).length} extraction steps and one synthesis request remain; total cost is unknown.`, `还剩 ${plan.chunks.length - plan.results.filter(Boolean).length} 次提取和 1 次合成；总费用未知。`)}</p>}
      {needsRetryReview && !reviewedRetry && <p className="memo-confirm-blocker">{t("Review the previous request and billing in Cost & processing before continuing.", "继续前请在“费用与处理”中核对之前的请求和账单。")}</p>}
      {requestBlocked && <p className="memo-confirm-blocker" role="alert">{translateMessage(AGENT_REQUEST_LIMIT_MESSAGE, language)}</p>}
      {localRecovery && <p className="memo-confirm-hint">{t("A final response is saved. Recovering validates it locally; no additional provider request is allowed.", "最终回应已保存。恢复时仅在本地校验，不会再发送服务商请求。")}</p>}
      {planBlocked && <p className="memo-confirm-blocker" role="alert">{translateMessage(planError!, language)}</p>}
      {missingKey && !localRecovery && <p className="memo-confirm-blocker"><a href="#/settings" className="text-button" onClick={onClose}>{t("Add your key in Settings first", "请先在设置中添加密钥")}</a></p>}
      {!localRecovery && <label className="checkbox-label confirmation-consent memo-confirm-checkbox"><input type="checkbox" checked={costAcknowledged} onChange={event => onCostAcknowledged(event.target.checked)} /><span>{t("I understand the selected data will be sent and may incur API charges.", "我了解所选数据将被发送，并可能产生 API 费用。")}</span></label>}
      <div className="modal-actions">
        <Button type="button" className="button secondary" onClick={onClose}>{t("Cancel", "取消")}</Button>
        {localRecovery ? recoverButton : <Button type="button" className="button primary" disabled={!canGenerate} onClick={() => onGenerate("generate")}>{t("Generate new notes", "生成新版笔记")}</Button>}
      </div>
    </footer>
  </>;
}
