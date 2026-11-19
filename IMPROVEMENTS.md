# Prioritized improvement backlog

Planning baseline is `origin/main` at `3c0e06b`, reviewed on 2026-11-19. Entries propose capabilities, hardening, or acceptance work. Existing behavior is described from source and dated project records. Runtime, provider, recording-quality, and physical-device acceptance remain **unverified in this review**. Related checklist IDs identify shared work and dependencies.

| Rating | Meaning |
| --- | --- |
| P0 | Protects data or billing, establishes a measurement baseline, or gates production acceptance |
| P1 | Advances a core workflow once its prerequisites are available |
| P2 | Improves an established workflow or supports a bounded evaluation |
| P3 | Optional, subject to demonstrated demand or a validated limitation |
| S / M / L | Relative effort for a focused change, a multi-surface delivery, or work spanning architecture and acceptance |

Resource requirements cover completion of each item. Paid means separately authorized real provider requests. Devices means physical hardware beyond desktop browser testing. The browser owns meeting data and the normal workflow, with static GitHub Pages hosting and runtime BYOK. The current keys are unencrypted in a separate, origin-scoped IndexedDB database and remain outside meeting backups. A lightweight backend can be evaluated only after a measured browser or provider limitation and a verified processing and recovery path. Provisioning, spending, and publication require separate authorization.

## PWA, offline, and updates

### IMP-001 — Installed-phone offline and update acceptance

