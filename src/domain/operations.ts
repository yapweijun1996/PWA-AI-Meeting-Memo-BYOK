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
export function mergeSpeakers(m: Meeting, from: string, into: string): Meeting {
  if (from === into) throw new Error("Select two different speakers.");
  return editMeeting(m, (d) => {
    const source = d.speakers.find((s) => s.id === from),
      target = d.speakers.find((s) => s.id === into);
    if (!source || !target) throw new Error("Speaker no longer exists.");
    target.sourceLabels = [
      ...new Set([...target.sourceLabels, ...source.sourceLabels]),
    ];
    target.confirmed = false;
    d.speakers = d.speakers.filter((s) => s.id !== from);
    d.segments = d.segments.map((s) =>
      s.speakerIds.includes(from)
        ? {
            ...s,
            speakerIds: [
              ...new Set(s.speakerIds.map((x) => (x === from ? into : x))),
            ],
            revision: nextRevision(m, s),
            reviewed: false,
            parents: [ref(s)],
          }
        : s,
    );
  });
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
): Meeting {
  return editMeeting(m, (d) => {
    d.speakers = speakers;
    d.segments = segments;
    d.runs.push({
      id: id(),
      provider,
      model,
      createdAt: new Date().toISOString(),
      speakers: structuredClone(speakers),
      originalSegments: structuredClone(segments),
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
export function markdown(m: Meeting): string {
  const lines = [`# ${m.title}`, `${m.date} · ${m.timezone}`, ""];
  const memo = m.memos.at(-1);
  if (memo) {
    lines.push(
      `## Meeting memo${memo.sourceRevision !== m.revision ? " — source changed; re-review required" : ""}`,
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
