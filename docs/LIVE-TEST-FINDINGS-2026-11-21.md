# Live session findings — 2026-11-21

Baseline build `9da7bcf`, using the owner's own 80:39 recording and real provider credentials. The source is the supplied session report, including Codex QA feedback on two screenshots. The recording, screenshots, request logs, and provider account were not inspected for this note. Here, **observed** means reported from that session, **suspected** means a plausible interpretation or defect requiring reproduction, and **unverified** means the evidence does not establish an answer. These are single-session observations. Voice accuracy and end-to-end quality remain unverified.

## Transcription and speaker continuity

| Status | Evidence | Implication and open question |
| --- | --- | --- |
| **observed** | OpenRouter `elevenlabs/scribe-v2` processed the 80:39 recording in 3 chunks. The result showed 11,865 passages and 14 speaker labels. | This is one working chunked path on the reported build and account. Which other recordings, limits, browsers, and accounts reproduce it is **unverified**. |
| **observed** | The automated voice check used 88 samples. It grouped 15 per-part labels into 3 voices and reported 2 matched, 3 new, 2 uncertain, and 8 contradictory labels. It flagged 8 labels as possibly containing two people. | Displayed and per-part label counts refer to different reported views. Their mapping, and whether the eight mixed labels coincide with the eight contradictory labels, are **unverified**. How many actual speakers were present and which labels should map together require labelled reference turns. |
| **observed** | Same-label raw cosine median was 0.71 (p10 0.42); different-label, same-part median was 0.58 (p90 0.82). | The percentile ranges show score overlap in this session. Threshold calibration, accuracy, and which cases reflect overlap or mixed labels are **unverified**. Validate against human-labelled turns and preserve ambiguity. |

## Pi selective review

| Status | Evidence | Implication and open question |
| --- | --- | --- |
| **observed** | OpenAI `gpt-6-luna`, high reasoning, 32,768 maximum output tokens. The plan stopped after 17 provider attempts and 704/11,865 passages read. State: “stopped, needs review”. Message: “No provider request was submitted. Its durable local receipt could not be recorded.” | The plan stopped below the allowed 100 cumulative attempts. A passage count records local lookups and may include partial reads. Actual submission, charge and receipt persistence at the failing transition are **unverified**. The message is UI evidence of that transition, with no network or billing trace supplied. [Pi limits and recovery](PI-MEMO-READINESS.md#implemented-scope-and-boundaries) |
| **observed** | Reported stored meeting JSON was 6.31 MB (`runs` 2.76 MB, `segments` 2.73 MB, `memoAgents` 1.03 MB). The documented meeting cap is 64 MiB. Browser quota was reported as 64 GB. | The measured JSON was below the cap. Browser quota and total JSON size alone do not establish whether the specific write could succeed or whether an application guard ran. Timing of the recorded size relative to the failed write and the source of the storage failure are **unverified**. |
| **suspected** | The stop may involve the pre-submit receipt/checkpoint path. Spike S1 is investigating, and the root cause remains **unverified**. | Correlate the candidate job, stored plan and history, and any pre-submit exception. A synthetic reproduction should check whether the failing attempt reached fetch, whether existing paid records remain available, and whether reload and backup preserve the count without automatic resubmission. [Receipt write](../src/jobs/memo-agent.ts#L618), [matching message](../src/jobs/memo-agent.ts#L673) |

## Screenshot QA and proposed follow-up

| Status | Reported QA finding or suggestion | Implication and open question |
| --- | --- | --- |
| **observed** | The audio player overlaps the Pi progress strip in the running-state screenshot. This is the reported layout defect. | The strip needs to stay visible and usable with the persistent player. Reproduce with both visible and assert their rendered bounds do not intersect. Viewport, safe-area, zoom and installed-device behavior remain **unverified**. [Progress strip](../src/features/MeetingWorkspace.tsx#L1842) |
| **observed** | The running strip shows `0/11,865` passages read while requests run. Its presentation can read as stalled. | The counter measures locally consulted passages. Whether the same value persists after a successful read is **unverified**. A future check should distinguish waiting on a provider from reading locally, with an accessible status for both. [Counter](../src/features/MeetingWorkspace.tsx#L1844) |
| **observed** | The QA review proposed one consent summary above the checkbox and a clearer explanation of **Stop waiting** for a paid request. | The copy should name the destination, data, and possible charge. The stop explanation should say that a submitted request can remain billable and that an unknown outcome requires review. Actual billing on cancellation and any missing consent control are **unverified**. The copy suggestions alone are `NOT-A-BUG`. [Stop control](../src/features/MeetingWorkspace.tsx#L1142), [routing boundaries](MODEL-ROUTING.md#request-boundary) |
| **observed** | The QA review proposed moving reasoning and token settings under Advanced and checking contrast, hit areas, focus return, and safe areas. | The placement suggestion is `NOT-A-BUG`. Accessibility conformance and specific failures are **unverified**. Verify keyboard and focus return, contrast, touch bounds, short viewports, enlarged text and installed-device safe areas. |
| **observed** | Spike S2 was offered the idea of suggesting speaker names from cited self-introductions with human confirmation. | This is a **planned** suggestion workflow. Correct attribution, ambiguity handling, and user confirmation are **unverified**. A cited self-introduction is a source claim and supplies no acoustic identity evidence. |

## Worker verification status

**observed:** The session report says worker audits fixed about 20 defects in the Pi engine and workspace logic and cites a 592-test unit suite on host Node 25. The project pins Node 22.23.3. Browser end-to-end tests were still running when reported.

**unverified:** The individual changes, pass/fail breakdown, pinned-Node rerun, browser end-to-end result, physical-device acceptance, and labelled quality measurements remain open in this note. The report does not establish that the live stop or screenshot overlap has been fixed on `9da7bcf`.
