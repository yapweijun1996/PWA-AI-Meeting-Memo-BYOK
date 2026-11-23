import { expect, it } from "vitest";
import { createMeeting, segment, validateMeeting, type Meeting } from "../src/domain/model";
import { editMeeting, editSegment, undoEdit } from "../src/domain/operations";
import { buildPlaybackCaptions, playbackBoundaries, snapToPlaybackInterval } from "../src/domain/playback";
import { detectedOverlap, matchingOverlapNeighbors, recordingOverlap, retainRecordingOverlap } from "../src/domain/overlap-evidence";

const hash = "1".repeat(64), other = "2".repeat(64);
const evidence = { audioSha256: hash, source: "Synthetic overlap detector", intervals: [{start: 2, end: 2.5}, {start: 4, end: 5}] };
const audio = { name: "synthetic.mp3", type: "audio/mpeg", size: 1000, duration: 8, present: false, hash };
const source = segment("Protected source text", [], 1, 3);
const speaker = { id: crypto.randomUUID(), name: "Reviewed voice", confirmed: true, sourceLabels: [] };
function meeting(): Meeting {
  const m = createMeeting();
  return validateMeeting({ ...m, audio: {...audio, overlapEvidence: evidence}, speakers: [speaker], segments: [source],
    runs: [{id: crypto.randomUUID(), createdAt: m.createdAt, provider: "Synthetic", model: "Fixture", speakers: [], originalSegments: [source]}] });
}
it("accepts absent legacy evidence and rejects malformed, unbounded or wrongly bound evidence", () => {
  const m = meeting();
  expect(validateMeeting({...m, audio}).audio?.overlapEvidence).toBeUndefined();
  for (const patch of [{source:" "}, {source:"hidden\nline"}, {audioSha256:other}, {intervals:[{start:0,end:9}]},
    {intervals:[{start:1,end:1}]}, {intervals:[{start:-1,end:1}]}, {intervals:[{start:2,end:3},{start:1,end:2}]},
    {intervals:[{start:1,end:3},{start:2,end:4}]}, {intervals:Array(20001).fill({start:0,end:1})}])
    expect(() => validateMeeting({...m,audio:{...audio,overlapEvidence:{...evidence,...patch}}})).toThrow();
  expect(() => validateMeeting({...m,audio:{...m.audio,duration:null}})).toThrow();
  expect(() => validateMeeting({...m,audio:{...m.audio,chunked:{format:"mp3",chunkCount:2,totalSeconds:8,manifestSha256:other}}})).toThrow();
  expect(recordingOverlap({...audio, hash: other, overlapEvidence: evidence})).toBeUndefined();
  expect(retainRecordingOverlap(m.audio, {...audio, hash: other}).overlapEvidence).toBeUndefined();
  expect(retainRecordingOverlap(m.audio, {...audio, duration:2.5}).overlapEvidence?.intervals).toEqual([{start:2,end:2.5}]);
});
it("queries actual source intersections, exact playback boundaries and gaps", () => {
  for (const [start,end,result] of [[0,2,false],[2.5,4,false],[2.1,2.2,true],[1,3,true],[5,6,false]] as const)
    expect(detectedOverlap(evidence,start,end)).toBe(result);
  expect(detectedOverlap(evidence,null,null)).toBe(false);
  const boundaries = playbackBoundaries([source],buildPlaybackCaptions([source]),evidence.intervals);
  for (const [time,expected] of [[1.99,false],[2,true],[2.49,true],[2.5,false]] as const)
    expect(detectedOverlap(evidence,snapToPlaybackInterval(boundaries,time))).toBe(expected);
});
it("keeps source timing evidence through edits, deletion and undo without changing attribution or the original run", () => {
  const m = meeting(), labelled = editSegment(m,source.id,{speakerIds:[speaker.id],text:"Human wording"});
  const moved = editMeeting(labelled,d => { d.segments = [segment("Replacement",[],6,7)]; });
  expect(detectedOverlap(recordingOverlap(moved.audio),moved.segments[0]!.start,moved.segments[0]!.end)).toBe(false);
  const restored = undoEdit(moved);
  expect(restored.segments[0]!.speakerIds).toEqual([speaker.id]);
  expect(restored.segments[0]!.text).toBe("Human wording");
  expect(restored.runs).toEqual(m.runs);
  expect(restored.audio?.overlapEvidence).toEqual(evidence);
  expect(undoEdit(restored).segments[0]!.speakerIds).toEqual([]);
});
it("identifies only equal single-speaker neighbors of the current unknown overlapping passage", () => {
  const m = meeting();
  const left = segment("Before", [speaker.id], 0, 1), right = segment("After", [speaker.id], 3, 4);
  m.segments = [left,source,right];
  expect(matchingOverlapNeighbors(m,source,1)).toBe("Reviewed voice");
  expect(matchingOverlapNeighbors(m,{...source,speakerIds:[speaker.id]},1)).toBeUndefined();
  right.speakerIds = [crypto.randomUUID()];
  expect(matchingOverlapNeighbors(m,source,1)).toBeUndefined();
  right.speakerIds = left.speakerIds;
  m.audio = audio;
  expect(matchingOverlapNeighbors(m,source,1)).toBeUndefined();
});
