# Meeting memo generation: production-readiness checklist

Created 2026-11-21. Updated 2026-11-22 for released main `be16b1c`. PASS records evidence for the scope named in the row. FAIL records an observed failure. BLOCKED identifies a dependency and NOT_RUN marks missing execution evidence. NOT_APPLICABLE is reserved for a gate outside the stated scope. This checklist tracks acceptance and carries no aggregate readiness score. [Validation and release evidence](VALIDATION.md#2026-11-22-live-baseline-audit-and-releases)

All local counts reported for this checkpoint used host Node **25.5.0**. The project pins **22.23.3**, used by CI. Provider tests described as mocked use synthetic responses. The product requires explicit paid consent, forbids automatic resubmission of unknown outcomes and caps execution at 100 cumulative provider attempts per saved Pi plan through continuation, reload and restore.

## A. Code correctness (Pi engine and workspace)

| # | Gate | Status | Evidence |
| --- | --- | --- | --- |
| A1 | Released unit and type checks | PASS | `be16b1c`: 681 unit passes, `tsc -b` clean. The released fixes include regressions for pre-POST input checks, paid-output preservation, legacy replay, billing consent and local recovery. [Defect register](../BUGS.md#2026-11-22-pi-memo-audit-and-release-review) |
| A2 | Full released browser suite | FAIL | `npm run test:e2e`: 819 passed, 7 failed, 5 skipped. The same seven fail on the original baseline on this Mac. The distinct zero-width speech case passed 3/3 in isolation after load timeouts. |
| A3 | Compaction mock exercise | PASS | Unreleased `cf38e8a`: 710 unit passes and the 12,000-passage/60-round case passed Chromium and WebKit. No new failures reported in the full suite. |
| A4 | Compaction final verdict and integrated validation | BLOCKED | R9–R13 findings were fixed on the branch. R14 had no verdict. Independent approval and integration onto released main are pending. |
| A5 | Lint, SSOT, build and artifact boundary | PASS | All passed at `be16b1c`. SSOT debt unchanged (color 14, font-size 7, radius 20, shadow 3, z-index 5). |
| A6 | Full local rerun under pinned Node | NOT_RUN | Pages Verify and Publish succeeded under 22.23.3. The local browser/PWA counts came from 25.5.0. |

## B. Live provider acceptance

| # | Gate | Status | Evidence |
| --- | --- | --- | --- |
| B1 | Transcribe one real 80:39 recording in three parts | PASS | Baseline `9da7bcf`, OpenRouter `elevenlabs/scribe-v2`, 11,865 passages and 14 labels. |
| B2 | Standard memo on that transcript | NOT_RUN | No corresponding run evidence for this meeting. |
| B3 | Pi selective review completes on that transcript | FAIL | Baseline OpenAI `gpt-6-luna`, high reasoning, 32,768 output tokens. Stopped at 17 attempts and 704 passages. The 256 KiB next-request stop was reproduced offline. The original live trigger and accounting at the transition remain unconfirmed. |
| B4 | Route/account-specific CORS, output capability, billing and usage | NOT_RUN | Partial live baseline access was observed. The complete per-route matrix and billing reconciliation have no result. |
| B5 | Released-build retest and future compaction comparison | NOT_RUN | No live retest of the owner's long meeting on `be16b1c` and no paid run with the integrated projection. |

## C. Memo quality

| # | Gate | Status | Evidence |
| --- | --- | --- | --- |
| C1 | Consented, human-annotated memo evaluation corpus | BLOCKED | The initial proposed corpus is 30 meetings across English, Chinese and code-switching/Singlish, with at least 10 lasting 60 minutes or longer and independent annotation. [Quality evaluation plan](QUALITY-EVALUATION.md). |
| C2 | Citation resolution, claim support and critical decision/action recall | NOT_RUN | Proposed gates are 100% exact citation resolution, at least 98% held-out claim support and 100% recall of critical decisions/actions in the release suite. Live scores and compacted-context quality are unmeasured. |
| C3 | Blinded usefulness | NOT_RUN | The proposed gate is a blinded median at least 4/5 without a critical factual failure. No scores are recorded. |
| C4 | Owner-requested Pi default-on | BLOCKED | The existing confirmation remains optional and unchecked. The change is deferred until compaction ships with revised readiness text and explicit paid consent. |

## D. Speaker voice recognition accuracy

| # | Gate | Status | Evidence |
| --- | --- | --- | --- |
| D1 | Local human reference for the production meeting | BLOCKED | Await the owner's confirmed meeting JSON and keep it outside the repository. The observation recorded nine merged labels and four confirmed names. |
| D2 | Measured wrong, missed and unresolved merges | NOT_RUN | No measured real-recording accuracy. The priority is fewer wrong merges. |
| D3 | Precision-first branch unit verification | PASS | Unreleased `41ab4f0`: 702 unit passes. BUG-008 fixes order dependence. BUG-009 is partially addressed in both raw fallback paths. The evaluator reports wrong merges separately. Independent review is NOT_RUN. |
| D4 | WavLM derivative-weight licence for publication | BLOCKED | Weight publication needs established licence compliance. [Licence evidence](SPEAKER-MODEL-SELECTION.md#licence-evidence-correction--2026-11-16) |
| D5 | Evidence-linked name suggestions with portable rejection | BLOCKED | The original detector spike passed 17 synthetic tests, and the panel is partial and unreleased. Portable rejection needs a compatible schema change. |

## E. Reliability, PWA and responsive UI

| # | Gate | Status | Evidence |
| --- | --- | --- | --- |
| E1 | Focused recovery, no automatic retry and quota injection | PASS | Standard receipts retain paid output in the open page when local writing fails. Pi keeps durable attempts and permits local recovery, orphan export, or metadata-only interrupted receipt release. [Pi recovery](PI-MEMO-READINESS.md#2026-11-22-released-behavior-and-open-gates) |
| E2 | PWA offline and draft-safe N-to-N+1 update | PASS | `npm run test:pwa` on `be16b1c`, Chromium and WebKit. Pending writes and unsaved editors are guarded; the separate queued Accept race remains open. |
| E3 | Physical iPhone and Android installed mode | NOT_RUN | Physical safe areas, suspension, long processing and storage limits remain open. Responsive browser scope covers WebKit 390×844 and Chromium 412×915, plus desktop. |
| E4 | Screen readers and physical accessibility | NOT_RUN | Scoped keyboard, focus and localized name checks exist. Full local browser suite reports seven inherited failures. |
| E5 | Documented configured limits and measured device limits | NOT_RUN | Device limits are unmeasured. Disclosed ceilings include 64 MiB meeting JSON, 120 MiB ZIP total and 256 KiB serialized Pi input. |
| E6 | Weekly notice and topbar release scope | PASS | RUI2 and released tests cover weekly dismissal, Malay labels, icon-only desktop language, theme focus/storage and desktop/tablet brand alignment. The mobile drawer row, clock rollback after denied storage and 320 px menu clipping are known limits. The palette button is in progress. |

## F. Release and served artifact

| # | Gate | Status | Evidence |
| --- | --- | --- | --- |
| F1 | Independent release review | PASS | R8 approved the Pi fix release. RUI2 approved the UI release. Compaction and voice are covered by their separate open review gates. |
| F2 | Fix release verified and published | PASS | `9da7bcf` → `7bedb94`, Actions [44912511932](https://github.com/yapweijun1996/PWA-AI-Meeting-Memo-BYOK/actions/runs/44912511932), 72 CI test files. Live build `3ed33be58ef5256d` matched CI. |
| F3 | UI release verified and published | PASS | `7bedb94` → `be16b1c`, Actions [44946603638](https://github.com/yapweijun1996/PWA-AI-Meeting-Memo-BYOK/actions/runs/44946603638), 75 CI test files. Live build `24a6a6ae6d249583` matched CI. |
| F4 | Live functional smoke on the deployed long-meeting Pi path | NOT_RUN | Artifact readback is recorded in F2 and F3. Released-build long-meeting functional acceptance remains open. |

### Accepted limits and inherited defects

- Interrupted Pi streams retain outcome accounting. Their partial paid text is unavailable. The clean-EOF raw export masks complete credentials, including JSON escapes. The matcher does not detect credentials assembled across separate fragments.
- A queued note **Accept** can race reload. Failed retraction can leave a proven-unsent Pi attempt counted. A Pi receipt can push a portable ZIP over 120 MiB.
- OpenRouter SDK coalescing can hide a raw 33-call burst. A modified ZIP missing a failed tool checkpoint can authorize an unread citation in key-free recovery. [Open issues](../BUGS.md#2026-11-22-pi-memo-audit-and-release-review)

## Key handling for testing

Use synthetic responses for automated checks. Authorized live tests use the app's browser-local BYOK settings and explicit route/data confirmation. Keep keys and private meeting data out of repository history, logs, artifacts, caches and exports. Preserve the source recording and the owner-confirmed reference outside the repository.
