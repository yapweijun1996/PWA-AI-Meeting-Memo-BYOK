# Implementation tasks

Updated: 2026-11-04. Current stage: documentation complete; application implementation has not started.

This file tracks execution. [Product requirements](docs/PRODUCT.md), [architecture](docs/ARCHITECTURE.md), [feasibility](docs/FEASIBILITY.md), [deployment](docs/DEPLOYMENT.md), and [the roadmap](docs/ROADMAP.md) define the detailed contracts. A checked task requires evidence, not just code or a proposed design.

## Working rules

- Keep the core browser-first, with runtime BYOK and static GitHub Pages hosting. A companion and backend remain optional future modes.
- Preserve speaker correction, original results, source references, and human edits throughout the workflow.
- Keep keys in memory by default and out of Git, browser persistence, build artifacts, logs, and exports.
- Use synthetic fixtures in CI. Live API tests require explicit authorization for the data and potential charges.
- Persist completed work and distinguish provider polling from resubmitting a paid request. Never automatically retry an unknown paid outcome.
- Record app commit, environment, test procedure, and result when completing a validation task. Real-browser, physical-device, and mocked tests establish different things.

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
- [ ] V02 — Prepare a small private, consented evaluation set covering Chinese/English, Singlish, ERP terms, 2–5 speakers, noise, overlap, short replies, silence, and a long recording.
- [ ] V03 — Verify exact production-origin CORS behavior, request headers, supported formats, response visibility, and account access for each candidate.
- [ ] V04 — Demonstrate real speaker/time evidence from at least one durable candidate. Missing timestamps or identity remain unresolved.
- [ ] V05 — Measure transcription errors, speaker confusion, unknown coverage, number/date errors, human correction time, runtime, and actual cost against an annotated subset.
- [ ] V06 — Measure device memory and practical input limits; verify valid audio chunks, source offsets, and cross-chunk speaker mapping when needed.
- [ ] V07 — Test timeout, disconnect, broken stream, cancellation, and provider-job recovery without hidden resubmission or SDK retries.
- [ ] V08 — Record the selected provider, supported browsers, observed limitations, and remaining blockers in the feasibility document.

Acceptance: direct browser operation and usable speaker/time output are demonstrated with recorded evidence. An imported or text-only transcript does not satisfy automatic speaker separation. The proposed 10–15-minute review target per hour of audio is evaluated against a manual baseline, not reported as an achieved capability.

## Phase 1 — scaffold the PWA and build checks

Dependency: product and architecture decisions. Synthetic UI/storage work does not depend on paid provider access.

- [x] F01 — Create the TypeScript/Vite app, choose compatible dependency versions, commit the npm lockfile, and pin the local/CI Node major.
- [x] F02 — Implement project-base configuration and hash navigation for `/PWA-AI-Meeting-Memo-BYOK/`.
- [x] F03 — Build Meeting Library, New Meeting/Import, Processing, Speaker Review, Transcript Editor, Memo Review, and Settings screen foundations.
- [x] F04 — Establish accessible controls, responsive layout, compact evidence player, safe areas, opaque theme-aware system chrome, and mobile form sizing.
- [ ] F05 — Add manifest identity, start URL/scope, application icons, and install guidance matched to the deployment base.
- [ ] F06 — Implement scoped/versioned app-shell caching and a truthful offline state; bypass provider traffic and user content in response caches.
- [ ] F07 — Implement waiting-worker notification, draft-safe user-controlled activation, visible update progress, and failure recovery.
- [ ] F08 — Add the documented lint, typecheck, unit, build, and production-path browser scripts using synthetic fixtures.
- [ ] F09 — Verify local clean install/build, hash-link refresh, manifest/assets/worker paths, offline shell, and update from build N to N+1.

Acceptance: a runnable static app and repeatable checks exist. Provider quality and full meeting processing may still be pending; those capabilities are not advertised as complete.

## Phase 2 — local meetings, evidence, and speaker corrections

Dependency: F01–F04. Begin with validated synthetic/imported evidence; preserve the distinction from real provider output.

- [x] S01 — Define versioned schemas and stable IDs for meetings, audio, runs, speakers, segment revisions, review operations, memo versions, and jobs.
- [x] S02 — Implement short IndexedDB transactions and revision-checked multi-tab writes with a supported writer-lock/lease strategy.
- [ ] S03 — Add meeting creation/edit/delete and audio import, metadata, persistence state, playback, and object-URL cleanup.
- [ ] S04 — Import plain text and structured transcripts with schema/resource validation; leave absent speaker/time/audio evidence explicit.
- [ ] S05 — Build speaker samples, naming/confirmation, unknown identity, overlap indicators, and independent run/chunk label namespaces.
- [ ] S06 — Implement transcript text edits, source playback, single/bulk reassignment with impact preview, speaker merge, segment split, and undo.
- [x] S07 — Preserve immutable original outputs and revision lineage; ensure historical citations survive merge/split and source changes mark memo review stale.
- [ ] S08 — Handle quota/persistence denial, missing audio, interrupted writes, and deletion of this meeting's related records without touching unrelated origin storage.
- [ ] S09 — Add versioned JSON/full backup export and validated restore, including ID collisions, absent audio, migrations, and exclusion of credentials.
- [ ] S10 — Verify real-browser transactions, reload/restore, multi-tab conflicts, quota failures, corrections, and undo using meaningful fixtures.

Acceptance: meeting data and corrections survive reload and backup/restore. Original and revised evidence remain distinguishable and replayable where audio exists.

## Phase 3A — BYOK audio processing and recovery

Dependency: Phase 0 provider decision and Phase 2 storage/evidence contracts.

