import {ref, validateMeeting, type Meeting} from "./model";

/** Preview only: retain every distinct revision, provider output, memo and note-edit undo. */
export function previewHistoryCleanup(meeting: Meeting) {
  validateMeeting(meeting);
  if (meeting.jobs.some(job => job.state === "in_flight"))
    throw new Error("Finish the active request before reducing local history.");
  const seen = new Set(meeting.segments.map(ref));
  const history = meeting.history.filter(source => {
    const key = ref(source);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const result = validateMeeting({...meeting, undo: [], history});
  const encoder = new TextEncoder();
  return {
    version: meeting.version,
    undoCount: meeting.undo.length,
    redundantHistoryCount: meeting.history.length - history.length,
    beforeBytes: encoder.encode(JSON.stringify(meeting)).byteLength,
    afterBytes: encoder.encode(JSON.stringify(result)).byteLength,
    result,
  };
}
