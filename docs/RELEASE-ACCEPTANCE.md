# Owner acceptance pack

Updated 2026-11-22. This is the procedure for the remaining external gates in task.md, not a record that those gates passed. Use the exact deployed build shown in Settings. Keep real recordings, annotations, account exports and screenshots containing keys outside Git and KB.

## Result record

For every case record: build SHA, date, device, OS, browser/version, installed or browser mode, UI language, anonymous fixture/run ID, PASS/FAIL/NOT RUN/N/A, expected/observed behavior and sanitized evidence. A missing device is NOT RUN. Failures remain open until repaired and retested. Automated WebKit is not an iPhone certificate.

Use English and Simplified Chinese for the core flows. Test iPhone Safari and standalone, Android Chrome and installed PWA, VoiceOver and TalkBack. Use a separate synthetic meeting before testing private audio. Do not clear site storage to resolve an update or save failure.

Create the transferable synthetic full backup with the pinned Node runtime:

```sh
node scripts/create-acceptance-fixture.mjs private-fixtures/owner-acceptance
```

Transfer `synthetic-playback.zip` to the device and use Restore backup. It contains eight seconds of low/high tones, authored timing/overlap/gaps, an untimed note and a clearly labeled authored memo. It contains no people, recognized speech, credentials or paid attempts. It exercises playback, review and restore; it cannot establish recognition accuracy. The generator refuses to overwrite an existing archive. Generated archives remain outside Git and the production artifact.

## Local browser release checks

Use the Node version in `.node-version` and a static build. The lifecycle test covers Chromium and WebKit with real workers and synthetic local data. It verifies offline reload, explicit activation, draft and request protection, cache isolation, and recovery when activation stalls.

```sh
npm ci
npx playwright install chromium webkit
npm run build
npm run check:artifact
npm run test:pwa
```

Prepare two artifacts from the same clean checkout with different build IDs, or use exported artifacts from the baseline and candidate release. The test server serves a real candidate worker and injects baseline HTML or baseline entry JavaScript into separate install attempts. Each attempt must fail, preserve the old and unrelated caches, and allow an offline launch of the baseline. Once every file matches the candidate, the worker must wait for confirmation and the updated app must launch offline.

```sh
pwa_acceptance_dir=$(mktemp -d) &&
VITE_BUILD_ID=pwa-baseline npm run build &&
mv dist "$pwa_acceptance_dir/baseline" &&
VITE_BUILD_ID=pwa-candidate npm run build &&
mv dist "$pwa_acceptance_dir/candidate" &&
node scripts/test-pwa-install-integrity.mjs "$pwa_acceptance_dir/baseline" "$pwa_acceptance_dir/candidate"
```

Run the install-integrity check separately from `test:pwa`. A nonzero exit records a failed gate. The two static artifacts exercise the generated workers and their actual release identities.

**2026-11-22 local result.** Node 22.23.3 on macOS 27.2, Chromium 156.0.8078.4 and WebKit 27.2. Before the fix, both engines accepted stale HTML during the `be16b1c` → `085a7bc` upgrade. The fixed candidate used source from `b7b109e` plus the install-integrity patch, with `VITE_BUILD_ID=pwa-install-integrity-candidate`. The baseline worker reported `edfeb98edf747296` and the fixed worker reported `77a71bfe36e9f2db`. The candidate passed 702 unit tests in 77 files, lint, SSOT, the production build/type check and artifact verification. A separate build from the working tree at base `6fbb904` also passed the artifact check and both browsers’ two-build test (worker `6d03f5ef64cf95c8`).

| Assertion on the local static origin | Chromium | WebKit |
| --- | --- | --- |
| Reject old HTML and old entry JS independently, each served with HTTP 200 at the candidate URL | PASS | PASS |
| Discard a newly created candidate cache on rejection, and preserve a pre-existing same-version cache and an unrelated cache | PASS | PASS |
| Launch the old app offline after rejection, wait for explicit confirmation of the coherent upgrade, then launch the new app offline | PASS | PASS |
| Protect active requests and unsaved edits, retain the saved correction across activation and recover from a stalled update | PASS | PASS |

