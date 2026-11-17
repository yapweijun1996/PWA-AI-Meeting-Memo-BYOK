# Meeting intelligence quality evaluation contract

Date: 2026-11-17. Status: proposed evaluation gates, **not measured results**. Parent: [quality-first plan](QUALITY-FIRST-PLAN.md). This contract extends, rather than replaces, [citation evaluation](EVIDENCE-EVALUATION.md), [speaker evaluation](SPEAKER-PROFILE-EVALUATION.md) and [release acceptance](RELEASE-ACCEPTANCE.md).

## Evaluation surface and reference set

Evaluate the complete source-to-memo workflow and individual stages separately. Compare baseline standard notes, baseline selective Pi, candidate orchestration and optionally NotebookLM with identical consented source inputs and task instructions. Record product/model/date/configuration. Do not claim a head-to-head comparison if it was not run. Provider routes to the same model family are not independent systems merely because their endpoints differ.

Proposed initial corpus: 30 consented meetings, at least 10 per primary stratum (English, Chinese, code-switching/Singlish), with at least 10 lasting 60 minutes or more. Across the corpus include 2–5 speakers, similar voices, accents, poor microphones, overlap, short acknowledgements, corrections, ERP terms, numbers/dates, decisions later reversed, owners with ambiguous pronouns, no-action meetings and adversarial instructions embedded in source text. Add 8/20-hour stress fixtures for software capacity; synthetic stress is not real long-audio accuracy. Expand the corpus if confidence intervals remain too wide; 30 meetings is a starting design, not proof of statistical sufficiency.

Split by meeting and speaker group before tuning: development, validation and sealed test; related excerpts stay in one split. Keep the test set inaccessible to prompt/model tuning. At least two independent annotators label the test set; a third or a documented adjudication process resolves disagreements. An author-generated synthetic label set is not independent gold. Store consent, dataset version/checksums, anonymity policy and annotator protocol privately. Never commit recordings, real transcripts, API keys or provider account details.

Reference annotations include:

- Verbatim or explicitly normalized transcript, timing ranges and anonymous speaker turns, with inaudible/overlap/uncertain regions marked.
- Topic inventory and critical facts at beginning, middle and end, including late corrections and repeated agenda items.
- Proposal/decision/commitment/rejection/supersession distinctions, conditions and dissent.
- Action task, explicit or unknown owner/date, dependency and evidence for each field.
- Exact supporting and contradicting source ranges; alternative sufficient evidence sets where appropriate.
- Protected human-confirmed facts and permitted editing scope.

Separate transcription mistakes from reasoning mistakes: evaluate once against reference text and once against actual provider transcripts. A memo faithful to an erroneous transcript can still be wrong relative to the recording. Report both.

## Metrics, denominators and proposed gates

Thresholds below are initial engineering acceptance targets, to be ratified against the frozen baseline before tuning. They are neither existing performance nor a promise that an LLM can reach them. If a target cannot be met, record FAIL/limited support; do not lower it after seeing a candidate without a new versioned evaluation decision.

| Metric | Definition | Initial gate |
| --- | --- | --- |
| Source integrity | Original bytes/text and revisions preserved after processing, migration, cancel and restore | 100% of tested artifacts; any destructive loss blocks release |
| Coverage accounting | Source intervals assigned and classified complete/partial/unavailable/excluded | 100% accounted for; zero silent omissions; unread intervals forbid a complete-coverage label |
| Citation resolvability | Valid exact revision references / all emitted references | 100%; unresolved references block the affected result |
| Claim support | Fully supported atomic claims / assessed generated claims; unknown reported separately | At least 98% on held-out set; no unsupported critical decision, owner or deadline in the release suite |
| Important-fact recall | Captured gold important facts / gold important facts, with preassigned criticality | At least 95% macro average; 100% critical decisions/actions in release suite; report each language/length stratum |
| Decision precision/recall | Correct decision classifications / predicted and gold decisions respectively | Both at least 95%; proposal-to-decision and superseded-decision errors separately reported |
| Action-field correctness | Exact/accepted semantic task, owner and date matches on comparable fields | At least 98% for specified owner/date; unknown must stay unknown; report missing actions separately |
| Critical reviewer detection | Detected unsupported claims / planted or annotated unsupported claims | At least 95% recall and 90% precision; evaluate false accusations on clean notes too |
| Protected-fact invariance | Confirmed facts retained or explicitly proposed as conflicts, never overwritten | 100% in all deterministic and real-data cases |
| Recovery | Completed stage outputs/receipts retained and reused after failures | 100% tested; zero automatic duplicate submissions for unknown outcomes |
| Speech and speaker quality | WER/CER, important-term errors, DER components, timing and attribution uncertainty | No unmeasured claim; establish per-language baseline and ratified limits before route promotion |
| Usefulness | Blinded human rubric: relevance, clarity, completeness, correct structure; correction time | Median at least 4/5, no critical factual failure; compare paired correction time against baseline |
| Runtime usability | Stage latency, completion/failure rate, memory where measurable, phone reactivity | Publish measured P50/P95 and tested envelopes; no universal duration promise |

