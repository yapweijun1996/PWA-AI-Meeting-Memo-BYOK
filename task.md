Speaker avatar follow-up: deterministic local default illustrations and user-selected local images are integrated with full ZIP backups and restoration; they are presentation only. Older builds cannot import ZIPs with the new avatar entry. Physical-device upload and restore remain unverified.

UI follow-up: a single speaker queue and manual comparison workspace, responsive playback alignment, reusable cursor/focus tooltip, sidebar build/update status, font-size preferences, and a topbar language selector are implemented. Malay coverage is partial with English fallback. Immersive captions auto-fit ordinary groups with a 16px minimum; unusually long groups can still require internal scrolling. Verify N-to-N+1 recovery, responsiveness, and real installed-device behavior before release.

Speaker review redesign: implemented a single searchable, filterable queue, selected-speaker inspector, bounded sample listening and manual second-speaker comparison. Saving and confirming remain separate, with confirmation advancing to another unconfirmed speaker. An audio-derived waveform and physical-device responsive acceptance remain open; do not represent synthetic graphics as audio evidence.

# Implementation tasks

## Voice ID production hardening — 2026-11-16

Current assessment: **working prototype, not production quality; no accuracy is measured.** [gap.md](gap.md#voice-identity-logic-gap-register--2026-11-16) owns the findings, evidence labels and acceptance criteria; this section owns execution status. The findings come from a code reading at `db9e5a5` and are not reproduced by tests unless stated. This documentation update changes no application code. Scope is meeting-scoped anonymous matching; cross-meeting recognition and REL03 licensing/download gates are separate.

- [x] Read the full voice pipeline (sample selection, decode, model worker, single-file and multi-part matching, projection, review hints) and record logic gaps VID01–VID14 in `gap.md`.
- [x] Voice hints in speaker review ("Most similar voices", `92f3eba`): 8 unit tests and one seeded Chromium/WebKit flow; back-to-back playback in Chromium only; not checked on a real recording.
- [x] VID01a (P0) — Offline evaluation harness: "Export voice evaluation data" in speaker review (pseudonyms only; no names, text or recording hash) and `scripts/evaluate-voice-matching.mjs`. Local verification on Node 25.2.1: 8 new unit tests, 336 unit tests in total, lint, typecheck, SSOT check, build, and one Chromium/WebKit export flow. Fake vectors only.
- [ ] VID01b (P0) — Measure real recordings: confirm speakers by ear, export, record per-recording results for at least two meetings. Inputs available outside Git: the 59:06 recording in the handoff and an owner-supplied four-speaker MP3 (60:05, 85.2 MB, 48 kHz stereo). Needs the owner: transcribing the new MP3 is a paid request, and confirming speakers is a listening task.
- [x] VID02 (P0) — Saved vectors are reused across meeting revisions and have their own extraction version. Unit tests on the chunked and single-file paths show zero decodes and zero model runs on a re-run after a revision change. Not timed on a real recording.
- [x] VID09 (P1) — "Not the same" is saved with the meeting, follows merges and re-keying, constrains multi-part matching together with confirmed speakers (also under a head count), is no longer suggested, and is exported for evaluation. Local verification on Node 25.2.1: 14 new unit tests, one end-to-end re-analysis test, 352 unit tests in total, lint, typecheck, SSOT check, build, artifact check; Chromium/WebKit voice and speaker-review specs: 123 passed, 3 skipped, 2 failed. Both failures are the immersive fullscreen spacing assertion (`speaker-review.spec.ts`, top space 14 px against an expected 30 px), which fails identically on unmodified `main` at `9839492` and is outside this change. Fake vectors only. Older builds cannot import a meeting that holds decisions.
- [x] VID01c (P0) — `--replay` re-runs the app's matcher on exported vectors across settings and scores each (one unit test with the real matcher, one command run on a synthetic export).
- [ ] VID03 (P1) — Implemented 2026-11-16, measurement open: filtered 16 kHz conversion and a silence/clipping gate; `extractionVersion` v2 recomputes earlier vectors once. Signal-level unit tests only. Stays unchecked until a VID01 result on a real recording.
- [ ] VID04 (P1) — Implemented 2026-11-16, measurement open: up to 6 samples per label per part, spread across turns, kept 0.25 s inside turn edges. Length weighting and outlier rejection not done. Stays unchecked until a VID01 result.
- [ ] VID05 (P1) — Options implemented 2026-11-16, default unchanged: `centre` = samples / labels / voices in the matcher and in `--replay`. Switch the default only on real-recording evidence.
- [x] Voice change verification 2026-11-16 (Node 25.2.1): 362 unit tests, lint, typecheck, SSOT check, build, artifact check; Chromium/WebKit voice analysis spec 12/12 after its fixture's audio levels were moved inside full scale (the old levels of 1 and 2 are rejected as clipped by design).
- [x] Immersive Focus mode on tablet widths: the stage fills the screen again (`d109629`); all 57 immersive Chromium/WebKit cases pass, 3 skipped. Root cause: the tablet separate-flow rule from `a65de10` also applied when no transcript sits below the stage.
- [ ] VID06 (P1) — Implemented 2026-11-16, measurement open: a label whose samples side with another label of the same part is left ungrouped and counted in the notice. No guided split action yet. Stays unchecked until a VID01 result.
- [ ] VID07 (P1) — Global constrained clustering compared against the current greedy part-by-part matcher.
- [ ] VID08 (P1) — Implemented 2026-11-16, measurement open: a head count no longer joins voices of negative similarity or pairs a person rejected, and the notice says when the count was not reached. Estimating the count from data is not done. Stays unchecked until a VID01 result.
- [x] VID06/VID08 verification 2026-11-16 (Node 25.2.1): 7 new unit tests, 369 in total, lint, typecheck, SSOT check, build, artifact check, Chromium/WebKit voice analysis spec 12/12. Fake vectors only.
- [ ] VID10 (P1) — Measure the raw-cosine single-file and one-label-per-part paths, then align their scoring.
- [ ] VID11 (P2) — Low-confidence suggestions for labels with too few samples.
- [ ] VID12 (P2) — Evaluate local segmentation against provider labels.
- [ ] VID13 (P2) — Compare speaker models and quantisation on the evaluation set.
- [ ] VID14 (P2) — Verify and plan each part once; time each stage.

Order: VID01 and VID02, then VID09, then VID03–VID05 as measured comparisons, then the rest. No item from VID03 onward may be checked on reasoning alone; each needs a VID01 result.

## Delivery execution — 2026-11-16

The owner authorized sequential completion, per-task commits, merge and push to `main`. Delivery uses the separate `PWA-AI-Meeting-Memo-BYOK-delivery` worktree; the original workspace is preserved. Checked items require the stated evidence; device/account/licence-dependent acceptance remains open until actually verified.

- [x] Publish the evidence-backed SSOT/PWA assessment and follow-up list (`91790d0`).
- [x] Protect manual and post-transcription local voice analysis with the existing meeting-level Web Lock through final save. Refuse unsafe analysis when locks are unavailable, preserve ordinary transcription, and recover explicitly after the owning tab closes. Local verification: 279 unit tests on Node 22.23.3, lint, production build and artifact check; 14 Chromium/WebKit chunked-transcription and voice-analysis browser cases, including preserved source/undo and unknown-billing behavior. PWA lifecycle checks are recorded in the delivery report; no voice-accuracy claim.

## Sidebar update button — 2026-11-16

- [x] Keep the update button at the sidebar's padded bottom with empty or visible feedback. Status messages appear above it, and the empty live region stays available without reserving a row. Independent Chromium/WebKit checks passed for expanded, collapsed, short-height and mobile drawer layouts, including recent-list scrolling. Publication is tracked in `docs/VALIDATION.md`.

## Faster GitHub publication — 2026-11-16

- [x] Implement the owner-requested fast main lane: lint, unit/contracts, SSOT, types/build and artifact checks before upload; full browser/catalogue/PWA checks on PRs and default manual dispatch. Manual runs never deploy. Skip documentation-only main pushes and preserve current-head, permissions and serialized-deployment guards. Hosted timing/readback is recorded in `docs/VALIDATION.md`; this supersedes REL01's earlier all-browser-before-main policy.
- [x] Verify hosted fast publication and the deployed sidebar: run `43816062043` published `4a1bfd5` in 63 seconds, including 328 unit tests and all fast gates. Fresh 390px Chromium readback matched the full SHA, with stable bottom button placement, feedback above it and no overflow/errors/provider requests. Full PR/manual execution and physical devices remain separate gates.
- [x] Correct the cost test fixture to select its WAV before meeting creation, preserving filename, duration, cost and reload assertions. Independent Chromium/WebKit rerun: 2/2 passed.

## SSOT and PWA gap follow-up — 2026-11-16

Current assessment: **partially aligned, not fully compliant**. [gap.md](gap.md) owns the versioned KB source references, applicability decisions, evidence, priorities and acceptance criteria. This section owns execution status. Historical checked SSOT work below remains a checkpoint, not evidence of complete current compliance. These tasks are follow-up recommendations; this documentation update does not authorize deployment or wholesale UI migration.

- [x] Assess the relevant KB token/component standards against current local code and record evidence-backed gaps and project-specific exceptions in `gap.md`.
- [x] REL01 — Require lint, unit/contracts, build/types, Chromium/WebKit, PWA and artifact verification before publication. Main `01dbe20` passed hosted run `43798887650` (281 unit tests, 297 browser cases passed / 3 skipped) and exact-build production readback. Negative dependency/failure-override mutations were rejected. PR trigger/permission wiring is contract-tested; live PR-trigger execution remains unverified because PR creation was denied by the integration (403). See `docs/VALIDATION.md`.
- [x] REL01 PWA fixture synchronization — Wait for the intentionally nonactivating worker's actual activation-request ACK before fast-forwarding the failure deadline. A controlled delayed-registration run exposed the prior readiness gap; independent Chromium/WebKit runs pass all original protection/failure/recovery assertions without changing application behavior or existing timeouts. See `docs/VALIDATION.md` for the original natural failure's remaining uncertainty.
- [x] DS05 — Parser-backed ratchet and CI gate delivered. Corrective main `b3de14c` passed hosted run `43806474049`: 301 unit tests, SSOT check, 297 browser cases passed / three skipped, both-engine PWA and artifact checks; verify/publish succeeded and exact 390px production readback passed. Initial failed run and fixture red/green evidence remain in `docs/VALIDATION.md`.
- [x] DS02 — Adopt authoritative handwritten CSS with disjoint base ownership and synchronized CSS/HTML/manifest/runtime browser chrome. Independent source/visual review, 314 unit tests, 30 two-engine browser cases, PWA/build/artifact and normal lint/type checks passed locally; hosted publication/readback is tracked in `docs/VALIDATION.md`. This is a local K1 adaptation, not a JSON-generator claim.
- [ ] DS01 — Continue the inventoried semantic migration after the first 33-count reduction (387 to 354). Remaining immersive-control/transcript UI skins, selection/floating shadows, feature radii/fonts and local layers must migrate; distinguish actual UI roles from scoped artwork/physical/mobile constraints and preserve computed behavior across appearance axes.
- [x] Tablet stage containment — Fix the separately reproduced 601–1000px stage shrink/overlap before continuing DS01. Independent eight-case Chromium/WebKit checks, maximum text, Single/Table with Reading, real wheel/search/close and fast/PWA gates passed. Main `a65de10` published in run `43823405258` (79s); exact-SHA production containment/control checks passed in fresh Chromium/WebKit. Physical-device acceptance and semantic migration remain open.
- [x] DS04 — Document actual owners/contracts in `docs/UI-COMPONENTS.md` and add an isolated developer-only catalogue. Root visual review scored 90; integrated Chromium/WebKit tests passed 21/21, normal types/lint and 314 unit tests passed, and 15 app artifact hashes stayed unchanged. Catalogue type/lint/npm/CI wiring is included; hosted release evidence is tracked in `docs/VALIDATION.md`.
- [ ] DS03 — Consolidate repeated interactive patterns incrementally; preserve dialog focus, keyboard/touch, memo drafts and review behavior.
- [x] DS03 shared Modal focus — Centralize default post-unmount restoration and remove the catalogue's duplicate effect, preserving explicit feature targets. Independent final checks passed 33 catalogue cases, six application dialog/evidence/autosave cases, both-engine mobile keyboard/PWA recovery and all fast gates. Main `315cf89` published in hosted run `43818842320` (69s); exact production SHA and keyboard return passed in fresh 390px Chromium/WebKit. Remaining Button/IconButton/Field/Tabs work stays under DS03; detailed evidence is in `docs/VALIDATION.md`.
- [ ] DS06 — Expand theme/palette contrast and screenshot acceptance across representative workflows and 390/768/1440 viewports.
- [ ] DS07 — Reproduce or rule out cold-launch theme flash, then implement and verify early restoration if required.
- [ ] DS08 — Define shared icon sizing and explicit artwork exceptions without duplicating the Lucide registry or changing speaker identity semantics.
- [x] DS09 — Retain the existing explicit theme/palette/font/size controls; defer optional system-theme following, density and design kits. The scope decision and future acceptance conditions are in `docs/PRODUCT.md`; no capability or migration is claimed.
- [ ] REL02 — Complete pinned Node 22 release checks and physical iOS/Android installed, offline, suspension, safe-area and screen-reader acceptance.
- [ ] REL03 — Close speaker-model licensing/delivery, labelled matching evaluation and deployed download/offline/mobile recovery gates; retain separate accuracy limitations.
- [x] REL03 evidence correction — Verify the upstream model card's CC BY-SA 3.0 link and reconcile the earlier blanket absence claim in the owning documents. This closes the evidence correction only; ONNX notices/derivation compliance, quality and device/download acceptance remain open.
- [x] REL03 consent copy — Share reviewed-source disclosure across local analysis and provider-transcription confirmation, preserving different data boundaries. Four integrated bilingual cases, original eight voice flows and fast/PWA gates passed. Main `458b2c6` published in run `43824913523` (63s); exact-SHA production read/cancel checks passed in eight Chromium/WebKit language/context scenarios. Windows WebKit sequential link Tab and full REL03 remain open; detailed evidence is in `docs/VALIDATION.md`.
- [x] DOC01 — Reconcile historical SSOT, immersive, fragment and release checklists against owning code and verified evidence; see the scoped 2026-11-16 reconciliation below. Other historical acceptance is retained rather than newly re-audited. Combined device, audio-energy and model-quality gates remain open.

## Checklist reconciliation — 2026-11-16

Current code and independent review establish the chunk-window stale-load repair (`src/audio/chunked-audio.ts`, `tests/chunked-audio-race.test.ts`), shared immersive player/fullscreen fallback and transcript controls (`src/features/ImmersivePlayback.tsx`), and copied exact fragment metadata/projection (`src/domain/playback.ts`, `src/features/SpeakerReview.tsx`). These implementation tasks are checked below. Hosted Node 22.23.3 run [43798887650](https://github.com/yapweijun1996/PWA-AI-Meeting-Memo-BYOK/actions/runs/43798887650) passed 281 unit tests, 297 browser cases with three explicit skips, PWA lifecycle and artifact checks. See [validation](docs/VALIDATION.md#sequential-task-delivery-and-publication-gate--2026-11-16) for failures, reruns and exact release readback.

Historical dated paragraphs retain their original evidence and are not current release summaries. The earlier token-consolidation checkbox is a checkpoint; current DS01/DS02 debt in [gap.md](gap.md) takes precedence over its claim of complete consolidation. Fragment preservation, group-chat layout and fragment projection are complete. The combined audio-reactive test task remains open because Web Audio energy sampling is absent: timed-attribution glyphs and glow do not measure audio energy. Combined responsive/device tasks remain open for physical iOS/Android, real screen readers, representative long-recording performance, large-roster discoverability and fullscreen/error recovery races. Acoustic continuity remains open for licensing, labelled evaluation and deployed model recovery.

## Immersive playback — local implementation 2026-11-10

The owner approved the [fullscreen concept](fullscreen-playback-concept.png). The detailed [immersive playback plan](docs/IMMERSIVE-PLAYBACK-PLAN.md) defines scope, behavior, architecture, platform fallback and acceptance. The local implementation remains under validation and is not a claim of release. Preserve the current uncommitted workspace changes and existing playback, evidence, privacy and recovery contracts.

- [x] Establish the current player/fullscreen baseline and test the suspected asynchronous chunk-window switch race; if reproduced, correct it and verify pause, seek and stale-load handling before relying on it.
- [x] Add immersive entry and exit with a shared player, preserved position/rate/play state, native fullscreen when available, in-page fallback, and focus/scroll restoration.
- [x] Build the speaker-avatar and synchronized-caption stage with explicit pause, gap, unknown, overlap, buffering, error and untimed states; preserve source timing and multilingual fragment text.
- [x] Add accessible playback controls and a bounded transcript panel with seek, manual-follow suspension and explicit resume; preserve the existing reference-video exclusion and source correction paths.
- [ ] Complete desktop, tablet and mobile responsive layouts, safe areas, zoom, keyboard, screen-reader and reduced-motion behavior.
- [ ] Run the plan's focused unit/browser and long-recording regressions; verify real browser and physical iPhone Safari/standalone behavior, offline playback and unchanged data. Record versions, evidence and untested limitations.
- [x] Synchronize authoritative product and architecture documentation with the implemented immersive workflow. The current sequential-delivery instruction authorizes per-task commit, main merge and push; device and real-assistive-technology acceptance remains separate.

Local implementation checkpoint, 2026-11-10: the immersive view uses the existing player and clock, with native fullscreen and an in-page fallback, speaker/caption stage, playback controls and bounded transcript. The chunk-window race was reproduced and repaired locally. Chromium native fullscreen and synthetic Chromium/WebKit fallback, overlap, pagination and reference-video checks have been exercised; physical iPhone, installed mode and real screen-reader acceptance remain open. This checkpoint is not a claim of deployment or full completion.

### Immersive review follow-up — 2026-11-10

The [review findings](docs/IMMERSIVE-PLAYBACK-PLAN.md#immersive-review-findings--2026-11-10) distinguish screenshot and local code observations from risks requiring reproduction. The following are open tasks; the review itself did not run browser or device tests.

Local follow-up: a compact collapsible label list, current-position speaker cards, name-confirmation labels, fragment emphasis, visible follow state and separate untimed disclosure are implemented. Checks on Node 25.2.1: lint, typecheck, build and 15 focused playback unit tests passed; the initial immersive browser run passed 20, skipped native fullscreen on WebKit and found three failures. After correcting contrast and isolating the Windows WebKit fixture's media error, the four affected Chromium/WebKit cases passed again, including 320px bounds. The 19-speaker layout regression passed on both engines in the initial run. Physical devices, real screen readers, representative long-recording performance and the project's pinned Node 22 runtime remain unverified; the build reports a non-failing bundle-size warning. These results are local and do not establish publication.

Transcript positioning follow-up: automatic follow now aligns a whole preceding row when possible instead of leaving the first visible row clipped, and reserves room below the current row. Manual browsing still suspends follow. Build and lint passed on Node 25.2.1; six focused Chromium/WebKit cases passed for follow, paging and overlap. Physical devices and rows taller than the viewport remain acceptance items.

Avatar gap follow-up: local presentation retains short same-caption context, and otherwise shows the most recently completed timed caption and its speakers as previous context without marking speech active. Six focused Chromium/WebKit development-server cases cover playing and paused gaps, speaker changes, overlap, seeking before the first caption and source preservation; 15 playback unit tests and lint passed. The initial production build failed because a concurrently added acoustic model dependency was not installed in this workspace; the later integrated build passed.

Status text follow-up: at the owner's request, frequently changing speech/context status text is visually hidden while its descriptions remain available to assistive technology; buffering and playback errors remain visible. The avatar card height stays stable through a short gap. Local build, lint, 15 playback unit tests and eight Chromium/WebKit browser cases passed. Real screen-reader and physical-device checks remain open.

Highlight responsiveness follow-up: foreground media time is sampled on animation frames while retaining boundary-based projections and coarse player controls. Local synthetic native Chromium observation, with `timeupdate` suppressed, changed from 13 mismatched frames and 35.6 ms maximum boundary mismatch to zero mismatches in 154 frames in one post-change run; this does not validate provider timestamps or human-audible alignment. Lint, build, artifact check, 23 focused unit tests and nine Chromium/WebKit browser cases passed; native WAV clock probe was skipped on WebKit. The acoustic dependency is now installed and the local integrated build passed. Assess real recording timestamps, output-device latency and long-transcript/device performance before deciding whether a user-controlled offset or other correction is warranted.

Responsive UX follow-up: stage and dock layout, desktop transcript-width control, full-meeting transcript search, Jump to current, speaker-editor entry, Focus/Reading modes and stage-focused keyboard shortcuts are under local verification. Desktop/tablet/mobile automated coverage does not replace physical-device and screen-reader acceptance; see the immersive plan for exact behavior and outstanding gates.

- [ ] Make current position attribution and speaker name discoverable while paused, distinguish active speech, unknown and unconfirmed identities, and retain all overlapping speakers. Ensure the relevant speaker remains findable in a large scrollable roster without treating part labels as verified identities.
- [x] Improve central caption fragment emphasis using original timing, and validate readable overlap, gaps, multilingual text and stable layout without fabricating word timings.
- [x] Review transcript follow suspension, keyboard interaction, seek/resume behavior, overlap visibility and discoverability of untimed entries; preserve access to all source evidence and focus.
- [ ] Reproduce or rule out stale playback-error feedback and fullscreen entry/exit races; verify the correct final player, focus and scroll state.
- [ ] Measure long-transcript update cost and stress overlapping intervals and bounded windows. Test many speakers and long captions across desktop and mobile viewports, including large text, safe areas and both orientations.
- [ ] Verify accessible state announcements, focus, touch, contrast and reduced motion with keyboard and real screen readers; complete physical iPhone Safari/standalone and Android acceptance. Record passed, failed and unrun checks separately.
- [ ] Keep automatic meeting-scoped acoustic speaker continuity tracked in [its separate plan](docs/ACOUSTIC-SPEAKER-CONTINUITY.md); do not treat matching labels or overlap words as proof of voice identity. Current state, pitfalls and next steps: [docs/HANDOFF.md](docs/HANDOFF.md). Open: model weight licence, model files in CI, labelled evaluation and threshold calibration, part-by-part comparison panel, Chromium/WebKit and physical-device acceptance.

Updated: 2026-11-06. The owner authorized the core follow-up plan, per-task commits/main merges/pushes and deployment, with final owner testing after delivery. Application code `ce8bd74` passed 85 unit tests, 102 Chromium/WebKit browser cases, both-engine PWA lifecycle and artifact checks; verification and publication succeeded in [run 42189291028](https://github.com/yapweijun1996/PWA-AI-Meeting-Memo-BYOK/actions/runs/42189291028). Exact-build production readback passed. The transferable synthetic owner backup adds one unit test (86 passed locally). See [validation](docs/VALIDATION.md#core-follow-up-delivery--2026-11-06). Production authenticated API validation has not resumed, no new paid request or reservation occurred, and protective reservations remain US$4.85. Physical-device, billing and annotated-quality gates remain open. The four newly added group-chat/audio-reactive tasks are separate from the approved core plan and remain unchecked.

## Handoff — 2026-11-09

Next owner (Codex): see the 2026-11-09 handoff entries at the end of [docs/IMPLEMENTATION-LOG.md](docs/IMPLEMENTATION-LOG.md). Open items: (1) owner runs the 17.5 MB 48 kbps mono file as a new meeting and reports the speaker count and any playback shake on the deployed build; (2) suggest compressing recordings above 24 MB to 48 kbps mono at import; (3) optional browser-side global voiceprint matching across parts (prototype first: sherpa-onnx WASM or Transformers.js, measure time, memory and agreement with the offline result); (4) WebKit chunked seek precision; (5) remaining playback reviewer items: phone padding/`svh`, per-caption aria-label, roving tabindex, `captionsAtTime` memoisation, CJK `line-break`. No billing or key work was done this session.

This file tracks execution. [Product requirements](docs/PRODUCT.md), [architecture](docs/ARCHITECTURE.md), [feasibility](docs/FEASIBILITY.md), [deployment](docs/DEPLOYMENT.md), and [the roadmap](docs/ROADMAP.md) define the detailed contracts. A checked task requires evidence, not just code or a proposed design.

## Working rules

Speaker-switch follow-up, 2026-11-06: reduce event-driven playback lag and short-word-gap flicker while preserving exact attribution. The isolated repair adds bounded foreground media-time sampling, explicitly inactive same-caption gap context, stable headings and numbered anonymous avatars. Source output and confirmation remain unchanged. See [validation](docs/VALIDATION.md#speaker-switch-responsiveness-follow-up--2026-11-06) for the native audio probe and the distinction between clock responsiveness and provider diarization accuracy. Concurrent unrelated workspace edits are excluded from this release.

- Keep the core browser-first, with runtime BYOK and static GitHub Pages hosting. A companion and backend remain optional future modes.
- Preserve speaker correction, original results, source references, and human edits throughout the workflow.
- The user selected unencrypted local browser persistence for keys; keep them out of Git, meeting exports, build artifacts, logs, and caches, and disclose the shared-origin trust boundary.
- Use synthetic fixtures in CI. Live API tests require explicit authorization for the data and potential charges.
- Persist completed work and distinguish provider polling from resubmitting a paid request. Never automatically retry an unknown paid outcome.
- Record app commit, environment, test procedure, and result when completing a validation task. Real-browser, physical-device, and mocked tests establish different things.

## Dashboard IA, playback stage, and SSOT Design System — 2026-11-06

See [product requirements](docs/PRODUCT.md#dashboard-information-architecture-and-ssot-design-system-2026-11-06) and [architecture](docs/ARCHITECTURE.md#stack-and-modules). Local commits `4587ea4`, `4f5d70b`, and `f3d11ee` implement the speaker-review playback layout refinement, dashboard information architecture redesign, and compact interactive topbar.

- [x] Refine `SpeakerReview` playback mode (`4587ea4`): two-column desktop split (`minmax(340px, 0.82fr) minmax(0, 1.18fr)`), compact speaker roster chips, direct jump-to-next-speech action during gaps, quick switch to `Edit speakers` with automatic input focus, and collapsible `Reference video` drawer with `Loaded` badge; verified by 74 unit tests and 24 Playwright speaker-review tests across Chromium and WebKit.
- [x] Reorder Dashboard information architecture and workspace UI/UX (`4f5d70b`): replace the oversized hero with a compact `welcome-banner`, elevate `Meeting library` above the fold, replace the storage KPI card with workflow KPIs (`Total meetings`, `Needs review`, `Completed notes`), unify meeting status badges/CTAs (`Recording`, `Transcribing`, `Needs review`, `Ready`, `Failed`), merge filter/search/sort into `.library-toolbar`, replace the sidebar promotional card with `Needs review` and `Recent meetings` navigation, and add live split-passage preview, drag-and-drop audio upload, sticky bulk bar, and pill-styled memo review actions; verified by 75 unit tests and 64 Playwright browser cases across Chromium and WebKit.
- [x] Implement compact interactive sticky topbar (`f3d11ee`): reduce desktop topbar height from `77px` to `52px`, convert `Workspace` into a clickable home breadcrumb link (`.breadcrumb-root`), and surface the current meeting workflow status `<Pill>` in the breadcrumb on meeting routes; verified by `lint`, `typecheck`, `build`, `check:artifact`, and 14 Playwright layout/accessibility/localization tests on Chromium and WebKit.
- [x] Consolidate remaining scattered CSS hex literals and font-size values into `:root` SSOT Design Tokens (`--text-xs` through `--text-display`, `--bg-*`, `--status-*`, `--speaker-1` through `--speaker-5`) and extract shared speaker-palette/workflow-status helpers so no feature module duplicates visual or status constants.
- [x] Preserve sub-segment fragment metadata (`PlaybackCaption.fragments`: `id`, `start`, `end`, `speakerIds`, `text`, `untimed`) inside `src/domain/playback.ts` when merging consecutive short turns (`gap <= 350 ms`, up to `220` chars) from the same speaker, enabling word/phrase-level highlighting when `fragments.length > 1` and sentence-level highlighting when `fragments.length === 1` without character-count time interpolation.
- [ ] Add Web Audio `AnalyserNode` smoothed audio-energy sampling (`energy = prev * 0.75 + current * 0.25`, clamped `0.0–1.0`) in `src/features/usePlaybackClock.ts` to drive bounded `scale(1.00–1.12)` avatar pulse halos exclusively on active speakers while `playing === true`, with graceful fallback when `AudioContext` is unavailable or `prefers-reduced-motion: reduce` is active.
- [x] Redesign `SpeakerReview` playback view into the WhatsApp-style sequential group-chat stream (`docs/PRODUCT.md#group-chat-playback-stage-audio-reactive-avatars-and-synchronized-captions-planned-2026-11-06`): persistent top 5-speaker avatar stage (`S1`–`S5`, `Idle` vs. live `·|·|·` waveform), centered `Meeting transcript` pill divider, left-aligned chronological chat bubbles with bottom-left speaker avatars, `150–200ms` active bubble color transition, click-to-seek timestamps, multi-speaker overlap support, and smart auto-scroll with `Jump to live` / `Follow playback` pause-on-manual-scroll.
- [ ] Add unit and Playwright browser tests (Chromium + WebKit) covering `PlaybackCaption.fragments` word vs. sentence highlighting, active speaker avatar pulse gating (`playing` vs. `paused`/gap/overlap), click-to-seek on group-chat bubbles, smart auto-scroll manual interruption, and `prefers-reduced-motion: reduce` compliance.

## Synchronized playback improvement — owner authorized 2026-11-06

The owner approved the supplied Playback/Naming mockups and authorized coding, per-task commits, main merges/pushes and deployment. Final owner testing follows delivery. This work uses synthetic fixtures; paid provider validation and independent diarization quality evaluation remain separate.

- [x] Implement and locally verify the core audio-clock synchronization: one `HTMLAudioElement.currentTime` timeline drives active speakers, live captions and transcript highlighting, including pause, seek, speed, end, overlap, gaps and missing timestamps.
- [x] Provide Playback and Edit Speakers modes with a persistent player, desktop two-column/mobile single-column layout, adjustable captions, explicit follow controls and a bounded long-transcript view; preserve source IDs, edits, identity confirmation and CAS.
- [x] Commit/merge/push the independently verified core, publish through the existing trusted-main workflow and read back the served build. Implementation `71c6303` passed 74 unit tests, 90 browser cases and the existing PWA/artifact gates in [run 42167745778](https://github.com/yapweijun1996/PWA-AI-Meeting-Memo-BYOK/actions/runs/42167745778); verify and publish succeeded. Exact-commit production readback and all 18 independent native playback checks passed without provider calls. See [validation](docs/VALIDATION.md#synchronized-playback-workspace--2026-11-06) for scope and remaining device/quality gates.
- [x] Assess the visual/privacy follow-up: numbered/color placeholders and reduced-motion-aware emphasis are included; custom photo upload remains future work with separate storage/backup semantics. Reference video remains explicit, collapsible and excluded from AI input.
- [x] Complete local browser/PWA/artifact checks: 74 unit tests, a 90-case broad browser pass, 20 focused two-engine cases after the final manual-window guard, 18 native Chromium checks and both-engine update checks. Physical-device, native Windows WebKit codec certification and real screen-reader checks remain unrun.

The earlier UI-only follow-up run [42150925350](https://github.com/yapweijun1996/PWA-AI-Meeting-Memo-BYOK/actions/runs/42150925350) was cancelled at its 20-minute browser-dependency installation limit; publication was skipped. Its local 80-case pass remains local evidence only.

## Meeting workspace UI review — screenshot observations 2026-11-05

These are preliminary observations from a user-provided desktop screenshot of a populated meeting workspace. They are not verified defects or evidence of mobile, keyboard, screen-reader, contrast, or runtime behavior. Reproduce with synthetic data before choosing changes; coordinate with the bilingual UX and preset/cost tasks below.

- [x] Review and reduce vertical space without hiding meeting context or actions. In the paired synthetic comparison, first memo text moved upward by 32.45 px on desktop, 98.41 px on English 390px layouts and 63.50 px on Chinese 390px layouts. Six browser cases verify normal-layout text visibility, controls, touch targets and reflow; native zoom, physical devices and screen readers remain separate gates.
- [x] Check the readability and actual contrast of secondary text and status information, including meeting details, audio metadata, version, model, and local-save status; representative English desktop and Simplified Chinese 390px QA at CSS zoom 2× passed with a minimum measured contrast of 5.32:1. Physical-device zoom remains open.
- [x] Review the stale-notes warning and make the available next steps understandable while preserving accepted human edits and source revision history; browser checks cover the warning, current-transcript/generate-another actions and preserved revisions.
- [x] Clarify that generating a new memo creates a new version and may incur a charge; retain the existing explicit confirmation of recipient, data, and estimated or unknown cost. The fee notice and confirmation boundary are browser-tested.
- [x] When a transcript already exists, clarify what the transcription action will do to existing evidence and corrections; browser checks cover source-unchanged replacement/history behavior and preservation of prior evidence.
- [x] Explain the units behind transcript, speaker, and meeting-note counts, including accessible names where needed; recording, history and tab labels are covered by browser assertions.
- [x] Check the discoverability and accessible names of icon-only meeting settings and delete actions; title/name, confirmation and keyboard interaction paths are covered by browser checks. Physical screen-reader certification remains open.
- [x] Review privacy and local-save wording so users can distinguish local storage from data sent to a provider after authorization, including the documented shared-origin boundary; settings/workspace copy and destination confirmation are covered, while physical-device behavior remains open.
- [ ] Complete the combined follow-up across representative desktop and narrow layouts, keyboard and screen-reader access, English and Simplified Chinese, and synthetic states; physical screen-reader and installed-device validation remain separate release gates below.

## Speaker listening and bilingual UX — implemented/local validation 2026-11-05

See the [product requirements](docs/PRODUCT.md#4-review-speakers) and [interactive concept](docs/design/speaker-review-prototype.html). The application path is implemented and locally tested; the concept remains illustrative and neither is proof of diarization accuracy.

- [x] Investigate and implement sample selection on word-level and sentence-level provider responses: 10/20/30-second bounded context windows, distinct example turns, recording-end limits, overlap context and explicit missing-audio/timing states.
- [x] Implement a playback-synchronized, dynamically sized speaker stage using supported transcript timestamps and current assignments; display simultaneous speakers, unknown gaps, untimed data and unconfirmed identity without inventing attribution.
- [x] Connect seek and contextual listening to existing speaker correction, revision invalidation and undo; retain original model output and evidence. Context is labelled as potentially containing other voices.
- [x] Add English and Simplified Chinese controls, translated labels/errors/dialogs and automated accessible-name coverage for the implemented speaker/video review path; UI language remains separate from meeting language and data survives switching. Full screen-reader/device acceptance remains open.
- [x] Validate synthetic word-level, long-turn, overlap, missing-timing and corrected-assignment cases on desktop, narrow layouts, keyboard and both UI languages; the global reduced-motion processing regression is covered separately. Validate the real recording path in Chrome and document limitations.
- [ ] Validate iOS standalone, physical screen-reader behavior and Android installed mode; these require user devices and are retained as release gates.

## Settings persistence amendment — 2026-11-05

The user selected unencrypted storage in this browser for API keys, provider/model selections, and the speech rate. Settings are kept separately from meeting backups; see [provider support](docs/PROVIDERS.md) and [architecture](docs/ARCHITECTURE.md).

- [x] Persist and restore provider keys, model selections and rate in a separate local IndexedDB database.
- [x] Provide persistent key removal and disclose the unencrypted shared-origin trust boundary.
- [x] Detect stale-tab writes and storage failures without silently overwriting saved settings.
- [x] Verify reload, backup exclusion, provider pairing and PWA update protections with synthetic data.

## Provider/model change — 2026-11-05

- [x] Select OpenAI or OpenRouter independently for speech and memo, with editable model IDs and OpenAI defaults.
- [x] Remove direct Deepgram requests while retaining historical provider runs and backups.
- [ ] Complete the remaining live acceptance matrix: production-origin authenticated CORS/account access, current model availability, reconciled provider billing and annotated speaker quality. Exact authorized browser calls and their limitations are recorded in [validation](docs/VALIDATION.md).

## Requested preset and cost usage — 2026-11-05 (implementation and validation)

Requirements: [product](docs/PRODUCT.md#requested-preset-and-cost-visibility-planned-2026-11-05) and [provider contracts](docs/PROVIDERS.md#planned-preset-and-usage-evidence--2026-11-05). The requested preset selects OpenRouter `elevenlabs/scribe-v2` for transcription and OpenAI `gpt-6-luna` for notes. Local/offline checks exercise bounded compaction on one long recording; the paid long-recording memo request predates the current fragment-array transport and does not validate it. See [validation](docs/VALIDATION.md) for scope and limitations. The input cap, semantic review and remaining acceptance checks still apply.

- [x] Add the requested pair as the recommended preset/default for fresh settings. Provider/model customization, independent keys, stale-tab protection and recovery remain preserved; selecting a preset sends no request and has no silent fallback.
- [x] Show each stage’s provider, model, recipient and estimated cost or unknown before the existing send confirmation, with dated rate source, unit and assumptions where available.
- [x] Normalize, validate and persist allowlisted per-attempt usage/cost fields independently of transcript/memo validation, including provider/model, USD reported versus estimate, rate provenance, cache counts and request/billing state. Invalid or absent fields remain distinguishable as unknown; old jobs/backups remain readable.
- [x] Show per-stage usage/cost and meeting-level summaries in processing history. Reported amounts and estimates remain separate; unknown or possibly charged attempts make totals incomplete; restored copies and duplicate attempts are not silently combined.
- [x] Provide English and Simplified Chinese for the implemented preset, usage, cost, errors, unknown and accessible status text; narrow-layout and browser accessibility checks are recorded.
- [x] Add focused synthetic coverage for fresh/upgraded settings, custom models, missing keys, no paid call on preset selection, independent credentials, zero/missing/malformed usage, cache counts, partial totals, old backups, failure/cancellation/timeout and no duplicate submission. Current official pricing remains documentation evidence, not a hard-coded account cap.
- [ ] Validate provider billing reconciliation and current account/model behavior with the user’s keys on the finished deployed site; no automatic retry is permitted.
- [x] Continue the evidence-preserving long-recording path above the serialized input limit with a bounded, confirmed extraction/synthesis pipeline, per-request checkpoints/accounting and reviewed recovery. Synthetic unit/browser/backup/source-revision coverage is recorded in [validation](docs/VALIDATION.md#bounded-long-memo-execution-and-acceptance-tools--2026-11-06). Real multi-stage provider and semantic acceptance remain open; arbitrary-length support and audio splitting are not claimed.

## Completed foundation

- [x] D01 — Retrieve the original KB product design and record the user's browser-first direction.
- [x] D02 — Document product scope, browser architecture, feasibility evidence, deployment, and release gates.
- [x] D03 — Inspect Pages configuration: workflow-based publishing and HTTPS enabled; no working app deployment established by that inspection.
- [x] D04 — Prepare an inactive, pinned Actions example with PR checks and trusted-main publication.
- [x] D05 — Validate documentation links, whitespace, example YAML, embedded shell syntax, and referenced action commits.
- [x] D06 — Commit and push the design package to `main`: `48b706a9a61e76782b0a5f430c149e72d0f9f8e9`.

## Phase 0 — validate the browser speech route

Dependency: the agreed product contract. Use a minimal browser harness; application foundation work can proceed with synthetic data while live evaluation prerequisites are pending. A real speech provider remains a gate for the speaker-aware release.

- [x] V01 — Define the candidate speech/memo provider matrix, including separate key requirements, metadata, limits, lifecycle, and pricing basis.
- [ ] V02 — Prepare and annotate a small private, consented evaluation set covering Chinese/English, Singlish, ERP terms, 2–5 speakers, noise, overlap, short replies, silence and a long recording.
- [ ] V03 — Complete authenticated production-origin CORS, request-header, supported-format, response-visibility and account-access verification for each candidate. Unauthenticated preflight probes are recorded as partial evidence only.
- [x] V04 — Demonstrate real speaker/time evidence from the durable Scribe candidate in the user’s MP3: five anonymous labels and preserved word timing were delivered and reviewed in Chrome. Independent identity/accuracy remains unresolved.
- [ ] V05 — Measure transcription errors, speaker confusion, unknown coverage, number/date errors, human correction time, runtime, and actual cost against an annotated subset.
- [ ] V06 — Measure device memory and practical input limits; verify valid audio chunks, source offsets, and cross-chunk speaker mapping when needed.
- [x] V07 — Test timeout, disconnect, broken stream, cancellation, and provider-job recovery without hidden resubmission or SDK retries.
- [x] V08 — Record the selected provider, supported browsers, observed limitations, and remaining blockers in the feasibility document.

Acceptance: direct browser operation and usable speaker/time output are demonstrated with recorded evidence. An imported or text-only transcript does not satisfy automatic speaker separation. The proposed 10–15-minute review target per hour of audio is evaluated against a manual baseline, not reported as an achieved capability.

## Phase 1 — scaffold the PWA and build checks

Dependency: product and architecture decisions. Synthetic UI/storage work does not depend on paid provider access.

- [x] F01 — Create the TypeScript/Vite app, choose compatible dependency versions, commit the npm lockfile, and pin the local/CI Node major.
- [x] F02 — Implement project-base configuration and hash navigation for `/PWA-AI-Meeting-Memo-BYOK/`.
- [x] F03 — Build Meeting Library, New Meeting/Import, Processing, Speaker Review, Transcript Editor, Memo Review, and Settings screen foundations.
- [x] F04 — Establish accessible controls, responsive layout, compact evidence player, safe areas, opaque theme-aware system chrome, and mobile form sizing.
- [x] F05 — Add manifest identity, start URL/scope, application icons, and install guidance matched to the deployment base.
- [x] F06 — Implement scoped/versioned app-shell caching and a truthful offline state; bypass provider traffic and user content in response caches.
- [x] F07 — Implement waiting-worker notification, draft-safe user-controlled activation, visible update progress, and failure recovery.
- [x] F08 — Add the documented lint, typecheck, unit, build, and production-path browser scripts using synthetic fixtures.
- [x] F09 — Verify local clean install/build, hash-link refresh, manifest/assets/worker paths, offline shell, and update from build N to N+1.

Acceptance: a runnable static app and repeatable checks exist. Provider quality and full meeting processing may still be pending; those capabilities are not advertised as complete.

## Phase 2 — local meetings, evidence, and speaker corrections

Dependency: F01–F04. Begin with validated synthetic/imported evidence; preserve the distinction from real provider output.

- [x] S01 — Define versioned schemas and stable IDs for meetings, audio, runs, speakers, segment revisions, review operations, memo versions, and jobs.
- [x] S02 — Implement short IndexedDB transactions and revision-checked multi-tab writes with a supported writer-lock/lease strategy.
- [x] S03 — Add meeting creation/edit/delete and audio import, metadata, persistence state, playback, and object-URL cleanup.
- [x] S04 — Import plain text and structured transcripts with schema/resource validation; leave absent speaker/time/audio evidence explicit.
- [x] S05 — Build speaker samples, naming/confirmation, unknown identity, overlap indicators, and independent run/chunk label namespaces.
- [x] S06 — Implement transcript text edits, source playback, single/bulk reassignment with impact preview, speaker merge, segment split, and undo.
- [x] S07 — Preserve immutable original outputs and revision lineage; ensure historical citations survive merge/split and source changes mark memo review stale.
- [x] S08 — Handle quota/persistence denial, missing audio, interrupted writes, and deletion of this meeting's related records without touching unrelated origin storage.
- [x] S09 — Add versioned JSON/full backup export and validated restore, including ID collisions, absent audio, migrations, and exclusion of credentials.
- [x] S10 — Verify real-browser transactions, reload/restore, multi-tab conflicts, quota failures, corrections, and undo using meaningful fixtures.

Acceptance: meeting data and corrections survive reload and backup/restore. Original and revised evidence remain distinguishable and replayable where audio exists.

## Phase 3A — BYOK audio processing and recovery

Dependency: Phase 0 provider decision and Phase 2 storage/evidence contracts.

- [x] I01 — Implement provider-specific key selection, explicit forget, safe rendering, and redacted errors. The original memory-only store was later replaced by user-requested local IndexedDB persistence.
- [x] I02 — Implement the selected speech adapter with verified capability checks, normalized output, sanitized provenance, and explicit SDK retry settings.
- [x] I03 — Add data-destination confirmation, dated stage estimates, unknown-rate handling, and explicit authorization before submission.
- [x] I04 — Implement supported audio preparation in bounded workers; preserve independent channels and source offsets and reject unsupported inputs gracefully.
- [x] I05 — Persist job intent, per-chunk results, provisional stream state, and separate execution/billing status.
- [x] I06 — Implement pause/cancel/reload recovery, key re-entry, verified file re-selection, and polling of recorded provider job IDs where supported.
- [x] I07 — Handle ambiguous paid outcomes through review; prevent automatic resubmission from the scheduler, SDK, worker, or connectivity event.
- [x] I08 — Run authorized browser integration and failure tests for the recorded OpenRouter Scribe and OpenAI/OpenRouter memo calls; provider/model, browser, usage and outcomes are recorded without storing private recordings or keys in Git. Production-origin and account-wide reconciliation remain separate gates.

Acceptance: a real supported recording produces usable local evidence, completed results survive interruption, and uncertain requests are never silently resubmitted.

## Phase 3B — memo generation, human review, and export

Dependency: Phase 2 reviewed evidence. Real audio-to-memo acceptance also depends on Phase 3A.

- [x] M01 — Implement the memo adapter with bounded input, structured validation, refusal/truncation handling, and source-preserving extraction/synthesis when needed.
- [x] M02 — Generate summary, discussion, decisions, action items, open questions, and risks with validated segment/revision references.
- [x] M03 — Keep owner/date/amount unknowns nullable; preserve relative date wording, meeting timezone, and the distinction between suggestions and decisions.
- [x] M04 — Add item accept/edit/reject and transcript/audio navigation; validate that a reference is both resolvable and appropriate for human review.
- [x] M05 — Propagate source changes to stale review state; regenerate into a new version without overwriting accepted human edits.
- [x] M06 — Export Markdown, TXT, and versioned JSON with review/unknown state; verify the complete recording-to-reviewed-memo-to-backup/restore flow.

Acceptance: users can inspect the evidence behind every supported memo claim, correct it, preserve their edits, and export a faithful result. Valid JSON and existing source IDs alone do not establish factual accuracy.

## Phase 4 — GitHub Actions publication and release hardening

Dependency: runnable app, passing documented checks, and authorization for publication. An initial synthetic-data scaffold can be published after Phase 1; a speaker-aware product release requires all applicable P0 gates above.

- [x] R01 — Documented acceptance of the shared owner-hostname trust boundary for this personal GitHub Pages Beta; a dedicated hostname remains recommended before sensitive production use.
- [x] R02 — Review the inactive workflow against the real package/scripts and current action/runtime compatibility, then activate `.github/workflows/pages.yml`.
- [x] R03 — Verify that PRs only check, failed checks prevent publication, only trusted `main` publishes, stale commits are skipped, and only `dist/` is uploaded.
- [x] R04 — Configure/recheck the `github-pages` environment branch restrictions; keep provider keys out of workflow and build inputs.
- [x] R05 — Complete an authorized deployment and record the source commit, successful Actions run, deployment URL, and deployed asset/build identity.
- [ ] R06 — Complete authenticated production-origin CORS/account access and installed-launch checks; HTTPS, hash refresh, worker scope, cache behavior and static unexpected-network checks are already recorded as PASS.
- [ ] R07 — Test physical iPhone Safari/standalone and Android Chrome/installed behavior, including phone suspension, keyboard, safe areas, touch, zoom, accessibility, and overflow.
- [ ] R08 — Exercise the full storage, audio, billing/recovery, evidence, memo, and privacy matrix in the roadmap; establish measured supported file/device limits.
- [x] R09 — Verify deployed N-to-N+1 update behavior, active-draft/request protection, old-client assets, migration compatibility, and revert/forward-fix recovery.
- [x] R10 — Update README and provider/support documentation to match shipped behavior and report PASS/FAIL/NOT RUN/N/A with evidence for every applicable release gate.

Acceptance: a verified deployed version completes the real speaker-aware workflow on its declared browser/device set. Unsupported cases remain visible, and a successful deployment is distinguished from an installed client's update.

## Later work

These items are outside the first P0 release and must not become hidden prerequisites.

- [ ] B01 — Microphone capture with clearly documented sources and permissions.
- [ ] B02 — Richer waveform, ERP templates, glossary, and additional browser-validated engines.
- [x] B03 — Evaluate optional encrypted backups and their recovery/key design; design evaluation complete, implementation deferred. See [optional capability evaluation](docs/FUTURE-EVALUATION.md).
- [x] B04 — Evaluate browser-local inference or an optional companion with explicit installation, authentication, and data ownership; evaluated and deferred pending measured device/quality evidence. No runtime added.
- [x] B05 — Evaluate live transcription/diarization, meeting-platform audio access, collaboration, and cross-device synchronization as separate scopes; four distinct scopes assessed and deferred. No capability shipped.

## Group-chat playback delivery checkpoint - 2026-11-06

The sequential group-chat view is implemented: fixed N-speaker roster above the bounded transcript, left-aligned bubbles with names/avatars/timestamps, exact fragment emphasis, overlap attribution, 180ms active color transition, state-preserving seek, explicit follow recovery and separately paged untimed evidence. Audio-energy halos remain a separate unchecked task. Local checks: 88 unit tests, 28 existing two-engine speaker/language cases and four updated/new group-chat cases passed; lint/type/build/artifact and both-engine PWA checks passed. Publication still requires the trusted-main workflow and served-build readback. Physical-device and real-provider gates remain open.

## Current next action and evidence

Fragment projection checkpoint (2026-11-06): `dcb2ef1` retains copied source IDs, nullable times, speaker IDs, text and explicit untimed status. The renderer now highlights exact source fragments; bubble/gap navigation seeks while preserving play/pause state and clears old bounded sample cues. Local verification: 88 unit tests, 26 Chromium/WebKit speaker-review cases, lint/type/build/artifact and both-engine PWA checks passed. Historical integration and publication status at this checkpoint is superseded by the 2026-11-16 reconciliation above. Audio-energy sampling, physical-device and native-media limitations remain separate open gates.

The browser application, bounded long-memo pipeline and automatic Pages publication workflow are implemented and published. Exact source identities, successful runs and the latest scoped production readback are maintained in [validation](docs/VALIDATION.md); historical dated checkpoints below are not the current release identity. Real provider, annotated quality and physical-device acceptance remain separate open gates. Use [the owner test pack](docs/RELEASE-ACCEPTANCE.md), including its synthetic full-backup generator; optional B01-B05 decisions are in [the evaluation](docs/FUTURE-EVALUATION.md). The owner selected BYOK entry on the finished website; development does not create or transfer keys automatically. Use a private, consented recording and keep recordings/keys out of Git and CI.

| Evidence | Current result |
| --- | --- |
| Design and implementation on `main` | Each completed task has its own committed/pushed checkpoint in [implementation evidence](docs/IMPLEMENTATION-LOG.md) and Git history |
| Current application release | `01dbe20`, [run 43798887650](https://github.com/yapweijun1996/PWA-AI-Meeting-Memo-BYOK/actions/runs/43798887650): verify and publish PASS on Node 22.23.3; 281 unit tests, 297 browser cases passed / 3 skipped, PWA/artifact PASS |
| Production readback | Exact served `01dbe20fa9e6242e10abc6765b9f82cd85961e6d`; fresh 390px Chromium, no horizontal overflow, page exceptions or provider requests |
| Historical additional local acceptance | Earlier v1/v2 compatibility, native Chromium playback and synthetic-owner-archive checks remain checkpoint evidence in validation; they are not fresh device or codec acceptance |
| Active auto-deployment | [Trusted-main workflow](.github/workflows/pages.yml) checks before publishing only `dist/`; no provider keys are used |
| Historical releases and repaired failures | Preserved in [validation](docs/VALIDATION.md); earlier failures do not describe the current release |
| Live provider/device evaluation | Exact authorized browser calls and Chrome speaker/time delivery are recorded; annotated model quality, production account/CORS reconciliation and physical-phone acceptance remain NOT RUN |

Remaining acceptance gates are deliberate and stay unchecked:

| Tasks | Required external evidence |
| --- | --- |
| V02–V03, V05–V06 | Consented annotated recordings, authenticated provider/account checks, quality/cost/review-time measurements and real device/resource limits |
| I08 | Authorized browser integration is recorded; future provider/account changes still require a fresh run |
| R01 | The personal Beta accepts the shared owner-hostname trust boundary; a dedicated hostname remains an optional hardening step before sensitive production use |
| R06 | Hosting/static/offline checks PASS; authenticated production-origin provider CORS and installed launch still NOT RUN |
| R07 | Physical iPhone/Android Safari/Chrome and installed-mode tests |
| R08 | Complete release matrix, including the outstanding real provider and physical-device evidence |

B01-B05 remain optional beyond P0; B03-B05 checkmarks record design evaluations, not implementation. B01 and B02 remain unimplemented. A deployed beta and passing mocked tests do not replace real speaker-aware product acceptance.

When starting work, confirm current repository state. When finishing a task, add the relevant commit or sanitized verification reference, update the checkbox, and identify any failed or unrun acceptance check. Keep detailed verification procedures in the linked documents rather than duplicating them here.

## UI redesign phases (mockup v1.1) - 2026-11-07

Visual direction only; no business logic, storage schema, provider or pricing change. Mockup-only content (recording, Templates, notifications, duration/storage statistics, user name) is intentionally not implemented.

- [x] Phase 1 - app shell: collapsible desktop sidebar (icon rail, accessible names, `localStorage` preference), tablet rail by default below 1024px, mobile drawer unchanged. Mobile bottom navigation and design-token realignment were deliberately not done: the existing drawer is retained and tokens need a contrast review first.
- [x] Phase 2 - dashboard and library: empty library hides KPI cards, toolbar and banner and keeps one primary action; populated library keeps real counts only; search clear control.
- [ ] Phase 3 - meeting detail and AI states: audited only, no change; existing stages already map to real workflow states and `MeetingWorkspace.tsx` is high risk.
- [x] Phase 4 (partial historical checkpoint) - 7 viewports from 320x568 to 1440x900 on both engines: no horizontal overflow and no axe wcag2a/2aa/22aa violations on the empty dashboard. Physical devices and real screen readers remain NOT RUN. Dark theme is now implemented; selected theme-role checks do not establish complete DS06 contrast/visual acceptance.