The local production candidate also passed an update during a queued **Accept** decision. With a previous Fact status write held, Chromium and WebKit committed the accepted review before reloading. An injected Accept write failure kept the page open, retained the earlier edit and allowed retry. Both cases preserved the original generated item and allowed reversing the decision with **Needs review**. The fixture simulates worker activation and uses real IndexedDB transactions. [Browser regressions](../tests/browser/sidebar-confirmation.spec.ts#L522)

GitHub Pages delivery of this fix and physical-device installation remain separate acceptance cases. Retention of every asset used by an older open tab when a second waiting worker supersedes the first also needs a separate check.

| Known gap | Current evidence |
| --- | --- |
| A Pi receipt near the ZIP limit | A previous near-limit fixture reproduced an export refusal after a Pi receipt. [BUG-051](../BUGS.md#2026-11-22-pi-memo-audit-and-release-review) |

## Forward recovery and support rehearsal

Engineering ran F6 and F7 on 2026-11-22 with Node 22.23.3 on macOS, Chromium 156.0.8078.4 and WebKit 27.2. The isolated static origin served a local copy of the published `ee188bc` release (worker `1711568a606292cc`) and the working-tree candidate `local-45df3fb-production-voice-validated` (worker `1319c034547437e9`). The candidate label identifies this local artifact. [Published build record](https://github.com/yapweijun1996/PWA-AI-Meeting-Memo-BYOK/actions/runs/45034968825)

- **Forward recovery passed in both engines.** The original app saved a transcript correction, one mock memo receipt with an unknown outcome, and a ZIP. Each browser rejected the mixed release, launched the original shell offline, then installed the coherent replacement after explicit confirmation. After the upgrade, meeting ID, schema version, revision, source segments, edit history and jobs matched the original archive. Restoring that archive created a new meeting ID with the same source revisions and receipt. The next submission stayed disabled until a separate billing-review acknowledgment, and the intercepted attempt count stayed at one. The rehearsal used a transcript-only fixture and existing storage schemas. [Two-build fixture](../scripts/test-pwa-install-integrity.mjs) · [Recovery assertions](../scripts/test-pwa-recovery-fixture.mjs)
- **Support triage passed in both engines.** Settings → About displayed the complete published commit `ee188bc094df4cfa06a33977f22f9e407a1753fa`, which matched the loaded module and the release record. The workspace identified a memo with an unknown outcome, possible charges and an instruction to check the provider account before retrying. A separate mock HTTP 401 showed a failed memo, possible charges and an instruction to check the key for the selected provider. The diagnostic record contained the build, browser/version, stage, outcome, billing state and error category. All inputs were synthetic and all provider submissions were intercepted locally. [Support procedure](DEPLOYMENT.md#diagnose-a-failed-provider-request) · [HTTP rejection regression](../tests/browser/providers.spec.ts)

To repeat the cross-build rehearsal, append `--rehearse-recovery` to the two-artifact install-integrity command above. Supply builds with different public build IDs.

## Desktop keyboard and accessibility tree

On 2026-11-23 a separate headless Chrome 158.0.8127.37 profile on macOS 27.2 opened static worker `89ee32e7bbcff7fc` with a synthetic reviewed-meeting fixture. Keyboard navigation selected the notes tab, activated Evidence Review, opened a frozen source citation, closed it with Escape, edited and accepted the note, then downloaded Markdown containing the accepted edit. Chromium's renderer accessibility tree exposed the review button's pressed state, citation focus, named source dialog and heading, source text, editing field and focused export action. Focus returned to the citation after the dialog closed. The app rendered light mode in both system-preference simulations. No external requests were observed.

Apple's USB device service and ADB both returned zero attached phones or tablets. The native macOS accessibility query targeted only the test browser process. Its headless window exposed no native web area. Physical VoiceOver and TalkBack speech, touch, zoom and dark-mode acceptance remain open.

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
| D13 | With a synthetic supported long recording, back up, restore as a new copy and reattach the identical original; also try a different file | Identical source is accepted without losing existing data; a different source is refused without replacing/deleting data. Both reattachment cases pass in desktop Chromium and WebKit. Physical-device acceptance is NOT RUN. |

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

Do not deliberately reproduce billable failures. CI already exercises rejection, disconnect, cancellation and timeout using synthetic responses. The owner's 2026-11-17 quality-first direction supersedes the former US$10 optimization ceiling for the new quality program; the historical US$4.85 reservation remains historical evidence, not verified spend. Do not omit necessary analysis or downgrade models to satisfy that old ceiling. Real evaluations still require consented inputs and approved provider/account use; a mock passing is not permission to submit private data. Reconcile unknown outcomes before any new submission and retain usage/billing transparency. Follow [the quality-first plan](QUALITY-FIRST-PLAN.md) and [human-reference evaluation contract](QUALITY-EVALUATION.md). No new live request was made for this documentation update.

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

The CLI makes no requests, writes no file and prints no transcript or speaker names. It accepts at most 30 runs, 50 anonymous speaker labels per side, 1,000 intervals per array, 5,000 normalized text units and a 2 MiB document. Text uses NFKC, lower case, punctuation/symbol-to-space normalization; English is whitespace-token WER and Chinese is non-whitespace-character CER. Mixed-language scores must state that normalization and be reviewed alongside the original text.

Diarization uses one optimal label assignment per run, no timing collar, overlap-inclusive reference speaker-seconds and only explicitly evaluated ranges. Miss, false-alarm and confusion durations are separate. Silence inside evaluated ranges counts for false alarms; unannotated ranges are excluded, not declared correct. Unknown-output coverage must be annotated separately; the tool cannot distinguish silence from an unknown model label automatically. A zero denominator returns null. Synthetic arithmetic tests are not model accuracy evidence.

Record number/date/amount/ERP-term errors, timing error samples, unknown coverage, provider runtime, actual/unknown cost, correction seconds and the same person's manual baseline separately. Use the existing citation evaluation rubric for memo support and omitted important facts. A structurally valid citation is not proof of support. Final usability is the owner's sign-off with the report, not a fabricated accuracy threshold.

## Resource limits and audio splitting

The repository routes recordings over 24,000,000 bytes to its long-import path, which accepts MP3/MPEG and supported M4A/MP4 up to a configured 4 GiB ceiling; each transcription upload is limited to 25,000,000 bytes. Unsupported long formats and unsupported MP4 variants are rejected. These are code limits, not measured universal phone capacities or proof of the currently deployed build. Measure import/checksum/save/play/backup time near each boundary, invalid containers, unknown MIME, quota denial, suspension and missing audio. Record memory only when the platform exposes a suitable measurement; otherwise mark unavailable.

Container-aware local splitting and sequential chunk processing exist, but valid independent chunks, original timeline offsets/encoder delay, channel preservation, boundary repeats and meeting-scoped acoustic continuity still require applicable acceptance evidence. Never use arbitrary Blob byte slices, text-similarity deletion of repeated speech or automatic merging of same-named chunk speakers as voice evidence. Chunked audio and separate per-chunk speech/acoustic records are excluded from backup. Restoring a copy and reattaching the identical recording recovers its audio. The app refuses another paid submission when a completed speech checkpoint required by the restored meeting is missing. Keep the original meeting for access to its checkpoints and keep the original recording. [Recovery evidence](VALIDATION.md) Physical device/resource limits remain open V06 evidence.

## Completion ownership

Engineering owns test execution, device coverage, independent reference evaluation and defect resolution. Normal operation requires no owner-assisted speaker enrollment, listening exercise or manual merge. End users can review and correct meeting facts. External provider tests require existing consent for the specific audio, destination and charges. Record unavailable devices and missing reference data as open gates. R08 closes when the applicable roadmap matrix has evidence.
