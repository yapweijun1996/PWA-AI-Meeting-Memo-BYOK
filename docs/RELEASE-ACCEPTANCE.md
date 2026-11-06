# Owner acceptance pack

Updated 2026-11-06. This is the procedure for the remaining external gates in task.md, not a record that those gates passed. Use the exact deployed build shown in Settings. Keep real recordings, annotations, account exports and screenshots containing keys outside Git and KB.

## Result record

For every case record: build SHA, date, device, OS, browser/version, installed or browser mode, UI language, anonymous fixture/run ID, PASS/FAIL/NOT RUN/N/A, expected/observed behavior and sanitized evidence. A missing device is NOT RUN. Failures remain open until repaired and retested. Automated WebKit is not an iPhone certificate.

Use English and Simplified Chinese for the core flows. Test iPhone Safari and standalone, Android Chrome and installed PWA, VoiceOver and TalkBack. Use a separate synthetic meeting before testing private audio. Do not clear site storage to resolve an update or save failure.

## Device and accessibility cases

| ID | Steps | Expected result |
| --- | --- | --- |
| D01 | Install from the published project URL; launch and refresh a meeting hash route | Correct app, icons, scope and saved meeting; no backend required |
| D02 | Rotate, open the keyboard, zoom, use 320/390px-equivalent layouts | Controls remain reachable; safe areas and fixed player do not cover the editor; primary actions remain touchable |
| D03 | Play, pause, seek forward/back, change rate, jump from a caption | One recording clock drives speaker, caption and highlight; paused attribution does not claim live speech |
| D04 | Inspect overlap, real silence, a short word gap and unknown time | All exact active labels remain visible; short-gap context is inactive; unknown time has no fabricated cue |
| D05 | Browse transcript manually, then resume following | Following pauses without moving focus and resumes only through the explicit action |
| D06 | Edit a speaker name, switch modes, edit reference URL/offset | Name draft is protected; unsaved reference must be saved or reset; position remains consistent |
| D07 | Use VoiceOver/TalkBack and keyboard navigation | Names, states and errors are understandable; no repeated ticking/caption announcements; modal focus returns predictably |
| D08 | Enable reduced motion; increase captions | No speech pulse when paused or reduced motion applies; readable captions and non-color state cues |
| D09 | Suspend and reopen the phone during local editing and playback | Saved work survives; media/processing status reflects actual browser behavior, without promised background execution |
| D10 | Go offline after the shell and meeting are saved | Local review/play/edit/export works; cloud requests remain unavailable; reference video requires a connection |
| D11 | Open a new release with a dirty editor or active request | No automatic reload; draft/request protection; explicit update progress and recoverable failure |
| D12 | Restore full backup as a new copy; open missing-audio JSON | Sources and human edits survive; absent audio is explicit; keys are absent |

## Production provider and billing cases

Use the deployed origin and the owner's existing provider-specific BYOK settings. Saving keys or choosing a preset must send nothing. Do not copy a key from local development into another origin implicitly.

| ID | Procedure | Evidence needed |
| --- | --- | --- |
| P01 | Reconcile historical test reservations and ambiguous requests | Provider statement/usage record, request IDs where available, currency/unit, known versus unknown charges; sanitized totals only |
| P02 | Submit one authorized short consented speaker-aware recording | Exact provider/model, supported format, preflight/method/header names, readable response and preserved speaker/time output |
| P03 | Generate a current single-request memo | Actual fragment-array transport, readable final response, valid original references and human review |
| P04 | Confirm a bounded long-memo plan | Request count/destination/cost disclosure; successful per-request checkpoints and original citations after synthesis |
| P05 | Compare processing history with provider records | Usage and reported amounts stay separate from estimates; no parent/child double count; unexplained amounts remain unknown |
| P06 | Review remaining selectable provider/model paths | Mark each verified, limited, unavailable or unverified; text-only success never satisfies mandatory speaker detection |

