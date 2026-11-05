# Validation record

Prior baseline date: 2026-11-04. Product: browser-first BYOK beta. Host used for local checks: Ubuntu 24.04 ARM64, Node 22.23.3, Playwright Chromium and WebKit. WebKit on Linux is not a physical iPhone.

## Provider selection change (2026-11-05)

The OpenAI-default/OpenRouter-optional change passed lint, TypeScript, 30 unit tests, 36 Chromium/WebKit browser tests, static artifact checks, and the two-engine PWA update test locally. Provider responses were synthetic. The published commit must be read from the latest GitHub Actions run; prior counts and live deployment details below describe the earlier baseline. Authenticated provider access, Scribe speaker accuracy, actual charges, and device testing remain NOT RUN.

## Settings persistence amendment

Provider keys, provider/model selections and speech rate are saved locally by explicit user choice. Existing memory-only keys require one re-entry after updating. Local verification passed 34 unit tests, 46 Chromium/WebKit browser tests, and both engines’ PWA update checks. Synthetic tests cover reload, separate settings storage, forgetting keys, stale-tab conflict, injected storage failure and PWA update protection. These tests do not establish protection against same-origin scripts or device/profile access.

## Local checks

| Check | Evidence |
| --- | --- |
| Lint and TypeScript | PASS on the implementation candidate |
| Unit tests | PASS: 26 tests covering schemas, separate generated memo originals, evidence revisions, undo, invalid source IDs, nullable fields, refusal, incomplete responses, HTTP rejection/billing separation, request limits, storage conflicts, deletion, and backup validation |
| Browser workflow | PASS: all 34 current Chromium/WebKit cases locally; the clean GitHub Actions deployment runs linked below passed the prior 32-case baseline before the added two-engine HTTP rejection/billing regression |
| PWA update | PASS in both engines: waiting-worker prompt, explicit activation/reload, open-editor/active-request protection, saved draft and old asset preserved, unrelated cache retained, visible activation failure and forward recovery |
| Accessibility | PASS automated axe WCAG A/AA library/settings checks; keyboard/focus and 390px navigation exercised; not a complete assistive-technology certification |
| Production artifact | PASS static-file/path/manifest checks and scan for known credential/test fixture patterns; no guarantee that scanning alone detects all secrets |
| Dependency audit | PASS: zero reported production or development vulnerabilities in the checked lockfile |

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
