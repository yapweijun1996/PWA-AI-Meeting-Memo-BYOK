# Validation record

Date: 2026-11-04. Product: browser-first BYOK beta. Host used for local checks: Ubuntu 24.04 ARM64, Node 22.23.3, Playwright Chromium and WebKit. WebKit on Linux is not a physical iPhone.

## Local checks

| Check | Evidence |
| --- | --- |
| Lint and TypeScript | PASS on the implementation candidate |
| Unit tests | PASS: 22 tests covering schemas, evidence revisions, undo, invalid source IDs, nullable fields, refusal, incomplete responses, request limits, storage conflicts, deletion, and backup validation |
| Browser workflow | PASS: full 30-case Chromium/WebKit baseline, followed by four focused cases covering the expanded continuous recording-to-backup workflow and new timeout regression; CI will verify all 32 current cases together |
| PWA update | PASS in both engines: waiting-worker prompt, explicit activation/reload, saved meeting preserved, unrelated cache retained |
| Accessibility | PASS automated axe WCAG A/AA library/settings checks; keyboard/focus and 390px navigation exercised; not a complete assistive-technology certification |
| Production artifact | PASS static-file/path/manifest checks and scan for known credential/test fixture patterns; no guarantee that scanning alone detects all secrets |
| Dependency audit | PASS: zero reported production or development vulnerabilities in the checked lockfile |

Browser cases use synthetic text/audio. They cover upload/checksum, speaker normalization, confirmation, correction, bulk assignment, merge/split/undo, historical source inspection, session-key clearing, explicit send confirmation, unknown billing, cancellation, backup/restore, offline reload, multi-tab conflicts, and injected quota failures. Injected quota failure tests error handling, not a measured device storage ceiling.

The continuous workflow uses a generated one-second silent WAV and mocked speech/notes. It exports MD, TXT and JSON after human acceptance, checks credential exclusion, restores a checksummed audio ZIP into a separate meeting, and verifies both transcript and human review survived. The timeout case advances the browser clock past nine minutes and verifies one submission, possibly-charged status, and no resubmission after reload.

## Deployment

Status: pending first verified GitHub Actions publication. The Pages configuration already uses workflows with HTTPS, and its environment branch policy allows only `main`. A configured URL alone is not deployment evidence. Record the successful run and served build after publication.

Target: https://yapweijun1996.github.io/PWA-AI-Meeting-Memo-BYOK/

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
| Hosting and build identity | Local production-path checks PASS; first Actions deployment and live build verification pending |
| Privacy and keys | PASS memory-only/session clearing, destination-specific mock headers, exported credential exclusion and static artifact checks; shared-origin production acceptance NOT RUN |
| Provider access and quality | Mock orchestration PASS; authenticated production CORS, valid account/model access, real accuracy and charges NOT RUN |
| Recovery and billing | PASS simulated disconnect, incomplete body, timeout, cancellation and reload with no automatic resubmission; real phone suspension and provider settlement NOT RUN |
| Audio | PASS bounded synthetic upload, checksum persistence, playback Blob and restore; empty/oversized inputs and unsupported filenames rejected; malformed codec contents and measured physical-device limits NOT RUN |
| Chunking and streaming | N/A: one original-container foreground upload; no slicing, remote queue/polling or streaming advertised |
| Speakers and evidence | PASS synthetic speaker names/unknowns, bulk assignment, merge/split/undo and historical references; real diarization identity and overlap accuracy NOT RUN |
| Memo | PASS structural/source validation, nullable owner/date, refusal, human edit/accept/reject controls and version preservation; real factual quality and review time NOT RUN |
| Storage and backup | PASS Chromium/WebKit transactions, conflicts, injected quota errors, missing-audio labeling, atomic delete, JSON/ZIP restore and malformed archive/schema rejection; OS eviction and historical production migration NOT RUN (first schema release) |
| Manifest and install | PASS identity, scope, icons and project launch URL; physical Home Screen/installed launch NOT RUN |
| Offline and worker scope | PASS cached app shell and local meeting reload, project-only cache/worker scope and unrelated-cache retention |
| Update lifecycle | PASS local two-engine N-to-N+1 prompt, explicit activation, progress and preserved saved meeting; live update and operational revert pending |
| Responsive and navigation | PASS 390px layout, drawer, hash refresh, smart top bar and contextual scroll-to-top; physical landscape/keyboard and pinch gestures NOT RUN |
| Accessibility | PASS automated library/settings axe A/AA and exercised keyboard/focus; full screen-reader certification NOT RUN |
| iOS status bar and safe areas | CSS viewport/safe-area and opaque light theme implemented; physical Safari/standalone inspection NOT RUN |
| Theme chrome | PASS automated light-theme browser layout; dark theme N/A (not offered); device system chrome NOT RUN |

No failed check is being waived. Pending acceptance items are not promoted to PASS by mocked or desktop tests. The user explicitly reserved valid-key acceptance for the finished webpage.

## Limits and safeguards

- Maximum new recording: 50 MB; supported formats still depend on the browser/provider.
- Maximum JSON restore: 12 MB; ZIP input/expanded size capped at 120 MB and restricted to known entries; audio checksums are verified.
- Memo input/output and history limits are enforced before further requests; all unknown costs stay unknown.
- Human acceptance is recorded against the current source revision. Original generated source references and prior human memo versions remain intact.
- Keys stay in memory. Browser code and all scripts on the hosting origin remain part of the trust boundary.
- Processing is foreground and conservatively recoverable, with no automatic retry of ambiguous paid outcomes.

## Reproduce

Use the commands in [README](../README.md). Workflow runs use only mocks and synthetic fixtures, with no provider secrets. Repeat the relevant real-browser/device checks when storage, worker lifecycle, provider contracts, or supported limits change. Do not mark the open acceptance items complete based on a successful CI run.
