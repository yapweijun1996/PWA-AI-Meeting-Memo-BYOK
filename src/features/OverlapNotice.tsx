import type { OverlapEvidence } from "../domain/overlap-evidence";

export function OverlapNotice({ evidence, unknown, t }: {
  evidence: OverlapEvidence;
  unknown: boolean;
  t: (english: string, chinese: string) => string;
}) {
  return <span className="small overlap-notice" data-overlap-evidence={unknown ? "unattributed" : "attributed"}>
    {unknown ? t("Overlapping speech detected · words unattributed", "检测到局部重叠，文字归属待定")
      : t("Overlapping speech detected", "检测到局部重叠")}
    <small> · {evidence.source}</small>
  </span>;
}
