# Implementation roadmap and verification

Status: implementation and release contract, 2026-11-04. The browser beta is implemented and the task checklist records completed code/test checkpoints. Live paid evaluation and physical-device acceptance remain open. Do not report completion percentages without a defined implementation scope.

## Phase 0 — prove the browser audio path

Build only the smallest test harness needed to validate the selected speech provider from a browser at the intended production origin. Keep credentials ephemeral and use explicitly authorized, consented samples.

Compare an integrated speech candidate with the available OpenAI route if it meets the intended metadata requirements. Measure speaker errors, unknown coverage, text errors, number/date errors, runtime, actual charges, and human correction time. Do not substitute vendor benchmarks for these results.

Cover Chinese/English code switching, Singlish, ERP terms, 2–5 speakers, short replies, overlap, noise, long silences, and a long meeting. Keep the local corpus private and manually annotate a useful subset.

Exit criteria:

- A supported browser can send an authorized request directly, read the result, and recover a provider job where applicable.
- At least one durable candidate supplies real speaker and time evidence; otherwise record a blocker for the speaker-aware release.
- Memory use, format support, limits, timing offsets, label scope, and cost basis are observed, not assumed.
- Interrupted paid requests cannot silently resubmit.
- A written provider decision identifies supported browsers and known failure cases.

A useful initial target is reviewing an hour of audio in approximately 10–15 minutes. This is a proposed usability target, not an established result or model accuracy guarantee. Compare with the user's manual baseline.

## Phase 1 — runnable PWA foundation and CI

Create the proposed TypeScript/Vite app and lockfile, a meeting library, local repository, synthetic fixtures, and hash navigation. Implement manifest, icons, safe areas, connectivity, app-shell caching, and explicit update UX.

Define the package scripts in [deployment](DEPLOYMENT.md), add production-path E2E coverage, and activate the workflow example alongside the runnable app and authorized publication. CI uses mocks; live API evaluations remain separate.

Exit: clean install/check/build, project-path navigation, local create/edit/reload, offline shell, and draft-safe N-to-N+1 update pass. Publication needs an actual successful Actions run and deployed-browser evidence.

## Phase 2 — local evidence and speaker review

Implement audio storage/playback, transcript import, immutable provider runs, segment revisions, names/unknowns, reassignment, merge, split, undo, and multi-tab edit protection. Add backup/restore and deliberate quota handling before users depend on local data.

Exit: corrections survive reload and restore, original results remain available, and citations resolve after edits. Imported text without audio never gets fabricated playback evidence.

## Phase 3 — BYOK processing and memo review

Integrate the Phase 0 provider, explicit send/estimate UI, capability checks, durable local checkpoints, and foreground recovery. Add memo generation, schema/refusal handling, evidence validation, stale propagation, review, and exports.

Exit: a real browser recording goes through the full review/export/restore flow with traceable sources, no hidden paid retries, and preserved human versions.

## Phase 4 — release hardening

Run the matrix below, select the production origin trust boundary, test real phones and installed mode, and validate documentation against shipped behavior. Establish measured file limits. Record unsupported cases and provider-specific behavior in the app.

Mic capture, waveform improvements, new engines, local models, and external integrations follow only after the core release gates pass.

## Verification matrix

Current results are recorded in [validation](VALIDATION.md) and per-task Git commits. The matrix below remains the release contract; do not infer live provider or physical-device success from a mocked browser run.

| Area | Required checks |
| --- | --- |
| Hosting | `main`-only deploy, failed checks block publish, PR cannot deploy, only `dist/` uploaded, commit/build identity, base path and hash refresh |
| Secret handling | Keys absent from artifacts, storage, logs, exports, analytics and caches; correct key/destination pairing; no automatic paid validation |
| Provider access | Production-origin preflight and response; 401/403/429/5xx; network loss; stream truncation; request-ID exposure when available |
| Recovery/billing | Close/reload before submission, after submission, mid-stream, and after result; completed chunks retained; uncertain outcome never auto-resubmits; cancel semantics explicit |
| Audio | Supported formats, corrupt/empty files, size limits, bounded memory, valid container-aware chunks, source offsets, boundary repeats, channel preservation |
| Speakers | Same-speaker code switching, similar voices, brief replies, overlap/unknown, independent chunk labels, name confirmation, reassignment/merge/split/undo |
| Evidence | Source refs exist and belong to meeting/revision; playback points to correct audio; old refs survive split/merge; source edits invalidate memo review |
| Memo | Suggestions vs decisions, owner/date/amount unknowns, relative dates/timezone, contradiction, refusal, truncation, instruction-like transcript, regeneration preserves edits |
| Storage | Real Chromium/WebKit transactions, quota denial, persistence denial, missing audio, multi-tab conflicts, interrupted save, delete cascade, schema migration |
| Backup | JSON and full backup round-trip; absent audio labeled; ID collision, unsupported schema, malformed/untrusted input, key exclusion |
| PWA | Install/launch, offline scope, worker path, versioned caches, update notification, immediate progress, safe activation/reload, update failure, old-client asset handling |
| Mobile | iOS Safari and installed mode; Android Chrome and installed mode; keyboard, phone suspension, safe areas, portrait/landscape, no horizontal overflow |
| Accessibility | Keyboard/focus, labels and announcements, contrast, primary touch sizes, 16px mobile inputs, pinch zoom, reduced motion |
| Theme/navigation | Opaque matching system chrome; light/dark coherence if both exist; smart top bar and scroll-to-top only on suitable long screens |
| Origin boundary | Dedicated production hostname or documented prototype trust acceptance; no unrelated caches/DBs deleted; export/import when changing origin |

Playwright WebKit is useful coverage but does not certify physical iPhone standalone behavior. A mocked provider test does not prove CORS or actual model quality.

## Release evidence checklist

For each release report PASS, FAIL, NOT RUN, or N/A with a reason for: iOS status bar, safe areas, manifest/install, offline contract, worker versioning, update notification, loader-backed update, responsive layout, accessibility, theme chrome, security/privacy, and all changed meeting workflows. Report smart top bar and scroll-to-top as N/A when the navigation does not need them.

Keep live recording evidence private. Store only sanitized procedures/results in the repository; do not upload a recording, transcript, or credential to make a public CI report look complete.