Do not deliberately reproduce billable failures. CI already exercises rejection, disconnect, cancellation and timeout using synthetic responses. The cumulative test ceiling is US$10, including historical calls. US$4.85 is the last documented protective reservation, not an invoice or verified spend. No new paid acceptance run is authorized by a successful mocked test. Before a new test, reconcile the private ledgers, account for uncertain attempts and reserve a conservative maximum. If a safe bound cannot be established, stop paid testing and leave its gate open.

## Private annotated quality set

Prepare at least eight consented 1–3 minute clips spanning English, Chinese, code switching, Singlish, ERP terms, 2–5 speakers, similar voices, short replies, noise, overlap and silence. Also retain one long recording for continuity and correction-time measurement. Reuse completed provider results where applicable. Do not infer real names or use automatic face/voice identification.

Annotate reference text, anonymous speaker turns, positively reviewed time ranges and uncertainty. Freeze the protocol before comparing model runs. Combine excerpts from the same provider run under one run ID and timeline so label mapping is global, not optimized anew for every sentence. Document single-reviewer limitations; disagreements remain unknown rather than guessed ground truth.

Run the offline arithmetic tool with a private JSON file:

```sh
node scripts/evaluate-speech-annotations.mjs /path/to/private-annotations.json
```

Input shape:

```json
{
  "schemaVersion": 1,
  "runs": [{
    "id": "anonymous_run_01",
    "language": "en",
    "referenceText": "one two",
    "hypothesisText": "one three",
    "referenceTurns": [{"start": 0, "end": 1, "speaker": "A"}],
    "hypothesisTurns": [{"start": 0, "end": 1, "speaker": "model_0"}],
    "evaluatedRanges": [{"start": 0, "end": 2}]
  }]
}
```

The CLI makes no requests, writes no file and prints no transcript or speaker names. It accepts at most 30 runs, 5 labels per side, 1,000 intervals per array, 5,000 normalized text units and a 2 MiB document. Text uses NFKC, lower case, punctuation/symbol-to-space normalization; English is whitespace-token WER and Chinese is non-whitespace-character CER. Mixed-language scores must state that normalization and be reviewed alongside the original text.

Diarization uses one optimal label assignment per run, no timing collar, overlap-inclusive reference speaker-seconds and only explicitly evaluated ranges. Miss, false-alarm and confusion durations are separate. Silence inside evaluated ranges counts for false alarms; unannotated ranges are excluded, not declared correct. Unknown-output coverage must be annotated separately; the tool cannot distinguish silence from an unknown model label automatically. A zero denominator returns null. Synthetic arithmetic tests are not model accuracy evidence.

Record number/date/amount/ERP-term errors, timing error samples, unknown coverage, provider runtime, actual/unknown cost, correction seconds and the same person's manual baseline separately. Use the existing citation evaluation rubric for memo support and omitted important facts. A structurally valid citation is not proof of support. Final usability is the owner's sign-off with the report, not a fabricated accuracy threshold.

## Resource limits and audio splitting

Current production policy remains one original recording, local import up to 50 MiB and one transcription upload up to 25,000,000 bytes. These are rejection limits, not measured universal phone capacities. Measure import/checksum/save/play/backup time near each boundary, invalid containers, unknown MIME, quota denial, suspension and missing audio. Record memory only when the platform exposes a suitable measurement; otherwise mark unavailable.

Automatic audio splitting stays deferred. A future spike must demonstrate independently decodable containers, original timeline offsets/encoder delay, channel preservation, boundary repeats and independently scoped chunk labels. Never use arbitrary Blob byte slices, text-similarity deletion of repeated speech or automatic merging of same-named chunk speakers. Cross-chunk mapping is N/A for the shipped single-file path, while physical device/resource limits remain open V06 evidence. No full-file long PCM decoding is introduced.

## Completion ownership

The developer supplies tested code, synthetic evidence, compatible backup/update behavior and this pack. The owner supplies device results, consented annotations, provider billing evidence and usability sign-off. R08 is complete only after the applicable roadmap matrix has evidence. Passing builds or deployment cannot close missing real-data/device gates.
