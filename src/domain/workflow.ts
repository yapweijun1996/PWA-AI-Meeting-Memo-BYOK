import type { Meeting } from "./model";

const label = (en: string, zh: string) => [en, zh] as const;

export const isMeetingCompleted = (m: Meeting) => {
    const latestMemo = m.memos.at(-1);
    return Boolean(
      latestMemo?.items.length &&
        latestMemo.items.some((i) => i.review === "accepted") &&
        latestMemo.items.every(
          (i) =>
            i.review === "rejected" ||
            (i.review === "accepted" && i.reviewedRevision === m.revision),
        ) &&
        m.segments.every((s) => s.reviewed),
    );
  };
export const doesMeetingNeedReview = (m: Meeting) => {
    if (isMeetingCompleted(m)) return false;
    const latestJob = m.jobs.at(-1);
    if (
      latestJob &&
      (latestJob.state === "failed" ||
        latestJob.state === "outcome_unknown" ||
        latestJob.state === "failed_before_send")
    )
      return true;
    return (
      m.segments.some((s) => !s.reviewed) ||
      m.speakers.some((s) => !s.confirmed) ||
      Boolean(
        m.memos
          .at(-1)
          ?.items.some(
            (i) => i.review === "pending" || i.reviewedRevision !== m.revision,
          ),
      )
    );
  };
export const getMeetingWorkflow = (m: Meeting) => {
    const latestJob = m.jobs.at(-1);
    if (m.jobs.some((j) => j.state === "in_flight")) {
      return {
        badge: label("Transcribing", "处理中"),
        tone: "sand" as const,
        stage: label("Processing in progress", "正在处理请求"),
        cta: label("View", "查看"),
      };
    }
    if (
      latestJob &&
      (latestJob.state === "failed" ||
        latestJob.state === "outcome_unknown" ||
        latestJob.state === "failed_before_send")
    ) {
      return {
        badge: label("Failed", "失败"),
        tone: "sand" as const,
        stage:
          latestJob.state === "outcome_unknown"
            ? label("Outcome unknown", "结果未知")
            : label("Request failed", "请求失败"),
        cta: label("Review", "审阅"),
      };
    }
    if (isMeetingCompleted(m)) {
      return {
        badge: label("Ready", "已完成"),
        tone: "green" as const,
        stage: label("Completed notes", "已完成笔记"),
        cta: label("Open", "打开"),
      };
    }
    if (m.memos.length > 0) {
      return {
        badge: label("Needs review", "需要审阅"),
        tone: "sand" as const,
        stage: label("Draft notes", "笔记草稿"),
        cta: label("Review", "审阅"),
      };
    }
    if (m.segments.length > 0) {
      return {
        badge: label("Needs review", "需要审阅"),
        tone: "sand" as const,
        stage: label("Review transcript", "审阅转录"),
        cta: label("Review", "审阅"),
      };
    }
    if (m.audio) {
      return {
        badge: label("Recording", "录音就绪"),
        tone: "neutral" as const,
        stage: label("Ready to transcribe", "准备转录"),
        cta: label("Transcribe", "转录"),
      };
    }
    return {
      badge: label("Ready", "就绪"),
      tone: "neutral" as const,
      stage: label("Ready to start", "准备开始"),
      cta: label("Start", "开始"),
    };
  };