Give mobile reviewers a documented supported envelope. On iPhone Safari and standalone, and Android Chrome and installed mode, exercise install/launch, offline meeting editing, local playback, supported import and export, suspension/relaunch, and N→N+1 activation with immediate progress and recoverable failure. Check safe areas, system chrome, orientation, keyboard, zoom, and screen-reader announcements with IMP-016. Record the device, OS, browser, build, and explicit unsupported behavior. The worker and [update harness](scripts/test-update.mjs) already provide desktop coverage. [Roadmap matrix](docs/ROADMAP.md#verification-matrix) · [REL02 and R07](task.md)

- **Value:** Mobile reviewers can plan around tested offline and installed behavior. **Effort:** M. **Risk:** OS suspension, quota and platform UI can differ from automation.
- **Prerequisites:** Two compatible release builds, isolated device profiles, synthetic meetings and locally stored test audio. **Paid:** No, use mocks for the active-request guard. **Devices:** iPhone and Android required. **Backend:** No.
- **Priority:** P0. Physical-device evidence is required for the declared mobile release scope.

### IMP-002 — Extend real-worker coverage for staggered updates

Extend the existing N→N+1 and forward-recovery harness with multiple tabs across successive releases. Verify explicit activation, no forced reload of other tabs, draft/edit/write and active-request protection, compatible old assets, safe handling of an incompatible schema, and cache pruning confined to the app. Serve the test builds at the Pages base path and verify manifest identity, worker scope, and navigation. [Worker](src/pwa/worker.template.js) · [Update controls](src/pwa/status.tsx) · [Roadmap matrix](docs/ROADMAP.md#verification-matrix)

- **Value:** Reviewers with multiple open tabs can finish work through staggered updates. **Effort:** M. **Risk:** Controller changes and schema evolution can strand an older client.
- **Prerequisites:** The real-worker harness, compatible and incompatible synthetic schema fixtures, and a documented old-client support window. **Paid:** No. **Devices:** No for automation, with installed acceptance in IMP-001. **Backend:** No.
- **Priority:** P1. The existing lifecycle suite provides a foundation for covering additional release transitions.

### IMP-003 — Prepare a dedicated-origin migration option

Document the current shared-hostname trust decision and rehearse export/import between isolated test origins before recommending a dedicated static hostname for sensitive meetings. Verify that unrelated browser storage is untouched, keys must be entered again, and backup limitations are visible before users leave the old origin. [Product](docs/PRODUCT.md) · [Roadmap matrix](docs/ROADMAP.md#verification-matrix) · [R01](task.md)

- **Value:** Teams handling sensitive meetings can choose an explicit browser-origin boundary. **Effort:** M. **Risk:** A hostname change can strand local meetings or suggest false isolation at the repository path.
- **Prerequisites:** IMP-020 for resumable long-meeting transfer, owner approval before any hosting change, and a static base-path/hash migration plan. **Paid:** No provider calls. **Devices:** No for rehearsal. **Backend:** No, static hostname only.
- **Priority:** P2. The personal beta has an existing trust decision, and a safe migration depends on portable recovery.

## Long recordings

### IMP-004 — Durable paged task and evidence storage

Move long-workflow sources, original responses, attempt receipts, and typed task artifacts into bounded IndexedDB pages with an additive, resumable migration and atomic publication. Reuse existing chunk speech, attempt and transcript-page stores where their contracts fit. Preserve content-backed recording identity, old-schema reads, human edits and source references. Verify crash, quota and multi-tab paths, local save recovery, and a persisted 100-attempt Pi ceiling across continuation, reload and restore with IMP-020. Keep provider polling distinct from resubmission and retain explicit billing review for uncertain outcomes. [Repository](src/storage/repository.ts) · [Chunked runner](src/jobs/chunked-runner.ts) · [QF04 and REC01–03](task.md)

- **Value:** Long-meeting users can recover costly work and complete records through failures and upgrades. **Effort:** L. **Risk:** Migration or partial writes can lose provenance, reset counters, or duplicate a provider attempt.
- **Prerequisites:** Existing REC01–03 contracts, versioned migration fixtures, and explicit transaction/failure semantics. **Paid:** No for storage and recovery contracts. **Devices:** Required for measured phone limits in IMP-005. **Backend:** No.
- **Priority:** P0. Durable checkpoints are the basis for safe restarts, complete backups, and coverage accounting.

### IMP-005 — Measure the long-recording operating envelope

Measure import, staging headroom, persistence denial, near-64 MiB legacy meeting saves, native seek and boundary offsets, channel preservation, and suspension/recovery across representative MP3 and supported M4A/MP4 variants. Include malformed files, overlapping boundaries and low-storage cases. Publish the tested duration, bytes, codec, browser/device, memory where observable, and storage envelope. The configured 4 GiB ceiling and 24,000,000-byte split threshold are application settings. Record specific blockers before considering a backend. [Audio player](src/audio/chunked-audio.ts) · [Long-audio store](src/storage/long-audio-store.ts) · [V06, R08 and storage-monitor acceptance](task.md)

- **Value:** Recording owners can choose inputs that fit their device and understand staging and recovery limits. **Effort:** L. **Risk:** Quota, codecs, and native playback timing vary by browser and device.
- **Prerequisites:** Synthetic format and quota fixtures, consented representative recordings, and retest of the affected limits after IMP-004. **Paid:** No for local measurements. **Devices:** iPhone and Android required for phone limits. **Backend:** No.
- **Priority:** P1. Measurements guide format decisions and establish where the browser path needs investment.

### IMP-006 — Account for every source range in long memos

Build a coverage ledger that marks ranges complete, partial, unavailable, or excluded with reasons. Partition by turn and topic with bounded overlaps, carry revision-bound facts through hierarchical synthesis, and re-read exact originals during verification. Check that beginning, middle, and late decisions, amendments and unknowns survive context splits. Current selective Pi reads tool-selected passages. [Pi plan](src/providers/memo-agent-plan.ts) · [Quality-first data model](docs/QUALITY-FIRST-PLAN.md#7-long-meetings-and-evidence-data-model) · [QF05](task.md)

- **Value:** Reviewers can inspect which parts were considered and identify gaps before accepting notes. **Effort:** L. **Risk:** Counting a retrieved excerpt as complete analysis can hide omissions.
- **Prerequisites:** IMP-004 paged artifacts and IMP-024 reference facts. **Paid:** Yes for real coverage-quality evaluation, with synthetic ledger tests first. **Devices:** No for initial implementation, final mobile acceptance in IMP-026. **Backend:** No.
- **Priority:** P1. Coverage accounting enables evidence-grounded analysis across context boundaries.

### IMP-007 — Orchestrate typed analysis, independent review, and repair

Use browser-compatible Pi to schedule meeting-scoped analyst, verifier, critic, and editor roles with typed artifacts and validated tools. Run fresh-context checks for material omissions, contradictions and unsupported claims. Repair affected artifacts, reverify them, and preserve prior versions and protected human facts. Use explicit destination consent, checkpointed progress, duplicate/no-progress guards, and the cumulative per-plan ceiling from IMP-004. [Browser and tool boundaries](docs/QUALITY-FIRST-PLAN.md#4-browser-architecture-and-pi-boundary) · [QF06–QF08](task.md)

- **Value:** People reviewing decisions and actions receive traceable findings and proposed corrections. **Effort:** L. **Risk:** Shared model lineage, cascading errors, and concurrent writes can compromise review independence or evidence.
- **Prerequisites:** IMP-004 durable tasks, IMP-006 coverage, IMP-024 reference set, and IMP-025 verified routes and promotion criteria. **Paid:** Yes for independent real-provider quality evaluation. **Devices:** No for initial implementation, final mobile acceptance in IMP-026. **Backend:** No.
- **Priority:** P1. This delivers the owner's quality workflow once the evidence and routing foundations are ready.

### IMP-008 — Add a bounded waveform to evidence playback

Prototype cancellable peak extraction for the active audio window and reuse the existing media clock for seek. Preserve source offsets, expose a usable nonvisual seek control, and compare navigation time against the existing player. [Chunked audio player](src/audio/chunked-audio.ts) · [B02 evaluation](docs/FUTURE-EVALUATION.md#b02--waveform-erp-templates-glossary-and-engines)

- **Value:** Listeners can find speech, silence, and evidence positions faster. **Effort:** M. **Risk:** Whole-file decoding or cached peaks can exceed device limits, and visual peaks can be mistaken for attribution.
- **Prerequisites:** IMP-005 and a measured benefit on representative recordings. **Paid:** No. **Devices:** Required for phone CPU, memory and touch acceptance. **Backend:** No.
- **Priority:** P2. Playback navigation can improve once its resource budget is known.

### IMP-009 — Evaluate local microphone capture

Prototype progressive bounded saves with start, pause, stop, permission refusal, interruption recovery, and track cleanup. Require a playable local result before any separately consented cloud send. Disclose the microphone source and keep normal file import available. [B01 evaluation](docs/FUTURE-EVALUATION.md#b01--microphone-capture) · [B01](task.md)

- **Value:** Meeting owners can create a recoverable local recording without a separate recorder. **Effort:** L. **Risk:** Mobile suspension, MIME differences, and denied permissions can cause incomplete recordings.
- **Prerequisites:** IMP-001 and IMP-005, plus recordings produced and replayed on the target devices. **Paid:** No for capture. **Devices:** iPhone and Android required. **Backend:** No.
- **Priority:** P3. The core upload, playback, and recovery workflow comes first.

## Speaker matching

### IMP-010 — Establish a labelled cross-chunk voice baseline

Use the existing export and replay tools on at least two privately held, consented recordings with independently annotated anonymous turns. Include a single-file and a one-label-per-part path where possible, then broaden the set for similar voices, short replies, overlap, and code switching. Report wrong and missed merges, abstentions, unknown coverage, correction time, and denominators per recording. Record the current label-level export's dependence on human confirmation and keep vectors private. [Voice evaluation script](scripts/evaluate-voice-matching.mjs) · [Handoff](docs/HANDOFF.md#5-evidence-and-its-limits) · [VID01b and VID10](task.md)

- **Value:** Speaker reviewers and maintainers get evidence for judging automatic continuity and its limits. **Effort:** M. **Risk:** Labels inherited from app groupings bias ground truth, and near-identical recording conditions limit generalization.
- **Prerequisites:** Consent, independent listener annotations, reproducible model and policy versions, and retained speech results where available. **Paid:** Conditional if an evaluation recording lacks retained provider output. **Devices:** No for replay, with phone checks in IMP-011 and IMP-014. **Backend:** No.
- **Priority:** P0. A real baseline is needed before calibrating or promoting any matching policy.

### IMP-011 — Qualify pinned speaker-model delivery and recovery

Reconcile upstream CC BY-SA 3.0 evidence with the pinned ONNX conversion's notices and derivation. Preserve separate consent for the asset fetch and provider transcription. Extend mock coverage for bad hashes, interrupted download, cache deletion and quota failure. After provenance review and authorization, measure the deployed download, offline reuse when required assets are present, missing-asset disclosure, and phone recovery. Weight publication requires established licence compliance. [Embedding loader](src/audio/speaker-embedding.ts) · [Handoff risks](docs/HANDOFF.md#8-risks-and-blockers) · [REL03](task.md)

- **Value:** Voice-analysis users can tell what downloads, what remains local, and how to recover. **Effort:** M. **Risk:** Unresolved licensing, asset/cache mismatch and mobile memory pressure can block delivery.
- **Prerequisites:** Licence/provenance review, a pinned manifest, synthetic asset fixtures and separately authorized deployed checks. **Paid:** No provider calls, real asset fetch required for deployed acceptance. **Devices:** iPhone and Android required for mobile recovery. **Backend:** No, the asset host is an external file source.
- **Priority:** P1. Users need a verifiable way to obtain and reuse the approved model.

### IMP-012 — Compare globally constrained matching against the current policy

Use the greedy multi-part and raw-cosine paths as baselines. Compare deterministic global clustering, calibrated scoring for single-file and one-label-per-part inputs, and controlled changes to sampling, resampling, centring, mixed-label handling and count hints. Promote a policy only on held-out evidence. Preserve original provider runs, protected edits and human pair constraints, with ambiguity/overlap, one undoable revision and revision invalidation. Automatic identities stay anonymous and meeting-scoped. Use acoustic evidence for continuity and leave names to human confirmation. [Matcher](src/domain/acoustic-speaker.ts) · [Voice gap register](gap.md#voice-identity-logic-gap-register--2026-11-16) · [VID03–08 and VID10](task.md)

- **Value:** Long-meeting users can get automatic continuity without routine listening, enrollment, or merges. **Effort:** L. **Risk:** False merges and overfitting to a head count or a single recording can hide real speakers.
- **Prerequisites:** IMP-010 frozen baselines, confirmed/rejected pair constraints, and determinism/undo fixtures. **Paid:** Conditional for missing transcription fixtures, local replay itself needs no calls. **Devices:** No for policy replay. **Backend:** No.
- **Priority:** P1. This advances automatic continuity after measurement makes comparisons meaningful.

### IMP-013 — Guide review of ambiguous and mixed speaker labels

Add a part-by-part comparison for flagged labels, with bounded audio samples and links into the existing reassignment/split and undo flows. A too-few-samples similarity hint stays explicitly low-confidence and requires human action. Keep competing and overlapping attributions inspectable, with confirmation and prior rejection visible. [Voice suggestions](src/domain/voice-suggestions.ts) · [Handoff](docs/HANDOFF.md#8-risks-and-blockers) · [VID06, VID11 and immersive follow-up](task.md)

- **Value:** Reviewers can resolve exceptions with less searching and preserve clear provenance. **Effort:** M. **Risk:** Ranking and badge language can imply unjustified confidence or invite routine manual work.
- **Prerequisites:** IMP-010 to bound confidence wording, test cases for mixed and short labels, and existing undo and revision contracts. **Paid:** No for the local interaction. **Devices:** Required for touch and assistive use. **Backend:** No.
- **Priority:** P2. This makes exceptions inspectable while automatic matching remains the normal goal.

### IMP-014 — Reuse verified audio preparation within each part

Instrument reads, hash verification, window planning, decode and inference. Reuse verified bytes and plans within one bounded part, preserve compatible saved embeddings across revisions, and measure stage timings and memory before considering acceleration. Check vector equivalence and cancel/resume against identical inputs. [Acoustic runner](src/jobs/acoustic-continuity.ts) · [Window decoding](src/audio/acoustic-audio.ts) · [VID14](task.md)

- **Value:** Long-recording users can run local analysis within a better-understood time and memory budget. **Effort:** M. **Risk:** Over-retention can trade repeat I/O for higher peak memory, or reuse evidence after recording replacement.
- **Prerequisites:** Profiling hooks, pinned inputs, recording identity invariants, and IMP-005 and IMP-010 measurement fixtures. **Paid:** No with retained speech results. **Devices:** Required for actual phone memory and timing limits. **Backend:** No.
- **Priority:** P2. Measure the bottleneck and bound reuse before increasing sampling or inference resources.

### IMP-015 — Evaluate browser-local segmentation and model candidates

Compare local segmentation against provider labels for mixed speakers and overlap, and compare embedding models or quantization on held-out meetings. Measure error, asset size, runtime, memory and licensing on the intended host and devices. A candidate for the recording workflow must preserve speaker/time evidence. A finding that browser/provider constraints prevent acceptable results can justify a separately scoped fallback study for identification, long-running jobs, or cross-chunk coordination. [Voice gap register](gap.md#voice-identity-logic-gap-register--2026-11-16) · [B04 evaluation](docs/FUTURE-EVALUATION.md#b04--local-inference-or-optional-companion) · [VID12–13](task.md)

- **Value:** Users can benefit from better handling of mixed provider labels if a suitable browser path is demonstrated. **Effort:** L. **Risk:** Large assets, thermal limits, or missing time and overlap evidence can rule out a candidate.
- **Prerequisites:** IMP-005, IMP-010 and IMP-011, with model provenance and measured baseline comparisons. **Paid:** Conditional for new reference transcriptions. **Devices:** Required. **Backend:** No for browser evaluation, any later fallback requires measured need, verified recovery and separate authorization.
- **Priority:** P2. Baseline and profiling results should identify which model or segmentation experiment is worth running.

## UI, SSOT, and accessibility

### IMP-016 — Complete manual contrast and assistive-technology acceptance

Reconcile the manual review list against the current matrix and cover unresolved foreground/background states across all registered palettes and both themes. The screenshot follow-up recorded 192 contrast-incomplete entries across 41 targets at its checkpoint. Exercise VoiceOver and TalkBack, keyboard/focus return, status announcements, touch sizes, pinch zoom, reduced motion, and maximum text. Include sidebar update controls, Settings draft retention, Evidence Review, immersive player and long-caption reachability in English and Simplified Chinese. [Theme matrix](tests/browser/theme-matrix.spec.ts) · [Screenshot follow-up](docs/UI-FOLLOWUP-2026-11-17.md) · [DS06 and REL02](task.md)

- **Value:** People using assistive technology, keyboard navigation, or large text can complete review and recovery. **Effort:** M. **Risk:** Automated results leave contrast and platform-specific interaction gaps.
- **Prerequisites:** Current matrix artifacts, a manual contrast record, synthetic workflows, and device coordination with IMP-001. **Paid:** No. **Devices:** Physical iPhone and Android required for installed assistive checks. **Backend:** No.
- **Priority:** P1. Manual coverage resolves explicit acceptance gaps on core surfaces.

### IMP-017 — Extend use of the existing shared UI contracts

Inventory rare playback and review states, migrate validated shared presentation to the existing owners, and extend catalogue/regression coverage while preserving native control behavior and feature-owned drafts, playback and revision state. Use `Masonry` for independent cards with source/keyboard order and one narrow column, and `ChoiceMenu` for single-choice action menus. Keep palette metadata in `appearance-preferences.json`, colors in `theme.css`, and languages in `ui-language-options.ts`. Retain the shared sidebar/favicon color roles, separate installed icons, and existing early-theme bootstrap. [Gap register](gap.md#gap-register) · [Masonry](src/components/Masonry.tsx) · [ChoiceMenu](src/components/ChoiceMenu.tsx) · [Startup test](tests/browser/theme-startup.spec.ts)

- **Value:** Users get consistent component behavior, and maintainers can evolve common styles in one place. **Effort:** M. **Risk:** Over-extraction or token churn can regress native focus, contrast or editing guards.
- **Prerequisites:** Component inventory, scoped style exceptions, current SSOT ratchet, and bilingual theme/catalogue tests. **Paid:** No. **Devices:** No for source contracts, coordinate interaction review with IMP-016. **Backend:** No.
- **Priority:** P2. The existing architecture calls for targeted improvements where ownership or coverage is unclear.

### IMP-018 — Make analysis stages and evidence issues easy to review

Add an accessible meeting-detail view for stage, coverage, uncertainty, billing/recovery state and open issues using typed artifacts. Keep source jumps, original output and exact revisions reachable. Use the existing reviewed Evidence Review layout and draft guards, and base changes on a concrete acceptance brief for meeting-detail states. Normal processing begins with consent and ends with human review. [Screenshot follow-up](docs/UI-FOLLOWUP-2026-11-17.md) · [QF09 and UI Phase 3](task.md)

- **Value:** Reviewers can see what needs attention and go straight to the affected source. **Effort:** M. **Risk:** Status, coverage, or a model review verdict can be mistaken for human approval.
- **Prerequisites:** IMP-004, IMP-006 and IMP-007 artifact contracts, plus bilingual keyboard and review fixtures. **Paid:** No for synthetic UI acceptance, live E2E in IMP-026. **Devices:** Required for mobile review acceptance. **Backend:** No.
- **Priority:** P1. The new analysis workflows need understandable progress, evidence and recovery controls.

### IMP-019 — Evaluate ERP memo templates and versioned glossary context

Treat ERP templates and glossary changes as independent deliveries. Use validated templates to organize evidence-linked claims and preserve unknown owners, dates and amounts. Version glossary input and invalidate affected outputs when its context changes. Evaluate reviewer correction time and source fidelity using the human-reference workflow. [Product](docs/PRODUCT.md) · [B02 evaluation](docs/FUTURE-EVALUATION.md#b02--waveform-erp-templates-glossary-and-engines)

- **Value:** ERP reviewers can reuse domain vocabulary and review familiar output categories. **Effort:** M. **Risk:** Templates or hints may be mistaken for source facts or established business rules.
- **Prerequisites:** Concrete use cases, IMP-024 annotated examples, and evidence/revision acceptance for glossary changes. **Paid:** Conditional for real generation comparisons. **Devices:** No for initial evaluation. **Backend:** No.
- **Priority:** P3. Adopt each optional enhancement only when its value is measured.

## Export and backup

### IMP-020 — Export and restore complete resumable checkpoints

Design a versioned, bounded archive for chunk manifests, optional verified audio, per-chunk speech, source pages, attempts, analysis artifacts, and explicitly selected meeting-local acoustic evidence. Show which data is present or absent, validate checksums and schema before atomic publication as a separate copy, and retain compatible legacy imports. Resume from stored results with unchanged attempt counts and billing-review requirements. Keep safe refusal for incomplete restores. Use an allowlisted payload with a separate credentials store and negative checks for key leakage. [Current bounded ZIP code](src/storage/backup.ts) · [Product backup contract](docs/PRODUCT.md#7-export-back-up-and-delete) · [QF04 and REC03](task.md)

- **Value:** Meeting owners can move recoverable work across browser profiles without paying again for completed steps. **Effort:** L. **Risk:** Untrusted or oversized archives, partial imports, key leakage, and lost paid receipts can undermine recovery.
- **Prerequisites:** IMP-004 typed stores, portable recording identity, and a benchmarked archive/staging budget including IMP-005. **Paid:** No for round-trip and billing guards, use mocked submissions. **Devices:** Required for long-archive memory and quota acceptance. **Backend:** No.
- **Priority:** P0. Existing backups safely refuse missing completed chunk results but cannot transfer those checkpoints.

### IMP-021 — Export a source-linked final review packet

Extend browser exports with versioned claim/evidence references, review decisions, unknowns, unresolved issues, coverage and clear audio-availability metadata. Keep customer-facing text separately previewed from internal evidence and permit export only through explicit local actions. Validate references after edits, merge/split, and restore, and apply key exclusion to every output. [Product memo and export requirements](docs/PRODUCT.md#6-generate-and-review-a-memo) · [QF09](task.md)

- **Value:** Meeting owners can share an approved memo or retain an auditable internal handoff. **Effort:** M. **Risk:** An export could leak internal material or present missing evidence as resolved.
- **Prerequisites:** IMP-006 coverage, IMP-018 review states, and IMP-020 archive/evidence contracts for portable references. **Paid:** No for export checks. **Devices:** Required for mobile download/restore acceptance. **Backend:** No.
- **Priority:** P1. It completes the human review workflow with a portable record of the evidence and its limits.

### IMP-022 — Prototype optional encrypted downloads

After the bounded archive work, evaluate a versioned authenticated-encryption format with password-derived keys and measured phone memory/cost. Exclude provider keys before encryption. Reject wrong passwords, altered data, invalid parameters and oversized content before publishing a restored copy. Explain that password loss is unrecoverable and that encryption protects downloaded files at rest. [B03 evaluation](docs/FUTURE-EVALUATION.md#b03--optional-encrypted-backups)

- **Value:** People storing sensitive downloaded archives can opt into at-rest protection. **Effort:** L. **Risk:** Weak or unaffordable parameters, forgotten passwords, and large allocations can make archives unsafe or unusable.
- **Prerequisites:** IMP-020, a bounded-memory prototype, and independent security review. **Paid:** No. **Devices:** Required for phone resource acceptance. **Backend:** No.
- **Priority:** P3. Encryption is optional and depends on a reliable archive and import contract.

### IMP-023 — Evaluate print and PDF output for approved notes

Prototype a local print view with readable page breaks, source references and review state. Validate the export against user-selected scope, and keep credentials and customer-excluded evidence out of printable content. [Product export requirements](docs/PRODUCT.md#7-export-back-up-and-delete)

- **Value:** Reviewers who need a printable copy can preserve the selected memo's context. **Effort:** M. **Risk:** Browser pagination, multilingual text wrapping, and internal evidence can affect the published copy.
- **Prerequisites:** IMP-021 output fields and a demonstrated print use case. **Paid:** No. **Devices:** Conditional if mobile printing is offered. **Backend:** No.
- **Priority:** P3. Existing local text and backup exports serve the core workflow.

## Testing and CI

### IMP-024 — Freeze independently annotated meeting references

Create a private, consented corpus with versioned splits and independently labelled source ranges, speaker turns, critical facts, decisions/actions, unknowns, and alternative evidence. Preserve disagreements and adjudication. Extend the synthetic citation scorer with omission and reviewer-error metrics, then freeze a baseline with per-language/length counts, uncertainty and human correction time. Separate provider-transcript error from memo reasoning and align the overlapping corpus effort with IMP-010. [Quality evaluation contract](docs/QUALITY-EVALUATION.md) · [QF02, V02 and V05](task.md)

- **Value:** Reviewers and maintainers can identify which changes improve the actual meeting workflow. **Effort:** L. **Risk:** Biased annotations, leakage between splits, and weak recall metrics can reward incomplete notes.
- **Prerequisites:** Consented English, Chinese and code-switching/Singlish material, independent reviewers, and a frozen rubric and baseline configuration. **Paid:** Yes for a fresh provider-output baseline, reference/scorer preparation can start offline. **Devices:** No for corpus preparation and offline scoring. **Backend:** No.
- **Priority:** P0. Protected quality metrics must exist before comparing and promoting models or policies.

### IMP-025 — Verify provider capability profiles and benchmark route promotion

Extend the existing explicit Luna routes with measured capabilities for OpenAI and OpenRouter. Check production-origin authenticated preflight and request behavior, account/model access, tools, structured output, reasoning, usage, billing, and the speaker/time evidence of promoted speech routes. Use mock fault injection for HTTP failures, loss, truncation and unknown outcomes, with no automatic replay or silent fallback. Select routes by quality and required capability within consent, and record model lineage, exact route and parameter versions. Additional engines from B02 use the same evidence gate. [Routing status](docs/MODEL-ROUTING.md) · [Provider transport](src/providers/api.ts) · [QF03, QF08, V03 and R06](task.md)

- **Value:** BYOK users can see which routes their browser/account can use and what data and charges to expect. **Effort:** L. **Risk:** Provider behavior can change, and two transports to one model can be mistaken for independent methods.
- **Prerequisites:** Browser/runtime adapter contracts and IMP-024 baselines. Verify eligible routes before IMP-007 and use its independent-review results for role-specific promotion. Account-access evidence can be gathered earlier under separate authorization. **Paid:** Yes for live acceptance and billing reconciliation. **Devices:** No for initial production-browser route verification. **Backend:** No, test direct browser routes first.
- **Priority:** P1. Real route evidence is needed before promoting candidates or relying on them for independent review.

### IMP-026 — Record exact-build end-to-end release acceptance

Assemble the roadmap matrix against the intended build SHA. Trace a private consented recording through authorized transcription, speaker and transcript correction, reviewed memo, export, restore and source playback. Record actual provider access, billing and human-review evidence, physical-device acceptance, real storage/audio bounds, and supported/offline limits. Preserve explicit PASS, FAIL, BLOCKED, unverified and N/A states for each gate and keep private inputs out of release artifacts. [Roadmap matrix](docs/ROADMAP.md#verification-matrix) · [Quality evidence packet](docs/QUALITY-EVALUATION.md#evidence-packet-schema) · [QF10 and R08](task.md)

- **Value:** Users and release owners can verify which core workflows and devices the declared release supports. **Effort:** L. **Risk:** Mocked, dated or differently built results can be mistaken for real acceptance.
- **Prerequisites:** Applicable PWA, speech, recovery, accessibility and QF dependencies above, plus a separately authorized release candidate and consented evaluation. **Paid:** Yes. **Devices:** Required. **Backend:** No for browser scope, assess separately only if an explicitly approved fallback is included.
- **Priority:** P0. This is the production acceptance gate and follows its evidence dependencies.

### IMP-027 — Strengthen synthetic fault coverage and CI evidence

Extend Chromium/WebKit fault injection as IMP-004 and IMP-020 land. Cover request-versus-save failures, concurrent tabs, migration/restore interruption, malformed archives and secret exclusion with synthetic key sentinels. Check destination/key pairing and exclusion from exports, logs, caches and build artifacts. Keep native playback timing checks intact and collect traces under parallel load. Verify the hosted PR check-only path on pinned Node 22.23.3 when authorized, and retain fast-main publication, full PR/default manual checks, main-head attestation, and `dist/`-only artifact checks. [Pages workflow](.github/workflows/pages.yml) · [REL01](gap.md#gap-register) · [Checklist evidence](task.md#current-next-action-and-evidence)

- **Value:** Maintainers can detect recovery, privacy and browser regressions and review exact failure evidence before release. **Effort:** M. **Risk:** Fast-main publishing can precede full browser results, and retries or skipped assertions can hide flaky regressions.
- **Prerequisites:** Existing mock-only harness, synthetic fixtures, failure artifacts and an authorized hosted PR run for that gate. **Paid:** No. **Devices:** No for CI. **Backend:** No application backend.
- **Priority:** P1. Reliable evidence lets the owner retain the chosen publication policy while auditing its coverage.

Live transcription, platform audio capture, collaboration, and cross-device synchronization stay parked as four separately scoped evaluations. Future work needs a concrete use case and an explicit data, permission, and recovery design. Collaboration and synchronization would require separate backend authorization, with provider keys excluded from sync by default. [B05 evaluation](docs/FUTURE-EVALUATION.md#b05--live-transcription-platform-audio-collaboration-and-synchronization)

## Recommended top-five order

1. **IMP-024 — Freeze independently annotated meeting references.** Start corpus and rubric work early and align source annotation with the speaker pilot.
2. **IMP-004 — Build durable paged task and evidence storage.** Pin recovery invariants before adding new long-meeting stages.
3. **IMP-020 — Export and restore complete resumable checkpoints.** Start archive and staging measurements with IMP-005 in parallel and prove transfer against the new stores, with billing continuity and key exclusion.
4. **IMP-010 — Establish a labelled cross-chunk voice baseline.** Start annotation alongside IMP-024 where recordings and reviewers are available and use the results to gate matcher changes.
5. **IMP-001 — Complete installed-phone offline and update acceptance.** Schedule physical devices early and coordinate accessibility and resource measurements with IMP-016 and IMP-005.