- [ ] I01 — Implement a memory-only credential store, provider-specific key selection, explicit forget, safe rendering, and redacted errors.
- [ ] I02 — Implement the selected speech adapter with verified capability checks, normalized output, sanitized provenance, and explicit SDK retry settings.
- [ ] I03 — Add data-destination confirmation, dated stage estimates, unknown-rate handling, and explicit authorization before submission.
- [ ] I04 — Implement supported audio preparation in bounded workers; preserve independent channels and source offsets and reject unsupported inputs gracefully.
- [ ] I05 — Persist job intent, per-chunk results, provisional stream state, and separate execution/billing status.
- [ ] I06 — Implement pause/cancel/reload recovery, key re-entry, verified file re-selection, and polling of recorded provider job IDs where supported.
- [ ] I07 — Handle ambiguous paid outcomes through review; prevent automatic resubmission from the scheduler, SDK, worker, or connectivity event.
- [ ] I08 — Run authorized browser integration and failure tests; record provider/model, fixture, browser, source commit, usage, and outcome without storing private recordings in Git.

Acceptance: a real supported recording produces usable local evidence, completed results survive interruption, and uncertain requests are never silently resubmitted.

## Phase 3B — memo generation, human review, and export

Dependency: Phase 2 reviewed evidence. Real audio-to-memo acceptance also depends on Phase 3A.

- [ ] M01 — Implement the memo adapter with bounded input, structured validation, refusal/truncation handling, and source-preserving extraction/synthesis when needed.
- [ ] M02 — Generate summary, discussion, decisions, action items, open questions, and risks with validated segment/revision references.
- [ ] M03 — Keep owner/date/amount unknowns nullable; preserve relative date wording, meeting timezone, and the distinction between suggestions and decisions.
- [ ] M04 — Add item accept/edit/reject and transcript/audio navigation; validate that a reference is both resolvable and appropriate for human review.
- [ ] M05 — Propagate source changes to stale review state; regenerate into a new version without overwriting accepted human edits.
- [ ] M06 — Export Markdown, TXT, and versioned JSON with review/unknown state; verify the complete recording-to-reviewed-memo-to-backup/restore flow.

Acceptance: users can inspect the evidence behind every supported memo claim, correct it, preserve their edits, and export a faithful result. Valid JSON and existing source IDs alone do not establish factual accuracy.

## Phase 4 — GitHub Actions publication and release hardening

Dependency: runnable app, passing documented checks, and authorization for publication. An initial synthetic-data scaffold can be published after Phase 1; a speaker-aware product release requires all applicable P0 gates above.

- [ ] R01 — Choose a dedicated production hostname or explicitly document acceptance of the shared owner-hostname trust boundary for a personal prototype.
- [ ] R02 — Review the inactive workflow against the real package/scripts and current action/runtime compatibility, then activate `.github/workflows/pages.yml`.
- [ ] R03 — Verify that PRs only check, failed checks prevent publication, only trusted `main` publishes, stale commits are skipped, and only `dist/` is uploaded.
- [ ] R04 — Configure/recheck the `github-pages` environment branch restrictions; keep provider keys out of workflow and build inputs.
- [ ] R05 — Complete an authorized deployment and record the source commit, successful Actions run, deployment URL, and deployed asset/build identity.
- [ ] R06 — Test actual production-origin CORS, HTTPS, hash refresh, installed launch, worker scope, cache behavior, and unexpected network destinations.
- [ ] R07 — Test physical iPhone Safari/standalone and Android Chrome/installed behavior, including phone suspension, keyboard, safe areas, touch, zoom, accessibility, and overflow.
- [ ] R08 — Exercise the full storage, audio, billing/recovery, evidence, memo, and privacy matrix in the roadmap; establish measured supported file/device limits.
- [ ] R09 — Verify deployed N-to-N+1 update behavior, active-draft/request protection, old-client assets, migration compatibility, and revert/forward-fix recovery.
- [ ] R10 — Update README and provider/support documentation to match shipped behavior and report PASS/FAIL/NOT RUN/N/A with evidence for every applicable release gate.

Acceptance: a verified deployed version completes the real speaker-aware workflow on its declared browser/device set. Unsupported cases remain visible, and a successful deployment is distinguished from an installed client's update.

## Later work

These items are outside the first P0 release and must not become hidden prerequisites.

- [ ] B01 — Microphone capture with clearly documented sources and permissions.
- [ ] B02 — Richer waveform, ERP templates, glossary, and additional browser-validated engines.
- [ ] B03 — Evaluate optional encrypted backups and their recovery/key design.
- [ ] B04 — Evaluate browser-local inference or an optional companion with explicit installation, authentication, and data ownership.
- [ ] B05 — Evaluate live transcription/diarization, meeting-platform audio access, collaboration, and cross-device synchronization as separate scopes.

## Current next action and evidence

Start V01 and the minimal V03 browser harness; F01–F04 can progress independently with synthetic data. Live sample availability, provider access, and charge authorization are prerequisites for paid evaluations, not for writing the scaffold.

| Evidence | Current result |
| --- | --- |
| Design package on `main` | Completed in commit `48b706a` |
| Pages configuration inspection | Recorded in the deployment document; configuration is not a successful deployment |
| Application checks and provider evaluation | NOT RUN; application not implemented |
| Active auto-deployment and deployed PWA | Not implemented/verified |

When starting work, confirm current repository state. When finishing a task, add the relevant commit or sanitized verification reference, update the checkbox, and identify any failed or unrun acceptance check. Keep detailed verification procedures in the linked documents rather than duplicating them here.
