import {
  id,
  ref,
  validateMeeting,
  type Meeting,
  type Segment,
  type Speaker,
} from "./model";
export function editMeeting(
  m: Meeting,
  change: (draft: Meeting) => void,
): Meeting {
  const draft = structuredClone(m);
  draft.undo = [
    ...m.undo,
    {
      title: m.title,
      date: m.date,
      timezone: m.timezone,
      speakers: structuredClone(m.speakers),
      segments: structuredClone(m.segments),
      speakerLinks: structuredClone(m.speakerLinks),
    },
  ].slice(-20);
  const existing = new Set(draft.history.map(ref));
  for (const s of m.segments)
    if (!existing.has(ref(s))) draft.history.push(structuredClone(s));
  change(draft);
  draft.revision = m.revision + 1;
  return validateMeeting(draft);
}
function nextRevision(m: Meeting, s: Segment) {
  return (
    Math.max(
      s.revision,
      ...m.history.filter((h) => h.id === s.id).map((h) => h.revision),
    ) + 1
  );
}
export function editSegment(
  m: Meeting,
  segmentId: string,
  patch: Partial<Pick<Segment, "text" | "speakerIds" | "reviewed">>,
): Meeting {
  return editMeeting(m, (d) => {
    d.segments = d.segments.map((s) =>
      s.id === segmentId
        ? { ...s, ...patch, revision: nextRevision(m, s), parents: [ref(s)] }
        : s,
    );
  });
}
export function reviewSegments(m: Meeting, ids: string[], reviewed: boolean): Meeting {
  const targets = new Set(ids);
  return editMeeting(m, (draft) => {
    draft.segments = draft.segments.map((segment) =>
      targets.has(segment.id) && segment.reviewed !== reviewed
        ? { ...segment, reviewed, revision: nextRevision(m, segment), parents: [ref(segment)] }
        : segment,
    );
  });
}
export function assignSegments(
  m: Meeting,
  ids: string[],
  speakerIds: string[],
): Meeting {
  if (!ids.length) throw new Error("Select at least one passage.");
  return editMeeting(m, (d) => {
    d.segments = d.segments.map((s) =>
      ids.includes(s.id)
        ? {
            ...s,
            speakerIds,
            reviewed: false,
            revision: nextRevision(m, s),
            parents: [ref(s)],
          }
        : s,
    );
  });
}
function mergeSpeakerGroupsInDraft(d: Meeting, groups: string[][]): void {
  const replacements = new Map<string, string>();
  const consumed = new Set<string>();
  for (const group of groups) {
    const [targetId, ...sourceIds] = group;
    const target = d.speakers.find((speaker) => speaker.id === targetId);
    if (!target) throw new Error("Speaker no longer exists.");
    const sources = sourceIds.map((sourceId) => {
      const source = d.speakers.find((speaker) => speaker.id === sourceId);
      if (!source) throw new Error("Speaker no longer exists.");
      replacements.set(sourceId, targetId);
      return source;
    });
    for (const speakerId of group) consumed.add(speakerId);
    target.sourceLabels = [...new Set([...target.sourceLabels, ...sources.flatMap((source) => source.sourceLabels)])];
    target.confirmed = false;
  }
  d.speakers = d.speakers.filter((speaker) => !replacements.has(speaker.id));
  d.segments = d.segments.map((segment) => {
    if (!segment.speakerIds.some((speakerId) => replacements.has(speakerId))) return segment;
    return {
      ...segment,
      speakerIds: [...new Set(segment.speakerIds.map((speakerId) => replacements.get(speakerId) ?? speakerId))],
      revision: nextRevision(d, segment),
      reviewed: false,
      parents: [ref(segment)],
    };
  });
  d.speakerLinks = d.speakerLinks?.filter((link) => !consumed.has(link.fromSpeakerId) && !consumed.has(link.toSpeakerId));
}

export function mergeSpeakerGroups(m: Meeting, groups: string[][]): Meeting {
  if (!groups.length || groups.some((group) => group.length < 2))
    throw new Error("Each merge group needs at least two speakers.");
  const used = new Set<string>();
  for (const group of groups) for (const speakerId of group) {
    if (used.has(speakerId)) throw new Error("A speaker can appear only once.");
    used.add(speakerId);
    if (!m.speakers.some((speaker) => speaker.id === speakerId)) throw new Error("Speaker no longer exists.");
  }
  return editMeeting(m, (draft) => mergeSpeakerGroupsInDraft(draft, groups));
}

