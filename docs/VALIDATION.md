# Validation record

Prior baseline date: 2026-11-04. Product: browser-first BYOK beta. Host used for local checks: Ubuntu 24.04 ARM64, Node 22.23.3, Playwright Chromium and WebKit. WebKit on Linux is not a physical iPhone.

## Authorized live API spike (2026-11-05)

The user authorized OpenAI and OpenRouter requests with a cumulative US$10 ceiling, including the earlier OpenAI transcription. These local Node API observations supersede the older account-access NOT RUN statements below only for the exact calls tested. They do not establish browser or full P0 acceptance.

Environment: Windows, Node 25.2.1 (outside the project's pinned Node 22 runtime), source HEAD `4bb395c8896202364b0171a1b2ab909a5782bcfb`. The user-supplied English MP3 was 24,390,812 bytes and 2,188.650688 seconds. The comparison harness transpiled and reused the unchanged application provider/domain modules, with explicit selections instead of browser settings. Raw results, source hashes, normalized notes and the budget ledger remain local under Git-ignored `private-fixtures/spike/`; no keys or transcript contents are recorded here.

| Request | Observed outcome | Elapsed time | Usage / cost |
| --- | --- | --- | --- |
| OpenAI `gpt-transcribe` | HTTP 200; 37,612 characters; no speaker/time fields | 41.64 s | 2,189 reported seconds; approximately US$0.1642 at the published rate, not a returned invoice |
| OpenRouter `elevenlabs/scribe-v2` | HTTP 200; 7,227 timed words and five anonymous speaker labels; application normalization FAIL | 39.54 s including response capture | Provider-reported `usage.cost`: US$0.1337508753471979 |
| OpenAI `gpt-6-luna` Responses | HTTP 200; eight memo items passed application validation | 17.21 s | 8,668 input / 1,644 output tokens; estimated below US$0.003 including reported cache writes |
| OpenRouter `openai/gpt-6-luna` Responses | HTTP 200; eight memo items passed application validation | 12.44 s | 8,668 input / 1,270 output tokens; provider-reported `usage.cost`: US$0.001718425 |

The two memo requests used the same complete OpenAI transcript and identical source IDs. Both produced one summary, five discussion items, one question and one risk; all references resolved to the input revision, all owners/dates remained unknown, and every item remained pending human review. This is structural evidence, not an independently scored factual-accuracy result. The untimed OpenAI transcript normalized to two broad passages, so those citations do not establish precise audio playback references.

**Scribe integration finding:** 39 returned words had equal start/end timestamps. The current normalizer rejected the complete response despite successful paid processing. An offline diagnostic removing only those words made normalization pass for the remaining 7,188 words; the original response was unchanged. Removing words was solely a cause-isolation experiment, not an accepted transcript or production fix. Five provider labels do not prove five correctly separated real speakers. The application integration remains unverified until lossless handling of this response is implemented and tested.

Each paid operation was submitted once, with no automatic retries. A concurrent second harness process was rejected before networking. Conservative reservations totaled US$1.45, retained even for the rejected Scribe result. OpenRouter reported US$0.1354693003471979 across its two calls; combined with estimated OpenAI charges, the cumulative test cost is approximately US$0.30, below the authorized ceiling. OpenAI did not return a dollar charge; provider billing records remain authoritative. Pricing references: [OpenAI pricing](https://developers.openai.com/api/docs/pricing), [Scribe pricing](https://openrouter.ai/elevenlabs/scribe-v2), [OpenRouter Luna pricing](https://openrouter.ai/openai/gpt-6-luna).

Unauthenticated OPTIONS probes for both providers' transcription and Responses endpoints accepted the production origin's POST/authorization/content-type preflight. These were Node probes; authenticated browser POST CORS, the published application workflow, real audio/speaker accuracy, mixed-language performance and physical devices remain NOT RUN in this spike. No application source changes, commit, push or deployment were performed.

## Scribe compatibility and memo review follow-up (2026-11-05)

Local implementation now preserves equal-start/end words and segments with unknown timing instead of rejecting the entire transcript. Text, original text and anonymous speaker labels remain intact; valid ranges are unchanged and negative, nonfinite or reversed ranges are still rejected. The domain schema, storage format and paid-request policy are unchanged.

Verification used the pinned Node 22.23.3 on Windows (official archive checksum verified):

- PASS: 43 unit tests, ESLint, TypeScript, production build and static artifact check.
- PASS: replaying the unchanged real Scribe response preserves all 7,227 words in order, their original text and five anonymous labels. All 7,188 positive-duration ranges are unchanged; 39 zero-duration words have null/null timing. Domain validation and a meeting JSON round-trip pass. No word was filtered out.
- PASS: the dedicated synthetic zero-width regression in Chromium and Windows WebKit verifies all three sample words, disabled playback for the unknown range, enabled controls for timed neighbors, persistence after reload and exactly one mocked submission.
- PASS: the broader recording-to-reviewed-memo/export/restore workflow in Chromium.
- FAIL, baseline also fails: the broader workflow in Windows WebKit exports the edited memo with review state `edited` instead of `accepted`. This reproduced with both the modified test and the original test, then with the original test against a separate build loading the original HEAD provider source. The failure is independent of zero-width normalization and remains an open Windows WebKit review/export issue. The focused transcript fix does not establish a fully passing browser release gate.
- NOT RUN: the entire browser/PWA update suite, authenticated production-browser requests, physical devices and audio/speaker accuracy evaluation in this follow-up.

The two existing memo outputs were reviewed item by item against their exact shared input. All 16 items are supported by the cited ASR transcript; 22 exact source excerpts were independently checked against their character offsets. This does not verify the ASR against audio or establish external truth. Both outputs keep owners/dates unknown, advice separate from assigned actions and all review states pending. OpenAI includes more numeric detail; OpenRouter is more concise. Both use the same underlying Luna model, so one example does not establish a general quality ranking. Robotics fine-tuning remains hypothetical in both source and summary.

The detailed memo review and replay evidence remain local in `private-fixtures/spike/memo-review.md`, `memo-review-evidence.json` and `fix-verification/report.json`. No new paid calls, changes to original provider outputs, commits, pushes or deployments were performed. The earlier test cost remains approximately US$0.30; the US$10 ceiling is unchanged.

## Actual Chrome UI smoke test (2026-11-05)

Chrome 156 on Windows was tested through Chrome DevTools MCP against the local production preview at `http://127.0.0.1:4180/PWA-AI-Meeting-Memo-BYOK/`. Both memo requests were real, authenticated browser calls using keys already entered in the browser. This advances local-browser evidence only; production-origin and physical-device gates remain open.

- PASS: four synthetic transcript passages, two unconfirmed speakers and unknown audio timing; one confirmed OpenAI Responses call returned HTTP 200 with five memo items (630 input / 684 output tokens).
- PASS: source inspection, editing/accepting a summary, preserving its generated original, and restoring the human version and accepted state after reload.
- PASS: actual Markdown and JSON downloads contain the accepted human text; JSON preserves generated originals. Export observation found no known credential patterns.
- PASS: one confirmed OpenRouter Responses call returned HTTP 200 with six items (630 input / 752 output tokens); generating version 2 preserved the earlier accepted human version.
- PASS: correcting source text caused the source-change/re-review warning for both versions. Two completed jobs survived reload without automatic resubmission. The original OpenAI memo-provider selection and online connectivity were restored afterward.
- FAIL: offline reload of the current Windows-built preview shows Chrome's offline error page. Generated precache URLs retain `dist` and backslashes because `scripts/build-pwa.mjs` strips only the POSIX `dist/` prefix from native `path.join` output. Cached `.../dist/index.html` therefore does not satisfy the worker's `.../index.html` navigation lookup. The static artifact check passed but did not detect this path defect. This is a current local Windows build failure, not a finding about the Linux-built deployed artifact. No source fix was made in this test-only task.
- BLOCKED / NOT REACHED: the Chrome MCP upload tool denied the sample MP3 path as outside its configured workspace roots. That restriction was not bypassed. Actual Chrome audio upload, transcription, playback and audio backup/restore were not validated; Node API spikes and synthetic browser tests remain separate evidence.

Exactly two new paid memo requests were submitted, once each. Protective cumulative reservations including the earlier spikes totaled US$1.65 under the authorized US$10 ceiling. Dollar charges were not retained by the browser app; the approximate earlier cumulative cost remains around US$0.30, not an invoice. Local evidence is in `private-fixtures/spike/chrome-live-report.md`, `chrome-live-report.json` and `browser-budget.json`. The online test meeting remains open for inspection. No commit, push or deployment occurred.

## User MP3 duration-rejection RCA (2026-11-05)

The user manually attached the same MP3 used in the earlier spikes: 24,390,812 bytes, 2,188.650688 seconds, MP3 / 48 kHz / stereo, with the same stored SHA-256. Chrome recorded two authenticated transcription POSTs returning HTTP 400 and successful HTTP 200 preflights. The saved speech selection was OpenAI `gpt-4o-transcribe-diarize`; both failed jobs display the provider duration/length-limit guidance and retain `possibly_charged` billing. No transcript was produced. This investigation did not resubmit either request or change the selected speech model.

The failure is on the selected long-audio model route: the application accepts the file's byte size, only shows a nonblocking long-duration advisory and has no local media-segmentation implementation. The same full recording previously succeeded on the different OpenAI text model and on Scribe in Node. This is distinct from offline cache-path generation and Scribe timestamp normalization. The user's successful manual attachment also distinguishes it from the MCP tool's file-access restriction.

Chrome could no longer retrieve the original response or multipart bodies, so the exact server numeric limit cannot be quoted from those captures. The historical 1,400-second report remains historical rather than a verified universal current ceiling. [Official file-transcription guidance](https://developers.openai.com/api/docs/guides/speech-to-text) recommends `gpt-transcribe` for normal transcription and documents the deprecated speaker-labeling route; `chunking_strategy=auto` is not an implemented local upload-splitting pipeline. Detailed evidence and recovery choices are recorded locally in `private-fixtures/spike/mp3-duration-rca.md`. Charges for the user's two failed submissions are unknown; conservative US$1 reservations were added for each, bringing cumulative protective reservations to US$3.65 under the US$10 ceiling.

## Windows precache-path repair (2026-11-05)

The confirmed local offline failure is fixed in the build and lifecycle-test scripts: native paths are made relative to `dist/` and normalized to slash URL paths. Cache identity includes the canonical asset list and file paths. The artifact checker now rejects noncanonical, duplicate, out-of-scope, missing or unexpected precache entries; it parses data without executing generated worker code. A new isolated-fixture regression verifies the canonical list, an identical-byte asset rename changing cache identity, and rejection of both Windows-style and slash-style `dist` prefixes, missing assets and duplicates.

Independent Node 22.23.3 verification on Windows:

- PASS: 44 unit tests, ESLint, TypeScript, production build and strengthened artifact check. The checker first rejected the original faulty artifact before rebuilding, establishing the missed-regression baseline.
- PASS: full `test:pwa` in Chromium and WebKit, including N-to-N+1, active-request/editor/settings protection, saved drafts, old assets, unrelated caches, visible activation failure and forward recovery. Before the path fix, the native Windows lifecycle harness failed to locate `sw.js`.
- PASS: the existing Chrome profile upgraded through the normal waiting-worker / Update now flow from faulty cache `39ce67b1c3c0662b` to repaired cache `4188474303231088`. The new cache has ten canonical entries, including the expected project-base `index.html`.
- PASS: with DevTools networking set to Offline, an uncached request outside worker scope failed while reloading the app and opening the saved two-version/six-item memo worked. Chrome's `navigator.onLine` remained true in this emulation; the blocked network probe supplies the actual offline condition evidence.
- PASS: all three existing meeting aggregates retained identical SHA-256 summaries, including the user's failed-transcription meeting and both memo versions. The stored 24,390,812-byte MP3 retained its original SHA-256. Settings revision 4, both saved keys' presence and provider/model selections were preserved. An unrelated test cache survived activation and was then removed explicitly by its test owner. Networking was restored.

No provider request, commit, push or deployment was made for this repair or RCA. This resolves the Windows-built local cache defect, not the user's separate diarization duration rejection or the previously observed Windows WebKit note-accept/export issue. Physical-device and deployed-origin acceptance remain open. Local evidence: `private-fixtures/spike/pwa-path-fix-report.json`.

## Mandatory speaker detection: actual full-recording browser test (2026-11-05)

The owner explicitly requires speaker detection. The existing complete MP3 was sent once from actual Chrome to OpenRouter `elevenlabs/scribe-v2`: authenticated POST HTTP 200, preflight HTTP 204, completed job in approximately 39.5 seconds, and 2,188.6506875 reported audio seconds. No retry occurred. This browser's saved speech selection was changed to that speaker-aware route; source-code defaults and other users' saved selections were not changed.

PASS: the application saved five anonymous unconfirmed labels and 7,217 word-level segments; 7,178 have positive time ranges and 39 retain unknown timing. The immutable normalized run has the same 7,217 segments and the audio hash matches the original recording. Both sampled speakers played from their provider-supplied positions (0.2 and 66.12 seconds) without media error. Reload preserved the speaker panel, recording and completed job. The earlier failed OpenAI jobs remain in history. This establishes browser delivery and local review of speaker/time evidence, not independently annotated accuracy, actual speaker count or identity.

At this test stage, the full speaker-aware memo workflow was blocked: word-level segments serialized to 1,513,635 characters, above the memo runner's former 120,000-character preflight limit, so no memo request was submitted. The bounded transport repair and subsequent actual-browser result below supersede this limitation for this recording. The original observation remains in `private-fixtures/spike/speaker-live-report.md` and `.json`.

This one new transcription used a US$1 protective reservation. Cumulative reservations are US$4.65 including earlier calls and two possibly-charged observed user failures, under the US$10 ceiling. The browser retains audio-second usage but not a dollar invoice. No commit, push or deployment occurred.

## Long speaker-aware memo transport repair (2026-11-05)

The runner and API now use one input builder. Short inputs retain original IDs. When needed, consecutive passages with identical ordered speaker assignments are grouped for transport, at most 20 passages per group. Compact text is an ordered array of original fragments; fragment boundaries do not establish intervening whitespace. Speaker indices refer to the accompanying speaker list, with unknown IDs preserved. Compact aliases map back to original IDs and captured revisions; validation expands and deduplicates them before saving. Each compact item may cite at most five groups, within the existing 100-source limit. Unknown aliases, foreign or changed revisions and oversized inputs reject rather than clip. Persisted transcripts, speakers, timing, history, normalized runs and the meeting schema are unchanged by this repair. The complete input must still fit 80,000 serialized characters; this does not support arbitrary-length meetings. The actual paid request described below predates the fragment-array format; its size and provider outcome do not validate the new format.

Actual local Chrome submitted the existing complete speaker-aware transcript once to OpenAI `gpt-6-luna`: POST and preflight HTTP 200, 24,742 input / 1,562 output tokens, approximately 20.8 seconds by saved job timestamps. The observed request contained 434 groups and 72,505 serialized characters. Comparing the transmitted text with all 7,217 original segments established that their contents were included in order; the then-current transport inserted spaces between fragments, so this did not establish separator fidelity. The result saved 12 pending items and separate generated originals. Each persisted source list resolves to complete transport groups and valid original revisions, with 80–100 references per item and no compact IDs. Source passage 177 opened revision 1 / Speaker 2 and played its original audio range without media error.

PASS: transcript, speaker, normalized-run, history and original-audio SHA-256 values are unchanged from the pre-request baseline. Actual Markdown and JSON downloads contain the first and last memo items; JSON retains all 7,217 segments, five speakers, 12 items and 12 originals with no compact source IDs or known key patterns. The normal PWA update/reload to the final build preserves the result and four jobs; the browser network history still contains only the single memo POST, with no retranscription or automatic retry. A navigation cleared the transient raw provider-response capture, so a direct raw-alias-to-persisted equality comparison is unavailable for this live call; complete-group validation and mocked browser response checks provide the recorded expansion evidence.

Verification on Windows with pinned Node 22.23.3:

- PASS: 54 unit tests, ESLint, TypeScript, production build, artifact check and diff whitespace check.
- PASS: the new full UI import/generate/source/export/reload regression in both Chromium and WebKit against the final build. It asserts the paid-confirmation boundary, complete compact payload, original source expansion and preservation of speaker/timing/revision data.
- PASS: zero-width timing regression in both engines; short memo confirmation/source-change workflow in Chromium.
- FAIL: the existing short memo workflow in Windows WebKit retains the source-change warning after edit/accept. The earlier independently reproduced WebKit acceptance/export defect also remains open. No assertion was weakened; a complete browser release gate is not claimed.
- NOT RUN: full browser suite for this follow-up, physical devices, deployed-origin requests, annotated diarization accuracy and provider billing reconciliation.

Content review found that some multi-clause notes include details outside their selected source text (for example, defense growth percentages absent from the cited excerpt). Valid IDs do not establish semantic support. All 12 notes remain pending; none was accepted as reviewed. Speaker labels remain anonymous and unconfirmed. Private evidence and exact cited-text review are in `private-fixtures/spike/long-memo-report.json` and `long-memo-review.json`.

## Citation review usability follow-up (2026-11-05)

A local read-only lexical check of the existing private review record found three percentage strings in one of 12 notes that were not literal matches in that note's recorded cited excerpt. This reproduces a review lead only: different wording or numeric representations can be equivalent, and string matching does not establish semantic support or external truth. No recording, transcript or provider response was changed, and no provider request was sent.

The memo review interface can now expand all cited revisions together in citation order, with a clear warning that valid citations do not establish support. Each cited piece opens the existing source inspector. Existing note text, original snapshots, source IDs and human review states are unchanged. A synthetic case with a fictional unsupported percentage passed Chromium and WebKit checks for warning display, citation order, historical revision resolution, source inspection, pending state and English/Chinese controls. This does not automatically identify unsupported claims or prove factual accuracy; human source review remains necessary. Physical-device and screen-reader checks remain open.

The separate [offline citation evaluation](EVIDENCE-EVALUATION.md) contains 17 synthetic cases with manually authored labels. On Windows, Node 22.23.3 verified against the official release checksum passed the evaluation CLI, all 60 unit tests, TypeScript and ESLint. These checks establish counting and input validation, not independent annotation quality or model performance. No provider request or real-meeting evaluation was made for this follow-up.

## Local pre-commit regression review (2026-11-05)

An isolated copy excluding `.env`, recordings and private fixtures was verified on Windows with checksum-verified Node 22.23.3. TypeScript, ESLint, 60 unit tests, the production build and static artifact checks passed. The PWA N-to-N+1 lifecycle checks passed in Chromium and WebKit. The initial browser suite passed 60 of 62 tests; the two WebKit failures required synthetic WAV duration metadata. An independent media probe on the same host obtained the one-second WAV duration in Chromium but WebKit reported media error 4. Both affected tests were subsequently rerun successfully in WebKit with explicitly simulated metadata events; this verifies the estimate and advisory logic, not WebKit WAV decoding. The other 60 tests were not rerun after that test-only change. Physical devices, real media decoding and screen-reader acceptance remain open.

After the fragment-boundary repair, the 61 unit tests, TypeScript, ESLint, production build and static artifact checks passed. The full browser suite then passed all 62 tests across Chromium and WebKit, including exact fragment-array transport and original citation expansion. The duration tests still simulate metadata and do not establish actual WebKit WAV decoding. An additional offline replay of the actual downloaded meeting retained all 7,217 original fragments and speaker assignments in 434 groups, totaling 70,881 serialized characters; replaying the captured provider response reproduced all 27 original citation expansions without changing the meeting or networking. Private evidence is in `private-fixtures/spike/abc-newformat-report.json`. The updated transport has not been submitted to a real model; no new paid-model semantic result is claimed for fragment-array input, and future generated claims still require source-text review.

The one new memo request had a US$0.10 protective reservation. Cumulative protective reservations are US$4.75 under the authorized US$10 ceiling; this is not actual spend. OpenAI did not return a dollar charge, and the earlier failed requests still have unknown billing. No commit, push or deployment occurred.

## Speaker and memo evidence review follow-up (2026-11-05)

The actual Chrome meeting retains 7,217 segments, five anonymous/unconfirmed labels, 39 unknown timing ranges, 127 consecutive speaker-assignment runs and 27 runs of no more than three words. Each label's first sample was observed entering playback at its own supplied time (0.2, 66.12, 122.7, 383.176 and 530.856 seconds) without media error. These are metadata and playback checks, not listening-based voice identification or annotated diarization accuracy. Statistics from the earlier independent 7,227-word Node response are explicitly separate and are not mapped onto this browser's speaker UUIDs.

Source-text review narrowed eight editable items in version 1 while keeping its 12 generated originals intact. Generation instructions now request independently checkable claims and complete support for every qualifier, number and entity; unsupported details must be omitted rather than hedged. A single subsequent real OpenAI browser call returned HTTP 200 with 27 pending items, 24,883 input / 2,538 output tokens and the complete unchanged 72,505-character input. Every returned compact citation was checked directly against its expanded persisted original IDs and revisions. No automatic retry or retranscription occurred.

The new instructions did not establish automatic semantic correctness: review of exact selected ASR text still identified incomplete support in 14 multi-clause items. Fifteen editable items were conservatively narrowed (including one additional attribution), and a separate final source-text review found support for those 15 corrections within their selected groups. This establishes support for the current 27 edited texts against ASR excerpts only. Both versions remain pending for human review; identity, ASR correctness against audio and external truth are unverified. Both generated-original SHA-256 values remain unchanged. Transcript, speaker, normalized-run, history and audio hashes also match the pre-task baseline.

Actual Chrome Markdown and JSON downloads retain all current version-2 text, both versions (12 and 27 items), all originals, pending states and original source IDs. JSON is 5,652,475 UTF-8 bytes, below the 12 MB restore limit; no compact citation IDs, top-level keys or known credential patterns were found. Private evidence is retained under `private-fixtures/spike/abc-*`; it includes the exact generation/citation capture, source-text reviews, UI correction read-backs and export metadata.

This follow-up added one US$0.10 protective reservation. Cumulative protective reservations are US$4.85 under the US$10 ceiling, not an actual bill; the new OpenAI dollar charge and earlier failed-request charges remain unknown. No commit, push or deployment occurred. KB retrieval was unavailable, so no KB writeback was performed; the authorized local work used repository rules and runtime evidence.

## WebKit review-state repair and final regression checks (2026-11-05)

The earlier WebKit edit/accept failures are resolved for the tested mouse, keyboard and touch paths. The cause was competing saves from editor blur and the review click using the same meeting version; the repository correctly rejected one with a version conflict. Saving also disables the active editor and can itself trigger blur. Review now reads all displayed fields once and protects that item's pending/committing interaction until the atomic save finishes. Mouse focus prevention does not suppress WebKit's touch click. Touch-end pointerleave with Window/null is retained until click; explicit cancellation or departure to another element clears a pending interaction. Real cross-tab conflicts still reject rather than overwrite.

Final verification used pinned Node 22.23.3 on Windows. A fixed source snapshot and separate private test-output directory removed interference from simultaneous workspace edits and test-output cleanup. Source hashes matched the main workspace. Tests retain the source-change, original-item, billing-uncertainty, export, reload and storage-conflict assertions. Environment-specific test corrections derive origins from the page, wait for completed creation/attachment, select OpenAI explicitly in OpenAI-specific cases, and send React's proper pointerout transition to another element.

- PASS: 61 unit tests, ESLint, TypeScript, production build, artifact check and diff whitespace check.
- PASS: all 62 distinct Chromium/WebKit browser cases covered by the full run plus focused reruns after fixture corrections. This includes real touchscreen taps, text/date acceptance, current reviewed revision, no spurious CAS warning, pending edits, immutable originals, export/reload, original source revisions, long memo transport, offline storage, settings, Chinese UI and accessibility checks. The intermediate full run was not green; its failed fixtures were corrected and every affected case rerun. Passing unaffected cases were not unnecessarily repeated.
- PASS: both engines' complete N-to-N+1 PWA lifecycle tests against the final main-workspace artifact, including active request/editor protection, draft recovery, unrelated caches, visible activation failure and forward recovery.
- PASS: actual Chrome updated to the final local build and retained the real recording, source revisions, five unconfirmed speakers, both corrected memo versions and all generated originals. A review save with an active edited field completed without the former spurious conflict.
- LIMIT: this Windows WebKit run did not decode the synthetic WAV fixture (`readyState=0`, media error 4). The estimate/advisory tests explicitly simulate known duration and loadedmetadata to test those contracts. They do not prove native WAV decoding. Physical iPhone/iOS standalone, independently annotated voice separation, real-person identity and transcription accuracy remain unverified.

The local Chrome data and verification captures remain under Git-ignored `private-fixtures/spike/abc-*`. No additional paid request was made for these repairs or reruns, and there was no commit, push or deployment.

## Speaker listening and source-video workspace baseline (2026-11-05)

This section records the pre-accounting/current-workspace local UI baseline. The current patch verification status is recorded in the Local checks section below; the counts and build identity here are historical evidence for the speaker/video behavior only.

The local workspace now offers 10/20/30-second speaker examples, transcript context and an attribution stage driven by the saved local-audio position. Windows are bounded by the selected length and known recording duration; intervening speaker assignments remain separate. Multiple active labels, gaps, untimed passages and unconfirmed identities stay explicit. Name changes clear confirmation unless the user explicitly confirms; a whitespace-only save normalizes the draft without revising evidence.

An optional validated YouTube reference is saved separately from transcript evidence. Filename suggestions require an explicit choice, and saving metadata makes no video request. Watching loads the privacy-enhanced iframe with the selected sample and offset. Starting local audio unloads the video; watching pauses local audio. The video is an online visual reference for manual identity review, not a real-person recognition result. The stage follows local audio timing, not the video's live playback clock.

Verification with Node 22.23.3 on Windows:

- PASS: 68 unit tests, TypeScript, ESLint, production build and artifact checks.
- PASS: the 70-case broad browser suite in Chromium and Windows WebKit. After the final whitespace-only save adjustment, all 10 speaker/video/Chinese browser cases passed again on the final build. These comprise 72 distinct browser cases across the broad and supplemental runs.
- PASS: long sample bounds and cue-stop behavior; overlap/gap highlighting; listening leaves saved source data unchanged; atomic normalized name confirmation, stale memo review, preserved generated originals and Undo; video consent, offset parameters, mutual exclusion, JSON export/reload and sticky desktop visibility; narrow-screen keyboard, overflow and Axe checks; Chinese controls and invalid-link feedback.
- PASS: final Chromium and WebKit N-to-N+1 update checks, including blocking updates while a real inline speaker-name draft is unsaved, then saving and continuing activation. Existing request/editor protection, offline behavior and unrelated-cache retention remain covered.
- PASS: actual Chrome playback of the existing 36:29 MP3, including Speaker 4's 383.176-second cue and its active label. The public original video loaded and played at the selected range with local audio paused. After scrolling, the final desktop iframe remained fully visible in the 1554-by-888 viewport. The updated app is open in the existing local Chrome meeting.
- PASS: the actual meeting remains at source revision 2 with five unconfirmed labels, five saved jobs and both memo versions (12 and 27 pending items). Segment, speaker, normalized-run, history and both generated-original hashes match the pre-change baseline. Only the optional video reference was added to meeting metadata.

That historical local build was `37e0b2fdd4f06add`. Browser fixture media methods/metadata are simulated for deterministic playback-state checks, especially Windows WebKit; these tests do not establish real WebKit WAV or YouTube decoding. Actual MP3/video playback was verified in Chrome. Diarization accuracy, real-person name mappings, physical iOS/Android installed behavior, other videos' embedding permissions and synchronization offsets remain unverified.

No paid AI request, commit, push or deployment occurred in this UI task. Existing US$4.85 protective reservations are unchanged and remain separate from unknown actual provider billing.

## Provider selection change (2026-11-05)

The OpenAI-default/OpenRouter-optional change passed lint, TypeScript, 30 unit tests, 36 Chromium/WebKit browser tests, static artifact checks, and the two-engine PWA update test locally. Provider responses were synthetic. The published commit must be read from the latest GitHub Actions run; prior counts and live deployment details below describe the earlier baseline. Authenticated provider access, Scribe speaker accuracy, actual charges, and device testing remain NOT RUN.

## Settings persistence amendment

Provider keys, provider/model selections and speech rate are saved locally by explicit user choice. Existing memory-only keys require one re-entry after updating. Local verification passed 34 unit tests, 46 Chromium/WebKit browser tests, and both engines’ PWA update checks. Synthetic tests cover reload, separate settings storage, forgetting keys, stale-tab conflict, injected storage failure and PWA update protection. These tests do not establish protection against same-origin scripts or device/profile access.

## Local checks

| Check | Evidence |
| --- | --- |
| Lint and TypeScript | PASS on the implementation candidate |
| Unit tests | PASS: the current patch run covers 70 tests, including schemas, separate generated memo originals, evidence revisions, undo, invalid source IDs, nullable fields, refusal/incomplete responses, HTTP rejection and billing separation, request limits, storage conflicts, deletion, backup validation, accounting summaries, speaker listening windows and YouTube reference parsing. |
| Browser workflow | PASS: the current patch run covers 74 browser cases across Chromium and Windows WebKit, including real IndexedDB, correction, memo, export, recovery, settings, accounting, accessibility, speaker-stage and source-video flows. |
| PWA update | PASS in both engines: waiting-worker prompt, explicit activation/reload, open-editor/active-request protection, saved draft and old asset preserved, unrelated cache retained, visible activation failure and forward recovery |
| Accessibility | PASS automated axe WCAG A/AA library/settings/speaker checks; keyboard/focus and 390px navigation exercised; representative English desktop and Simplified Chinese 390px CSS-zoom QA passed with minimum measured contrast 5.32:1. This is not physical-device or assistive-technology certification |
| Production artifact | PASS static-file/path/manifest checks and scan for known credential/test fixture patterns; no guarantee that scanning alone detects all secrets |
| Dependency audit | PASS: zero reported production or development vulnerabilities in the checked lockfile |

Current patch note (2026-11-05): the 70-unit run, 74 browser cases, lint, TypeScript, production build, two-engine PWA lifecycle checks and artifact checks passed locally. Build `93c325cceb45b7d3` includes the cache-write usage span. CI will rerun the full gates before publication; this local evidence still does not close the physical-device, screen-reader, authenticated production-origin or annotated-quality gates.

Browser cases use synthetic text/audio. The earlier baseline covered upload/checksum, speaker normalization, confirmation, correction, bulk assignment, merge/split/undo, historical source inspection, session-key clearing, explicit send confirmation, unknown billing, cancellation, backup/restore, offline reload, multi-tab conflicts, and injected quota failures. Injected quota failure tests error handling, not a measured device storage ceiling.

The continuous workflow uses a generated one-second silent WAV and mocked speech/notes. It exports MD, TXT and JSON after human acceptance, checks credential exclusion, restores a checksummed audio ZIP into a separate meeting, and verifies both transcript and human review survived. The timeout case advances the browser clock past nine minutes and verifies one submission, possibly-charged status, and no resubmission after reload.

New memo versions also retain a separate normalized generated snapshot: UI review, JSON export and full-audio restore checks verify human edits leave it unchanged. Existing backups without the optional snapshot are supported, with no invented original. Old app builds should update before reading newly created memo data.

## Deployment

Status: first verified GitHub Actions publication **PASS**. The environment branch policy allows only `main`; provider keys are absent from the workflow and build.

Live site: [Meeting Memo](https://yapweijun1996.github.io/PWA-AI-Meeting-Memo-BYOK/).

- Source/build: `18cd59c2a114385c449c4b0d493ea28c30083a3a`.
- Successful verify and publish: [Actions run 41845407515](https://github.com/yapweijun1996/PWA-AI-Meeting-Memo-BYOK/actions/runs/41845407515).
- Served worker cache identity: `1b1db8a1eb23af4e`, independently read from the deployed worker and matching CI build output.
- Live browser inspection at 2026-11-04 14:20 UTC: Chromium `156.0.8078.4` and Linux WebKit `27.2` both PASS HTTPS, manifest/icons, exact source/build identity, project worker scope, direct hash refresh, synthetic meeting persistence, offline reload, static-only scoped caches, 390px overflow check, and no unexpected external requests or page errors.
- Successful update-fix publication: source `6e0fcdf02833d71a32805f06e7215f21ba4738a1`, [Actions run 41847942972](https://github.com/yapweijun1996/PWA-AI-Meeting-Memo-BYOK/actions/runs/41847942972), worker cache `2832c156fa84a29e`.
- **Live N-to-N+1 PASS**, 2026-11-04 14:35 UTC: both Chromium `156.0.8078.4` and Linux WebKit `27.2` held `4417977` open with an unsaved editor throughout the next real deployment. Neither silently refreshed. After saving and explicitly activating, both loaded `6e0fcdf`, retained the corrected meeting, fetched the previous hashed JavaScript while offline, preserved an unrelated cache, and reloaded the new build offline.

These are recorded verification snapshots. Later task/documentation commits use the same pipeline; find the current complete source SHA under Settings and compare it with the successful main Actions run. Do not infer a current deployment solely from an older recorded run.

Update regression found and fixed during release testing: `18cd59c → 4417977` preserved data in both engines, but Chromium offline reload still loaded the old HTML/build; WebKit loaded the new one. Pages returned `Cache-Control: max-age=600`; a cacheable local server reproduced the Chromium failure. The fix bypasses HTTP cache during precaching, serves the activated release's index for navigation, and includes worker source in cache identity. It passes locally in both engines, including distinct HTML release markers after offline reload/forward recovery, and passes the live upgrade above. No data deletion was used to repair it.

## Acceptance intentionally still open

The user chose to enter BYOK credentials in the finished page and perform live acceptance; no development key is created. The following are **NOT RUN**, rather than inferred from mocks:

- Consented real recordings and manually annotated Chinese/English/Singlish, noise, overlap, brief replies, and long-meeting evaluation.
- Paid provider/model/account access, transcription accuracy, correct speaker attribution, actual charges, and human review time.
- Exact production-origin authenticated provider calls with valid keys.
- Physical iPhone Safari/Home Screen and Android Chrome/installed tests, phone suspension, real memory/storage pressure, and device-specific codecs.
- A dedicated hostname or explicit production acceptance of the shared owner-hostname storage trust boundary.

P1/P2 items such as microphone capture, full waveforms, encrypted backups, local inference, live platform joining, collaboration, synchronization, and PDF layout are not shipped.

## Release matrix

| Area | Result and scope |
| --- | --- |
| Hosting and build identity | PASS clean Actions checks, trusted-main publication and served build/worker identities; PR permissions and failed-check gating verified from workflow structure |
| Privacy and keys | Earlier baseline: memory-only/session clearing; the user subsequently selected unencrypted local key persistence. Destination-specific mock headers, exported credential exclusion and static artifact checks remain applicable; shared-origin production acceptance NOT RUN |
| Provider access and quality | Mock orchestration PASS; authenticated production CORS, valid account/model access, real accuracy and charges NOT RUN |
| Recovery and billing | PASS simulated disconnect, incomplete body, timeout, cancellation, HTTP rejection and reload with no automatic resubmission; submitted/rejected requests retain unconfirmed billing separately from execution failure; real phone suspension and provider settlement NOT RUN |
| Audio | PASS bounded synthetic upload, checksum persistence, playback Blob and restore; empty/oversized inputs and unsupported filenames rejected; malformed codec contents and measured physical-device limits NOT RUN |
| Chunking and streaming | N/A: one original-container foreground upload; no slicing, remote queue/polling or streaming advertised |
| Speakers and evidence | PASS synthetic speaker names/unknowns, bulk assignment, merge/split/undo and historical references; real diarization identity and overlap accuracy NOT RUN |
| Memo | PASS structural/source validation, nullable owner/date, refusal, human edit/accept/reject controls and version preservation; real factual quality and review time NOT RUN |
| Storage and backup | PASS Chromium/WebKit transactions, conflicts, injected quota errors, missing-audio labeling, atomic delete, JSON/ZIP restore and malformed archive/schema rejection; OS eviction and historical production migration NOT RUN (first schema release) |
| Manifest and install | PASS identity, scope, icons and project launch URL; physical Home Screen/installed launch NOT RUN |
| Offline and worker scope | PASS local and live cached app shell/local meeting reload, project-only cache/worker scope and unrelated-cache retention |
| Update lifecycle | PASS local two-engine N-to-N+1 prompt, explicit activation/progress, draft/request protection, old-client asset fallback, visible failure and forward recovery; live two-engine upgrade PASS; first-release schema v1 stayed compatible; destructive migration/revert NOT RUN and not introduced |
| Responsive and navigation | PASS 390px layout, drawer, hash refresh, smart top bar and contextual scroll-to-top; physical landscape/keyboard and pinch gestures NOT RUN |
| Accessibility | PASS automated library/settings axe A/AA and exercised keyboard/focus; full screen-reader certification NOT RUN |
| iOS status bar and safe areas | CSS viewport/safe-area and opaque light theme implemented; physical Safari/standalone inspection NOT RUN |
| Theme chrome | PASS automated light-theme browser layout; dark theme N/A (not offered); device system chrome NOT RUN |

No failed check is being waived. Pending acceptance items are not promoted to PASS by mocked or desktop tests. The user explicitly reserved valid-key acceptance for the finished webpage.

## Limits and safeguards

- Maximum local recording: 50 MiB; transcription upload: 25 MB; supported formats still depend on the browser/provider.
- Maximum JSON restore: 12 MB; ZIP input/expanded size capped at 120 MB and restricted to known entries; audio checksums are verified.
- Memo input/output and history limits are enforced before further requests; all unknown costs stay unknown.
- Human acceptance is recorded against the current source revision. Original generated source references and prior human memo versions remain intact.
- Keys are now persisted unencrypted in a separate local IndexedDB database by user choice. Browser code, all scripts on the hosting origin, and access to the browser profile remain part of the trust boundary.
- Processing is foreground and conservatively recoverable, with no automatic retry of ambiguous paid outcomes.

## Reproduce

Use the commands in [README](../README.md). Workflow runs use only mocks and synthetic fixtures, with no provider secrets. Repeat the relevant real-browser/device checks when storage, worker lifecycle, provider contracts, or supported limits change. Do not mark the open acceptance items complete based on a successful CI run.
