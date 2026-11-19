# Defect register

Baseline: `origin/main` at `3c0e06b` when reviewed on 2026-11-19; statuses for BUG-001, BUG-005 and BUG-006 were updated for `0a394fb`. **Confirmed with evidence** identifies current behavior supported by source and recorded validation. **Suspected** identifies a reported symptom or a plausible failure whose trigger or outcome is unverified. **Fixed-on-main** identifies a historical defect with a correction present in this baseline. Line anchors in evidence links point at the `3c0e06b` source and may have shifted in later commits. Runtime results cited below come from repository records. A fresh runtime reproduction, physical-device acceptance, and real-provider or speaker-matching quality are unverified by this audit.

## BUG-001 — Immersive transcript stops following near a caption-window boundary

- **Severity** `UX`
- **Status** suspected; since `92a465a` the status element carries a read-only `data-follow-pause-reason` attribute so the trigger can be read on a real device; the cause is still unconfirmed
- **Evidence** The reported symptom is that media keeps playing while the immersive transcript stops following by itself near the end of a 40-caption window. Clicking **Jump to current** restores following. The report was not reproduced headlessly and the trigger is unknown. The window advances using the playback clock and a retained start. `suspend()` records the current page and disables follow. It is wired to `onWheel`, `onTouchMove`, `onPointerDown` and `onKeyDown` on the list. The existing test exercises intentional wheel suspension and recovery. The role of those handlers in the spontaneous stall is unverified. [Window and active-row selection](src/features/ImmersivePlayback.tsx#L113), [scroll effect](src/features/ImmersivePlayback.tsx#L316), [suspend and resume](src/features/ImmersivePlayback.tsx#L389), [event handlers](src/features/ImmersivePlayback.tsx#L471), [existing test](tests/browser/speaker-review.spec.ts#L1527), [immersive acceptance](task.md#L207)
- **Affected files** `src/features/ImmersivePlayback.tsx`, `src/domain/playback.ts`
- **Proposed fix direction** Run uninterrupted playback through multiple windows with a synthetic timed transcript. Capture the follow flag, input events, active caption, window start and scroll position to distinguish an unintended suspension from a missing active row. Fix the reproduced path and retain intentional browsing, click-to-seek and **Jump to current**.

## BUG-002 — Long-recording replacement deleted existing chunks before validation

- **Severity** `data-loss`
- **Status** fixed-on-main
- **Evidence** Pre-fix replacement removed live audio chunks and acoustic rows before checking the candidate recording's identity. The initial source investigation identified the path and the later targeted pre-fix tests reproduced it. The workspace still passes `replace: true`, now with the expected hash and meeting version. The store stages rows under a unique ID, checks identity before deleting live rows, verifies concurrent state and aborts the publication transaction on failure. Main `9f15879` contains the correction. The recorded hosted Chromium/WebKit run covered wrong-file rejection preserving audio and acoustic evidence. [Initial investigation](docs/VALIDATION.md#L31), [failure and fix](docs/VALIDATION.md#L809), [hosted evidence](docs/VALIDATION.md#L823), [workspace call](src/features/MeetingWorkspace.tsx#L823), [staging and validation](src/storage/long-audio-store.ts#L145), [atomic publication](src/storage/long-audio-store.ts#L195)
- **Affected files** `src/features/MeetingWorkspace.tsx`, `src/audio/long-import.ts`, `src/storage/long-audio-store.ts`
- **Proposed fix direction** Retain staged validation and transactional publication. Keep wrong-file, unreadable-input, abort, quota, missing-stage and concurrent edit/delete cases in the regression coverage.

## BUG-003 — A restored meeting rejected its identical long recording

- **Severity** `UX`
- **Status** fixed-on-main
- **Evidence** At `416198a`, importing a synthetic 26,271,000-byte MP3, restoring its ZIP as a new meeting, then attaching the exact same file produced two matching chunk hashes and a different manifest hash. Legacy identity included the meeting ID and creation time. Both Chromium and WebKit rejected the original in the recorded UI reproduction. Main `9f15879` ships content identity v2 and upgrades the exported identity when the original manifest can be verified. Published synthetic checks covered identical-file reattachment through reload. Legacy backups without verifiable identity still require re-export from the original browser. [Pre-fix reproduction](docs/VALIDATION.md#L23), [fix and legacy behavior](docs/VALIDATION.md#L811), [hosted evidence](docs/VALIDATION.md#L823), [identity code](src/storage/long-audio-store.ts#L96), [backup upgrade](src/storage/backup.ts#L7), [new ID on restore](src/storage/backup.ts#L92)
- **Affected files** `src/storage/long-audio-store.ts`, `src/storage/backup.ts`, `src/features/MeetingWorkspace.tsx`
- **Proposed fix direction** Retain portable content identity and legacy hash compatibility for live checkpoints. Preserve same-file and wrong-file round-trip tests and the explicit refusal when identity cannot be verified.

## BUG-004 — Restored completed jobs could resubmit an already-paid chunk

- **Severity** `wrong-result`
- **Status** fixed-on-main
- **Evidence** The restored aggregate can contain a completed chunk job while its separate `chunkSpeech` result is absent from the ZIP. The validation record identifies the pre-fix risk of submitting that chunk again after reattachment. The current workspace and runner both check retained results before sending, and restored in-flight jobs become `outcome_unknown`. The `9f15879` hosted regression verifies missing-result refusal and unknown-outcome confirmation without automatic requests, using mocks. An actual duplicate charge is unverified. [Failure mode](docs/VALIDATION.md#L809), [backup boundary](docs/VALIDATION.md#L813), [hosted evidence](docs/VALIDATION.md#L823), [restore normalization](src/storage/backup.ts#L100), [workspace guard](src/features/MeetingWorkspace.tsx#L538), [runner guard](src/jobs/chunked-runner.ts#L23)
- **Affected files** `src/storage/backup.ts`, `src/jobs/chunked-runner.ts`, `src/features/MeetingWorkspace.tsx`
- **Proposed fix direction** Retain refusal in both entry points until a complete, validated checkpoint can be imported. Preserve explicit provider-account review for unknown outcomes and assert no provider request on the missing-result path.

## BUG-005 — Long-recording backups omit checkpoints needed to resume

- **Severity** `data-loss`
- **Status** fixed-on-main (`c06fadd`; completed chunk speech checkpoints are exported and restored only when they match the restored recording identity, capped at 64 MiB per entry; unit and focused Chromium/WebKit checks passed; older builds may reject the new ZIP entry; real-provider and physical-device recovery unverified)
- **Evidence** Export a chunked meeting with completed parts, restore a copy and reattach the original audio. The archive includes the meeting aggregate and optional avatars, omitting chunk audio, speech results, transcript pages, attempts and acoustic records. Reattachment restores audio access, but the runner refuses to continue when completed speech results are absent. The recorded hosted regression confirms the refusal and preservation of human edits, sources and jobs. Losing the original browser's stored rows therefore leaves those checkpoints unavailable from the archive. [ZIP writer and reader](src/storage/backup.ts#L26), [runner error](src/jobs/chunked-runner.ts#L23), [recorded limitation](docs/VALIDATION.md#L813), [hosted evidence](docs/VALIDATION.md#L823), [QF04](task.md#L10), [REC03](task.md#L54)
- **Affected files** `src/storage/backup.ts`, `src/storage/chunk-speech-store.ts`, `src/storage/acoustic-store.ts`, `src/jobs/chunked-runner.ts`
- **Proposed fix direction** Under QF04, add a versioned, bounded checkpoint export/import that validates source identity, revision and provenance, remaps records to the restored meeting, and preserves human edits. Keep the safe refusal for incomplete or incompatible backups.

## BUG-006 — Startup cleanup may interrupt a long-recording import in another tab

- **Severity** `UX`
- **Status** fixed-on-main (`c06fadd`; cleanup reclaims only abandoned stage rows using Web Locks, with a 24 hour lease fallback; synthetic unit tests passed; a real multi-tab browser reproduction remains unverified)
- **Evidence** Start an import in one tab and open another after staging begins, before publication. Startup invokes cleanup, which deletes chunk rows whose owner lacks a manifest. An active staging ID has no manifest. If a staged row disappears, publication throws and rolls back. The validation record explicitly identifies the interruption risk and local retry path. A fresh two-tab reproduction is unverified. [Startup call](src/App.tsx#L126), [staging ID and writes](src/storage/long-audio-store.ts#L148), [publication rollback](src/storage/long-audio-store.ts#L204), [cleanup predicate](src/storage/long-audio-store.ts#L292), [validation caveat](docs/VALIDATION.md#L811)
- **Affected files** `src/App.tsx`, `src/storage/long-audio-store.ts`
- **Proposed fix direction** Verify the interleaving with a paused synthetic import. Track active staging ownership or use a cross-tab lifecycle guard so cleanup can reclaim abandoned rows and leave active stages available. Retain atomic rollback when staged data is missing.

## BUG-007 — WebKit layout scrolling paused follow in the inline Speakers player

- **Severity** `UX`
- **Status** fixed-on-main
- **Evidence** In the recorded WebKit regression, restoring follow and seeking to 39 seconds left the list ending at caption 77 instead of 120. Native layout anchoring changed `scrollTop` and the generic scroll handler interpreted it as user browsing. `ebf6e58` added a two-frame guard for programmatic and layout scrolling. The published integration `64d1801` verified recovery in Chromium and WebKit. This entry covers the inline player. The immersive symptom is tracked in BUG-001. [Failure trace and strengthened test](docs/VALIDATION.md#L913), [hosted evidence](docs/VALIDATION.md#L925), [layout guard](src/features/SpeakerReview.tsx#L783), [input and scroll handlers](src/features/SpeakerReview.tsx#L893)
- **Affected files** `src/features/SpeakerReview.tsx`
- **Proposed fix direction** Keep the layout-transition regression and its real-wheel check so automatic follow recovers while deliberate browsing still pauses it.

## BUG-008 — Ambiguous acoustic candidates may block clearer cross-part matches

- **Severity** `wrong-result`
- **Status** suspected
- **Evidence** The cross-part matcher seeds voices from the first eligible part, processes later parts in order and reserves both sides of a candidate before testing its lead over the runner-up. An ambiguous candidate can therefore reserve a voice for the rest of that part without being placed. The gap assessment identifies the order dependence and notes that the `0.35` pairing floor is below one observed different-person similarity of `0.40`. A missed or wrong grouping on annotated recordings with this baseline is unverified. [Pairing and reservations](src/domain/acoustic-speaker.ts#L1077), [VID07](gap.md#L57), [single-recording evidence](docs/HANDOFF.md#L79), [open evaluation](task.md#L117)
- **Affected files** `src/domain/acoustic-speaker.ts`, `src/jobs/acoustic-continuity.ts`
- **Proposed fix direction** Add a synthetic competing-label case and compare a constrained assignment that reserves only accepted pairs against the current matcher. Evaluate any wider clustering change on labelled meetings while respecting human confirmations, rejected pairs and unresolved ambiguity.

## BUG-009 — Raw-cosine fallback may leave recurring voices split

- **Severity** `wrong-result`
- **Status** suspected
- **Evidence** The single-file path uses the raw-vector clustering policy with an acceptance threshold of `0.86`. The chunked workflow can keep its per-part decisions when every part has one embedded label and there is no cannot-link constraint. The handoff's one recording had a same-label raw median of `0.82` and high best cross-part raw scores. These observations motivate checking the fallback but do not establish its error rate or a particular wrong grouping. [Acoustic policy](src/domain/acoustic-speaker.ts#L24), [single-file path](src/jobs/single-recording-voices.ts#L148), [chunked selection](src/jobs/acoustic-continuity.ts#L420), [VID10](gap.md#L60), [observations](docs/HANDOFF.md#L81)
- **Affected files** `src/domain/acoustic-speaker.ts`, `src/jobs/single-recording-voices.ts`, `src/jobs/acoustic-continuity.ts`
- **Proposed fix direction** Compare raw and normalized scoring on labelled single-file and one-label-per-part cases, including different people speaking in different parts. Keep ambiguous decisions unresolved and require comparative evidence before changing defaults.

## BUG-010 — Sidebar update confirmation placed Cancel outside the viewport

- **Severity** `UX`
- **Status** fixed-on-main
- **Evidence** At maximum text on a 568px-high viewport, the recorded WebKit reproduction reset sidebar `scrollTop` to zero and placed Cancel at y598. The fix reveals the action group inside the scrollable sidebar and reveals the opener after Cancel. The follow-up records 18 passing related local cases and publication of `d83bcf6`. Physical-device behavior is unverified. [Reproduction and local fix checks](docs/UI-FOLLOWUP-2026-11-17.md#L42), [publication](docs/UI-FOLLOWUP-2026-11-17.md#L48), [sidebar reveal logic](src/pwa/status.tsx#L121)
- **Affected files** `src/pwa/status.tsx`
- **Proposed fix direction** Retain short-viewport and maximum-text coverage for full button bounds, wheel reachability, Cancel focus and draft protection.

## BUG-011 — Delayed app startup showed the light theme with saved dark preferences

- **Severity** `cosmetic`
- **Status** fixed-on-main
- **Evidence** The gap assessment flagged first-paint restoration as unverified. A later built-app check held the app module while CSS loaded and observed a light background with no theme attribute despite saved dark preferences. Main `96b6dd5` added a same-origin bootstrap to restore appearance before the app module executes. The recorded Chromium/WebKit regression covers delayed startup, saved choices and fallback. Installed-device first paint is unverified. [Original gap](gap.md#L31), [reproduction and checks](docs/VALIDATION.md#L627), [task closeout](task.md#L165), [Vite plugin configuration](vite.config.ts#L3)
- **Affected files** `scripts/browser-chrome.mjs`, `vite.config.ts`, `src/appearance-preferences.json`, `src/theme.css`
- **Proposed fix direction** Keep slow-module startup and invalid or denied preference-storage checks, with appearance preferences and chrome colors sourced from their shared owners.
