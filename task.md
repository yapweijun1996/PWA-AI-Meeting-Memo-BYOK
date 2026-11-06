# Implementation tasks

Updated: 2026-11-06. The owner authorized the synchronized playback improvement, per-task commits/main merges/pushes and deployment, with final owner testing after delivery. The existing vertical-space UI has passed all 80 browser cases locally and in Linux CI; see [validation](docs/VALIDATION.md#workspace-vertical-space-closeout--2026-11-06). CI reliability fix `02afcbe` passed 70 unit tests, 80 browser cases, both-engine PWA updates and artifact checks in [run 42155181979](https://github.com/yapweijun1996/PWA-AI-Meeting-Memo-BYOK/actions/runs/42155181979); publication/readback and the new playback candidate are tracked below. Production API validation has not resumed, no new paid request or reservation occurred, and protective reservations remain US$4.85. Physical-device and annotated-quality gates remain open.

This file tracks execution. [Product requirements](docs/PRODUCT.md), [architecture](docs/ARCHITECTURE.md), [feasibility](docs/FEASIBILITY.md), [deployment](docs/DEPLOYMENT.md), and [the roadmap](docs/ROADMAP.md) define the detailed contracts. A checked task requires evidence, not just code or a proposed design.

## Working rules

- Keep the core browser-first, with runtime BYOK and static GitHub Pages hosting. A companion and backend remain optional future modes.
- Preserve speaker correction, original results, source references, and human edits throughout the workflow.
- The user selected unencrypted local browser persistence for keys; keep them out of Git, meeting exports, build artifacts, logs, and caches, and disclose the shared-origin trust boundary.
- Use synthetic fixtures in CI. Live API tests require explicit authorization for the data and potential charges.
- Persist completed work and distinguish provider polling from resubmitting a paid request. Never automatically retry an unknown paid outcome.
- Record app commit, environment, test procedure, and result when completing a validation task. Real-browser, physical-device, and mocked tests establish different things.

## Synchronized playback improvement — owner authorized 2026-11-06

The owner approved the supplied Playback/Naming mockups and authorized coding, per-task commits, main merges/pushes and deployment. Final owner testing follows delivery. This work uses synthetic fixtures; paid provider validation and independent diarization quality evaluation remain separate.

- [x] Implement and locally verify the core audio-clock synchronization: one `HTMLAudioElement.currentTime` timeline drives active speakers, live captions and transcript highlighting, including pause, seek, speed, end, overlap, gaps and missing timestamps.
- [x] Provide Playback and Edit Speakers modes with a persistent player, desktop two-column/mobile single-column layout, adjustable captions, explicit follow controls and a bounded long-transcript view; preserve source IDs, edits, identity confirmation and CAS.
- [ ] Commit/merge/push the independently verified core, publish through the existing trusted-main workflow and read back the served build.
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
- [ ] Continue the evidence-preserving long-recording path for recordings above the serialized input limit; current bounded compaction is validated, but arbitrary-length support is not claimed.

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
- [ ] B03 — Evaluate optional encrypted backups and their recovery/key design.
- [ ] B04 — Evaluate browser-local inference or an optional companion with explicit installation, authentication, and data ownership.
- [ ] B05 — Evaluate live transcription/diarization, meeting-platform audio access, collaboration, and cross-device synchronization as separate scopes.

## Current next action and evidence

The browser application and automatic Pages publication workflow are implemented; the current patch is blocked on the failed CI release gate above and has not been published. The user chose to enter BYOK credentials in the finished website for live acceptance; development creates no provider key. Use a private, consented recording for that acceptance and keep recordings/keys out of Git and CI.

| Evidence | Current result |
| --- | --- |
| Design and implementation on `main` | Each completed task has its own committed/pushed checkpoint in [implementation evidence](docs/IMPLEMENTATION-LOG.md) and Git history |
| Local candidate checks | Previous candidate `93c325cceb45b7d3`: 70 unit tests, 74 browser cases, lint, typecheck, production build, two-engine PWA checks and artifact checks PASS locally. This evidence predates the CI CAS fix. |
| Current CI release gate | [Run 42004598184](https://github.com/yapweijun1996/PWA-AI-Meeting-Memo-BYOK/actions/runs/42004598184) FAIL: 73/74, Linux WebKit memo CAS fixture; publication skipped and no paid request. Focused guard coverage passes; fixture repair and full rerun remain pending. Exact scope and limitations are recorded in [validation](docs/VALIDATION.md) |
| Active auto-deployment | [Trusted-main workflow](.github/workflows/pages.yml) checks before publishing only `dist/`; no provider keys are used |
| Historical successful publication | [Run 41845407515](https://github.com/yapweijun1996/PWA-AI-Meeting-Memo-BYOK/actions/runs/41845407515), build `18cd59c`; served identity, HTTPS, scoped worker, hash refresh, synthetic storage and offline reload PASS in both engines. This is not the current patch. |
| Historical update hardening | Stale-HTTP-cache regression fixed; [run 41847942972](https://github.com/yapweijun1996/PWA-AI-Meeting-Memo-BYOK/actions/runs/41847942972) published `6e0fcdf`; actual Chromium/WebKit upgrade, saved editor, old assets and new-build offline reload PASS. Current patch still needs publication. |
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

B01–B05 remain later work outside the first P0 scope. A deployed beta and passing mocked tests do not replace real speaker-aware product acceptance.

When starting work, confirm current repository state. When finishing a task, add the relevant commit or sanitized verification reference, update the checkbox, and identify any failed or unrun acceptance check. Keep detailed verification procedures in the linked documents rather than duplicating them here.
