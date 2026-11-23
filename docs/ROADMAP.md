# Implementation roadmap and verification

Status: implementation and release contract, 2026-11-04. The browser beta is implemented and the task checklist records completed code/test checkpoints. Live paid evaluation and physical-device acceptance remain open. Do not report completion percentages without a defined implementation scope.

## Phase 0 — prove the browser audio path

Build only the smallest test harness needed to validate the selected speech provider from a browser at the intended production origin. Keep test credentials synthetic and use explicitly authorized, consented samples. The user later chose unencrypted local persistence for their own browser keys.

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
| Hosting | `main`-only deploy, failed checks block publish, PR cannot deploy, only `dist/` uploaded, commit/build identity, base path and hash refresh<br>**2026-11-22** PASS for both main-only Pages runs and matching served build IDs. Current live build [`24a6a6ae6d249583`](VALIDATION.md#published-artifacts) corresponds to `be16b1c`. |
| Secret handling | User-selected unencrypted local key persistence; keys absent from meeting exports, logs, artifacts, analytics and caches; correct key/destination pairing; no automatic paid validation<br>**2026-11-22** PASS for focused escaped and split credential masking in saved decoded records and standard receipts. The clean-EOF raw fallback has an accepted split-fragment detection limit. |
| Provider access | Production-origin preflight and response; 401/403/429/5xx; network loss; stream truncation; request-ID exposure when available<br>**2026-11-22** PASS for one baseline transcription and partial Pi access on the recorded account. Released-build live rerun, broader route/account and CORS coverage, actual billing and live provider quality are NOT_RUN. |
| Recovery/billing | Close/reload before submission, after submission, mid-stream, and after result; completed chunks retained; uncertain outcome never auto-resubmits; cancel semantics explicit<br>**2026-11-22** PASS for mocked receipt recovery, legacy billing review, durable attempt accounting and no automatic resubmission. A metadata-only interrupted receipt can be exported and released. Interrupted paid text is unavailable. Live billing reconciliation is NOT_RUN. |
| Audio | Supported formats, corrupt/empty files, size limits, bounded memory, valid container-aware chunks, source offsets, boundary repeats, channel preservation<br>**2026-11-22** PASS for one 80:39 baseline transcription in three parts. Physical-device memory and usable duration limits are NOT_RUN. |
| Speakers | Same-speaker code switching, similar voices, brief replies, overlap/unknown, independent chunk labels, name confirmation, reassignment/merge/split/undo<br>**2026-11-22** PASS for producing labels in the baseline run. BUG-008 and the partial BUG-009 change are on an unreleased branch. Human-reference accuracy and real-recording validation of the new matcher are NOT_RUN. |
| Evidence | Source refs exist and belong to meeting/revision; playback points to correct audio; old refs survive split/merge; source edits invalidate memo review<br>**2026-11-22** PASS for focused frozen-revision replay, paid response preservation and stored legacy search verification. A modified ZIP missing a failed tool checkpoint can still authorize an unread range. Live human-reference quality is NOT_RUN. |
| Memo | Suggestions vs decisions, owner/date/amount unknowns, relative dates/timezone, contradiction, refusal, truncation, instruction-like transcript, regeneration preserves edits<br>**2026-11-22** FAIL for baseline Pi completion. Released main reports the 256 KiB stop. The compaction branch passed a mocked 60-round check. Released-build live Pi completion and model quality with compacted context are NOT_RUN. |
| Storage | Real Chromium/WebKit transactions, quota denial, persistence denial, missing audio, multi-tab conflicts, interrupted save, delete cascade, schema migration<br>**2026-11-22** PASS for focused mocked receipt-write recovery and update write draining. Device quota, suspension and memory limits are NOT_RUN. A separate local candidate test covers a queued Accept and update reload in Chromium and WebKit. |
| Backup | JSON and full backup round-trip; absent audio labeled; ID collision, unsupported schema, malformed/untrusted input, key exclusion<br>**2026-11-22** PASS for focused standard memo headroom, ZIP/JSON and attempt-ledger recovery checks. Pi can still push a portable ZIP over 120 MiB. Integrated compaction restore acceptance is NOT_RUN. |
| PWA | Install/launch, offline scope, worker path, versioned caches, update notification, immediate progress, safe activation/reload, update failure, old-client asset handling<br>**2026-11-22** PASS for Chromium/WebKit offline and N-to-N+1 update on `be16b1c`. Physical installation and standalone behavior are NOT_RUN. |
| Mobile | iOS Safari and installed mode; Android Chrome and installed mode; keyboard, phone suspension, safe areas, portrait/landscape, no horizontal overflow<br>**2026-11-22** FAIL for the existing immersive theme-matrix case at 390 px in both engines. Desktop and responsive coverage includes WebKit 390×844 and Chromium 412×915. Physical iPhone, Android, safe areas and installed-mode acceptance are NOT_RUN. |
| Accessibility | Keyboard/focus, labels and announcements, contrast, primary touch sizes, 16px mobile inputs, pinch zoom, reduced motion<br>**2026-11-22** PASS for scoped localized action names and visible theme focus ring. Two baseline WebKit sidebar cases still FAIL. Screen readers and physical-device accessibility are NOT_RUN. |
| Theme/navigation | Opaque matching system chrome; light/dark coherence if both exist; smart top bar and scroll-to-top only on suitable long screens<br>**2026-11-22** PASS for scoped language icon, theme toggle and desktop/tablet brand alignment. Baseline palette/immersive cases still FAIL. Mobile drawer alignment is outside the desktop row, the 320 px language menu can clip by 2 px with Install, and the palette button is unreleased. |
| Origin boundary | Dedicated production hostname or documented prototype trust acceptance; no unrelated caches/DBs deleted; export/import when changing origin |

Playwright WebKit is useful coverage but does not certify physical iPhone standalone behavior. A mocked provider test does not prove CORS or actual model quality.

## Release evidence checklist

For each release report PASS, FAIL, NOT RUN, or N/A with a reason for: iOS status bar, safe areas, manifest/install, offline contract, worker versioning, update notification, loader-backed update, responsive layout, accessibility, theme chrome, security/privacy, and all changed meeting workflows. Report smart top bar and scroll-to-top as N/A when the navigation does not need them.

Keep live recording evidence private. Store only sanitized procedures/results in the repository; do not upload a recording, transcript, or credential to make a public CI report look complete.