export function mergeSpeakers(m: Meeting, from: string, into: string): Meeting {
  if (from === into) throw new Error("Select two different speakers.");
  return mergeSpeakerGroups(m, [[into, from]]);
}
export function splitSegment(
  m: Meeting,
  segmentId: string,
  at: number,
  boundary: number | null,
): Meeting {
  return editMeeting(m, (d) => {
    const index = d.segments.findIndex((s) => s.id === segmentId),
      s = d.segments[index];
    if (!s || at <= 0 || at >= s.text.length)
      throw new Error("Choose a split inside the passage.");
    if (
      boundary !== null &&
      (s.start === null ||
        s.end === null ||
        boundary <= s.start ||
        boundary >= s.end)
    )
      throw new Error("Split time must be inside the original range.");
    const a = {
      ...s,
      id: id(),
      revision: 1,
      text: s.text.slice(0, at).trim(),
      start: boundary === null ? null : s.start,
      end: boundary,
      parents: [ref(s)],
      reviewed: false,
    };
    const b = {
      ...s,
      id: id(),
      revision: 1,
      text: s.text.slice(at).trim(),
      start: boundary,
      end: boundary === null ? null : s.end,
      parents: [ref(s)],
      reviewed: false,
    };
    if (!a.text || !b.text) throw new Error("Each new passage needs text.");
    d.segments.splice(index, 1, a, b);
  });
}
export function undoEdit(m: Meeting): Meeting {
  const snapshot = m.undo.at(-1);
  if (!snapshot) throw new Error("No edit to undo.");
  const next = editMeeting(m, (d) => {
    Object.assign(d, structuredClone(snapshot));
  });
  next.undo = m.undo.slice(0, -1);
  // Restoring content is a new source revision; old memo versions still need review.
  return next;
}
export function replaceTranscript(
  m: Meeting,
  speakers: Speaker[],
  segments: Segment[],
  provider: string,
  model: string,
  options: {
    runId?: string;
    originalSpeakers?: Speaker[];
    originalSegments?: Segment[];
  } = {},
): Meeting {
  return editMeeting(m, (d) => {
    d.speakers = speakers;
    d.segments = segments;
    d.speakerLinks = undefined;
    d.runs.push({
      id: options.runId ?? id(),
      provider,
      model,
      createdAt: new Date().toISOString(),
      speakers: structuredClone(options.originalSpeakers ?? speakers),
      originalSegments: structuredClone(options.originalSegments ?? segments),
    });
  });
}
export function resolveSource(
  m: Meeting,
  source: { id: string; revision: number },
): Segment | undefined {
  return [...m.segments, ...m.history].find((s) => ref(s) === ref(source));
}
export const speakerName = (m: Meeting, ids: string[]) =>
  ids.length
    ? ids
        .map(
          (id) =>
            m.speakers.find((s) => s.id === id)?.name || "Historical speaker",
        )
        .join(" + ")
    : "Unknown speaker";
export function markdown(m: Meeting, selectedVersionId?: string): string {
  const lines = [`# ${m.title}`, `${m.date} · ${m.timezone}`, ""];
  const memo =
    m.memos.find((v) => v.id === selectedVersionId) || m.memos.at(-1);
  if (memo) {
    lines.push(
      `## Meeting memo${memo.sourceRevision !== m.revision && memo.items.some((i) => i.reviewedRevision !== m.revision) ? " — source changed; re-review required" : ""}`,
      "",
    );
    for (const item of memo.items.filter((i) => i.review !== "rejected")) {
      lines.push(
        `### ${item.type} · ${item.review}`,
        item.text,
        `Owner: ${item.ownerId ? speakerName(m, [item.ownerId]) : "To confirm"} | Due: ${item.dueDate || "To confirm"}`,
        `Sources: ${item.sources.map(ref).join(", ")}`,
        "",
      );
    }
  }
  lines.push("## Transcript", "");
  for (const s of m.segments)
    lines.push(
      `**${speakerName(m, s.speakerIds)}**${s.start === null ? " · time unknown" : ` · ${formatTime(s.start)}`}\n${s.text}`,
      "",
    );
  return lines.join("\n");
}
export const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
