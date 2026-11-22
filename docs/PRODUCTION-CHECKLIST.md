# Production readiness checklist

**Decision on 2026-11-22 — HOLD for production use with sensitive meetings.** The published beta is on `ee188bc` with worker build `1711568a606292cc`. The install-integrity change passed the local mixed-version gate E7. See E11 for the Pages update result. Remaining production gates include shared-origin key storage, real long-meeting completion, measured memo and speaker quality, and physical-device recovery. [Pages run](https://github.com/yapweijun1996/PWA-AI-Meeting-Memo-BYOK/actions/runs/45034968825)

**Sign-off rule.** Record PASS for an observed result within its named scope, FAIL for a failed assertion, BLOCKED for a missing prerequisite and NOT_RUN when execution evidence is missing. Use NOT_APPLICABLE only with the excluded scope and reason. For each applicable [roadmap gate](ROADMAP.md#verification-matrix), record the case, build, date, device/browser or provider/model, fixture, observed result, evidence link and owner. Engineering signs the build, recovery and release evidence. The owner supplies consent, private references, device results, billing reconciliation and final usability sign-off. Keep a gate open until its exit condition is evidenced. [Acceptance procedures](RELEASE-ACCEPTANCE.md)

## A. Code correctness (Pi engine and workspace)

| # | Gate | Status | Evidence |
| --- | --- | --- | --- |
| A1 | Released unit and type checks | PASS | Release CI on Node 22.23.3 passed 702 tests in 77 files and the build type check for `085a7bc`. The separate Ubuntu candidate run included two additional test cases. [Run log](https://github.com/yapweijun1996/PWA-AI-Meeting-Memo-BYOK/actions/runs/45032824635) |
| A2 | Full Chromium/WebKit application suite on the Ubuntu candidate | FAIL | Across the initial and resumed runs of the same static build, 863 passed, five failed and six skipped (874 cases). The same five assertions failed on clean main at `6fbb904`. Resolve the five failures and record a disposition for every skip on the release candidate. |
| A3 | Compacted Pi requests and recovery with synthetic provider responses | PASS | In Chromium and WebKit the isolated candidate completed 60 mocked requests on 12,000 passages, retained original receipts and cited a consulted revision. Reload sent zero additional requests. |
| A4 | Independent review and integration of Pi context compaction | PASS | The rebuilt candidate received independent approval. The implementation shipped in `085a7bc`. B3 and C2 track live completion and quality. |
| A5 | Lint, SSOT, production build and artifact boundary | PASS | All four checks passed in the release CI job. The CI build reported speaker asset mode `remote_model`. |
| A6 | Validation with the project-pinned Node runtime | PASS | The Ubuntu candidate ran under 22.23.3. Unit (704), catalogue (39) and both PWA lifecycle checks passed. A2 records the full application suite outcome. The main-push CI workflow skips the browser, catalogue and lifecycle steps. [Workflow](../.github/workflows/pages.yml) |

## B. Live provider acceptance

| # | Gate | Status | Evidence |
| --- | --- | --- | --- |
| B1 | Transcribe one real 80:39 recording in three parts | PASS | Baseline `9da7bcf`, OpenRouter `elevenlabs/scribe-v2`, 11,865 passages and 14 labels. |
| B2 | Standard memo on the 80:39 transcript | NOT_RUN | Reuse the consented transcript, retain the original output, follow a cited revision and record final human review. |
| B3 | Released Pi selective review completes on the 80:39 transcript | NOT_RUN | The live baseline at `9da7bcf` **failed** after 17 attempts and 704 passages. A 256 KiB next-request stop was reproduced offline. The new compaction path has synthetic coverage (A3). Close with a completed consented run and its receipts on the released build. |
| B4 | Provider, account and billing acceptance | NOT_RUN | Run the applicable P01–P06 cases across supported speech and memo routes on the production origin. Verify explicit destination/data consent, CORS and readable results. Reconcile receipt IDs, usage and actual or unknown charges against provider records. [Provider procedures](RELEASE-ACCEPTANCE.md#production-provider-and-billing-cases) |
| B5 | Compare standard and compacted Pi outputs on identical sources | NOT_RUN | Freeze source revisions and route settings, reuse completed outputs where available and blind the human comparison. Record omissions, unsupported claims, correction time and unknown outcomes. |

## C. Memo quality

| # | Gate | Status | Evidence |
| --- | --- | --- | --- |
| C1 | Consented, human-annotated memo evaluation corpus | BLOCKED | The initial proposed corpus is 30 meetings across English, Chinese and code-switching/Singlish, with at least 10 lasting 60 minutes or longer and independent annotation. [Quality evaluation plan](QUALITY-EVALUATION.md). |
| C2 | Citation resolution, claim support and critical decision/action recall | NOT_RUN | Proposed gates are 100% exact citation resolution, at least 98% held-out claim support and 100% recall of critical decisions/actions in the release suite. Live scores and compacted-context quality are unmeasured. |
| C3 | Blinded usefulness | NOT_RUN | The proposed gate is a blinded median at least 4/5 without a critical factual failure. No scores are recorded. |
| C4 | Owner-requested Pi default-on | FAIL | Standard memo remains the released default, and Pi is opt-in. Acceptance requires the requested default, accurate readiness text and explicit paid consent before sending. |
| C5 | Full-source coverage, independent claim review and measured model routing | BLOCKED | The shipped Pi path performs selective review. The full coverage ledger, independent reviewer and benchmark-based router are planned. To close, account for every source interval, flag unread or uncertain ranges, preserve protected facts through repair and record the consented route for each stage. [Routing status](MODEL-ROUTING.md) · [Quality gates](QUALITY-EVALUATION.md) |

## D. Meeting-scoped speaker attribution

| # | Gate | Status | Evidence |
| --- | --- | --- | --- |
| D1 | Local human reference for the production meeting | BLOCKED | Await the owner's confirmed meeting JSON and keep it outside the repository. The observation recorded nine merged labels and four confirmed names. |
| D2 | Automatic cross-chunk speaker continuity on real meetings | NOT_RUN | Score wrong merges, missed matches and unresolved pairs against anonymous human labels, including overlap and code switching. Require acoustic evidence, meeting-only scope, protected human edits and undo. Demonstrate the normal flow without manual enrollment or merging. [Speaker continuity](ACOUSTIC-SPEAKER-CONTINUITY.md) |
| D3 | Precision-first branch unit verification | PASS | Unreleased `41ab4f0`: 702 unit passes. BUG-008 fixes order dependence. BUG-009 is partially addressed in both raw fallback paths. The evaluator reports wrong merges separately. Independent review is NOT_RUN. |
| D4 | WavLM derivative-weight licence for publication | BLOCKED | Weight publication needs established licence compliance. [Licence evidence](SPEAKER-MODEL-SELECTION.md#licence-evidence-correction--2026-11-16) |
| D5 | Evidence-linked name suggestions with portable rejection | BLOCKED | The original detector spike passed 17 synthetic tests, and the panel is partial and unreleased. Portable rejection needs a compatible schema change. |

## E. Reliability, PWA and responsive UI

| # | Gate | Status | Evidence |
| --- | --- | --- | --- |
| E1 | Focused recovery, no automatic retry and quota injection | PASS | Standard receipts retain paid output in the open page when local writing fails. Pi keeps durable attempts and permits local recovery, orphan export, or metadata-only interrupted receipt release. [Pi recovery](PI-MEMO-READINESS.md#2026-11-22-released-behavior-and-open-gates) |
| E2 | Offline shell and user-confirmed N-to-N+1 update | PASS | Real-worker lifecycle tests passed on the isolated compaction candidate in Chromium and WebKit, including pending writes, unsaved editors and activation failure. E7 covers mixed-version installation, and BUG-049 tracks a queued Accept race. |
| E3 | Physical iPhone and Android, browser and installed mode | NOT_RUN | Execute D01–D13 in iOS Safari/Home Screen and Android Chrome/installed mode. Include cold offline launch, suspension, keyboard, rotation, safe areas, backup and restore. Record OS/browser versions. [Device matrix](RELEASE-ACCEPTANCE.md#device-and-accessibility-cases) |
| E4 | Physical accessibility | NOT_RUN | Complete the primary review and export flow using VoiceOver and TalkBack. Check focus, announcements, zoom, touch targets and contrast in both themes. A2 records responsive browser failures. |
| E5 | Measured limits on supported devices | NOT_RUN | Measure peak storage, import/playback/resume time and UI responsiveness at representative recording sizes. Publish tested format, duration, device and quota. Configured bounds include 4 GiB for supported long imports, 64 MiB meeting JSON, 120 MiB total ZIP and 256 KiB serialized Pi input. |
| E6 | Weekly notice and topbar release scope | PASS | Historical RUI2 and RPAL reviews covered the weekly notice, topbar and shipped palette control. The 320 px language menu and denied-storage clock handling have documented limits. [Handoff](HANDOFF.md) |
| E7 | Reject a mixed-version installation on the local candidate | PASS | On Node 22.23.3, Chromium 156.0.8078.4 and WebKit 27.2 both rejected stale HTML and stale entry JS. The released baseline `edfeb98edf747296` opened offline after rejection. The coherent candidate `77a71bfe36e9f2db` waited for confirmation and then opened offline. Both engines also passed draft and active-request update guards. [Two-build test and evidence](RELEASE-ACCEPTANCE.md#local-browser-release-checks) |
| E8 | Long-recording backup and reattachment | PASS | D13 has synthetic Chromium/WebKit evidence for restoring as a new copy, reattaching the identical source and refusing a different file. Preserve originals and revisions. ZIP excludes chunk audio and acoustic records. A restore missing completed speech must block paid continuation. Physical recovery is in E3. [Recovery validation](VALIDATION.md#non-destructive-long-recording-recovery--2026-11-17) |
| E9 | Durable paid-attempt recovery under ambiguity | PASS | Focused synthetic ZIP recovery retained an unknown attempt, paused before another submission and continued with the next cumulative number after review. Keep the 100-attempt ceiling per saved Pi plan across continuation, reload and restore. Verify provider records separately in B4. [Compaction validation](https://github.com/yapweijun1996/PWA-AI-Meeting-Memo-BYOK/blob/b7b109e92b4c913fd192856c936f00867b1cebc8/docs/VALIDATION.md#rebuilt-pi-compaction-candidate--2026-11-22) |
| E10 | Corrections, evidence and human review survive the full workflow | NOT_RUN | On the candidate, correct a speaker or source passage, undo a merge and check which memo claims become stale. Follow citations to the frozen revision and audio where available. Compare the original provider result and the protected human edit after regeneration, export and restore. [Verification matrix](ROADMAP.md#verification-matrix) |
| E11 | GitHub Pages upgrade from the previous installed version | PASS | Chromium 156.0.8078.4 and WebKit 27.2 upgraded from `085a7bc` after explicit confirmation. The synthetic meeting remained accessible after an offline reload on `ee188bc` and worker `1711568a606292cc`. E7 covers injected stale responses on localhost. E3 covers physical devices. [Pages run](https://github.com/yapweijun1996/PWA-AI-Meeting-Memo-BYOK/actions/runs/45034968825) |

## F. Release and served artifact

| # | Gate | Status | Evidence |
| --- | --- | --- | --- |
| F1 | Independent review of the released changes | PASS | R8 reviewed Pi recovery and RUI2 reviewed the topbar. The rebuilt compaction candidate received approval before release. D3 covers the separate historical voice branch. |
| F2 | Fix release verified and published | PASS | `9da7bcf` → `7bedb94`, Actions [44912511932](https://github.com/yapweijun1996/PWA-AI-Meeting-Memo-BYOK/actions/runs/44912511932), 72 CI test files. Live build `3ed33be58ef5256d` matched CI. |
| F3 | UI release verified and published | PASS | `7bedb94` → `be16b1c`, Actions [44946603638](https://github.com/yapweijun1996/PWA-AI-Meeting-Memo-BYOK/actions/runs/44946603638), 75 CI test files. Live build `24a6a6ae6d249583` matched CI. |
| F4 | Production-origin long-meeting workflow through export and restore | NOT_RUN | On the released build, record the consented import, transcription or checkpoint reuse, speaker review, memo completion, evidence playback, human correction, export and restore as a new copy. Check original revisions and known audio exclusions. |
| F5 | Compaction release and live identity | PASS | Actions verified and published `085a7bc`. On 2026-11-22 the served entry module contained its full SHA and the served worker declared `edfeb98edf747296`, matching the CI build log. [Pages run](https://github.com/yapweijun1996/PWA-AI-Meeting-Memo-BYOK/actions/runs/45032824635) |
| F6 | Recover from a bad release with existing local data | NOT_RUN | Rehearse rollback or a forward fix on an isolated static origin. Open existing meetings and receipts, verify schema compatibility, drafts, backup and restore, and confirm the replacement build identity. [Rollback procedure](DEPLOYMENT.md#release-verification-and-rollback) |
| F7 | Diagnose a failed production session | NOT_RUN | Rehearse triage using the public build ID, browser version, failed processing stage and sanitized receipt or error. Verify that the user can locate recovery instructions and that the maintainer can identify the affected release without a key, raw transcript or recording. |
| F8 | Install-integrity release and live artifact | PASS | GitHub Actions verified and published application commit `ee188bc` on Node 22.23.3. CI passed 702 tests in 77 files. The served worker `1711568a606292cc` matched the CI log, and all 22 precached response digests matched. [Pages run](https://github.com/yapweijun1996/PWA-AI-Meeting-Memo-BYOK/actions/runs/45034968825) |

## G. Privacy and production origin

| # | Gate | Status | Evidence |
| --- | --- | --- | --- |
| G1 | Isolate sensitive meetings and browser-persisted BYOK | BLOCKED | The live site uses a shared GitHub Pages origin. The owner chose unencrypted IndexedDB keys. For sensitive production use, verify a dedicated hostname and export/import migration. Whole-host trust acceptance applies to the personal prototype. [Origin contract](DEPLOYMENT.md#origin-isolation-and-browser-policy) |
| G2 | Key exclusion across storage, transfer and export boundaries | NOT_RUN | The artifact check and focused receipt masking have passing evidence. For full sign-off, trace a synthetic credential through save/reload, consent/cancel, export/restore, logs, service-worker caches and request destinations. Verify other apps’ caches and databases survive cleanup. Record the known masking limit below. [Deployment rules](DEPLOYMENT.md#credential-and-artifact-rules) |

## Accepted limits and inherited defects

- Interrupted Pi streams retain outcome accounting. Their partial paid text is unavailable. The clean-EOF raw export masks complete credentials, including JSON escapes. The matcher does not detect credentials assembled across separate fragments.
- A queued note **Accept** can race reload. Failed retraction can leave a proven-unsent Pi attempt counted. A Pi receipt can push a portable ZIP over 120 MiB.
- OpenRouter SDK coalescing can hide a raw 33-call burst. A modified ZIP missing a failed tool checkpoint can authorize an unread citation in key-free recovery. [Open issues](../BUGS.md#2026-11-22-pi-memo-audit-and-release-review)

## Key handling for testing

Use synthetic responses for automated checks. Keep sensitive recordings off the shared prototype origin while G1 is open. Authorized live tests use the app's browser-local BYOK settings and explicit route/data confirmation. Keep keys and private meeting data out of repository history, logs, artifacts, caches and exports. Preserve the source recording and the owner-confirmed reference outside the repository.