A critical fact concerns a decision, commitment, action owner/deadline, material number or condition whose error changes what a person should do. Freeze this definition before scoring. Zero observed critical failures on a finite set is a release gate, not a claim of zero production risk.

The existing citation CLI excludes unknowns from assessed-claim denominators and cannot measure omitted facts or alternative evidence sets. Extend the schema/scorer for omission recall and alternative sets; do not silently reinterpret current output. Report annotation completeness and unknown rates next to every score. A system can inflate precision by omitting difficult facts; protect recall and critical completeness simultaneously.

Aggregate at meeting level to avoid a long meeting dominating the result. Report micro counts as supplemental, along with each stratum, worst-case failures and meeting-cluster bootstrap confidence intervals. Select thresholds and statistical comparison before candidate runs. Use at least three repeated generations on a fixed representative subset to characterize nondeterminism; report all runs and actual model versions. Additional calls are permitted for meaningful evaluation, not selected until the results look good.

## LLM reviewers and human ground truth

LLM reviewers provide scalable screening and repair suggestions. They never serve as the sole benchmark ground truth. Independently score their classifications against human labels, including false positives, abstentions and missed omissions. Use a fresh review context, exact evidence and an explicit rubric; withhold the generating agent's confidence and rationale to reduce anchoring. Prefer a different measured model/method, recording shared lineage and residual correlation.

Store concise verification reasons and source references, not private chain-of-thought. If two reviewers disagree, return to evidence or mark indeterminate. Additional votes alone do not establish truth. No model may set the human-accepted flag.

## Repeatable procedure

1. Freeze dataset split, source revisions, prompt/adapter versions, scoring rubric, protected metrics and consented provider set.
2. Run deterministic schema/source/protected-edit checks and browser transport tests before real calls.
3. Generate baseline and candidate artifacts on the same inputs. Save request intents, provider request IDs when available, settings, responses and checkpoints; do not retry uncertain calls automatically.
4. Blind output identity and independently annotate claims, omitted facts, decisions/actions, references and usefulness. Preserve disagreements and missing data.
5. Run offline scorers. Retain failures, null denominators, per-stratum results, confidence intervals and actual coverage.
6. Diagnose the failing stage. Improve prompts, models, coverage or tools on development data only; re-evaluate the full protected set after a material change.
7. Promote a model/profile only if quality gates and browser/provider recovery pass. Save the router version and reason. Regressions remain visible; no cheaper-route preference.
8. Produce a signed-off release evidence packet tied to exact build SHA. Physical-device and human acceptance remain separate.

## Required negative and browser scenarios

Use deterministic synthetic data for dangerous or billable failure injection: HTTP 400/408/429/500, truncated/oversized streams, abort before/after send, tab close, quota denial, storage transaction failure, same-task concurrent tabs, unavailable locks, invalid tools, prompt injection, fabricated citation, evidence changed mid-run, old backup, source replacement, PWA update, repeated no-progress and reviewer falsely approving an unsupported claim. Confirm no automatic duplicate POST, retained raw response/recovery artifact, source/human-edit preservation and a truthful state.

Chromium and WebKit cover the ordinary and Pi flows in English/Chinese, light/dark, all palettes and 320/390/768/1440px. Real iPhone Safari/standalone and Android Chrome/installed must additionally test long processing, suspension, quota, safe areas, keyboard and assistive technology. A WebKit automation result does not close physical iPhone acceptance.

Actual OpenAI and OpenRouter runs must exercise each promoted route's browser CORS, tools, structured output, reasoning controls, authentic usage metadata and recovery without deliberately causing billable failures. Unsupported or unavailable account/model combinations stay unverified/limited. No live request is implied by documentation or a mock passing.

## Evidence packet schema

Record: evaluation ID/date; app SHA; dataset/rubric hashes; stage/role; model/provider/upstream/version; reasoning/output settings; source manifest; prompt/tool/adapter versions; consent; actual request IDs and outcomes; checkpoint/recovery evidence; anonymous annotations and adjudication; metric numerators/denominators and confidence intervals; latency; unknowns; browser/device; regression comparison; final acceptance decision. Usage is informational and is not a quality penalty. Keep sensitive raw records outside Git and public builds.

Use `PASS`, `FAIL`, `BLOCKED`, `NOT_RUN`, `NOT_APPLICABLE`. Separate implemented, tested, committed, pushed, deployed, live-functional and quality-accepted states. The product is not production-accepted until its applicable quality, reliability and device gates all have evidence.
