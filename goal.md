# Product goal

Owner follow-up, 2026-11-17: Pi review has a maximum of 100 cumulative provider attempts per persisted plan. Complete earlier when evidence is sufficient. This supersedes earlier unbounded-request wording; no-progress, storage and unknown-outcome protections remain. Browser Pi is a tool-scoped agent runtime, not a terminal or arbitrary-code agent.

Updated 2026-11-17 from the owner's explicit direction.

**Build a Pi-Orchestrated, Multi-Model, Evidence-Grounded Meeting Intelligence Platform.**

The browser remains the main workspace and local data owner. Pi coordinates deep analysis, model/tool use, verification and justified revision across OpenAI and OpenRouter. The result must be useful, accurate and inspectable, rather than merely well formatted.

## Core principles

1. LLM-first: use models for understanding, reasoning, semantic checks and generation.
2. Pi-first: use a verified browser-compatible Pi core/adapter as the workflow orchestrator, not a single prompt or an assumed browser CLI.
3. Browser-first: React/TypeScript, Web APIs, Workers and IndexedDB; authorized external AI for heavier inference.
4. Multi-model: route by measured capability and task performance, not model name or price.
5. Quality-first: prioritize accuracy, completeness, evidence and meaningful results.
6. Multi-pass: support analysis, independent review, correction and regeneration when findings warrant them.
7. No cost optimization: do not skip necessary analysis to save money. The owner-selected 100-attempt ceiling bounds execution, not quality or spending.
8. Human at the end: automate normal intermediate work; preserve initial BYOK/data consent and final human review.

Avoid loops, duplicate charges, meaningless retries and data loss. Unknown request outcomes require reconciliation; additional useful analysis is distinct from resubmitting an uncertain request. Actual browser, provider and storage limits remain explicit.

## Observable definition of done

- Preserve complete original transcripts and provider output.
- Keep speaker attribution traceable, correctable and grounded in acoustic evidence where identity continuity is claimed.
- Ground key decisions and action fields in exact source revisions.
- Account for all long-meeting input; never silently omit important topics due to context limits.
- Independently detect unsupported conclusions, contradictions and material omissions.
- Protect human-confirmed facts and edits from silent AI replacement.
- Recover interrupted work from durable checkpoints without replaying completed or uncertain requests automatically.
- Expose every stage's status, coverage and quality findings.
- Verify real recordings, real provider routes, browser E2E and physical-device behavior.
- Measure generation quality using independent human reference data, not only LLM self-scores.

## Delivery state and ownership

Current state: implemented browser beta with partial Pi selective review. The first quality deliverable (QF01: useful continuation beyond six requests/32 lookups with progress and recovery guards) and the screenshot-reported theme repair shipped in application commit `122e935`; validation records the exact hosted build and tests. The long-recording recovery follow-up adds portable recording identity, non-destructive reattachment and refusal to replay missing paid checkpoints; it does not yet export those separate checkpoints. QF03 now includes explicit, persisted OpenAI/OpenRouter Pi routes for the existing Luna model, with manual reasoning/output controls and no silent fallback; see [routing boundaries](docs/MODEL-ROUTING.md). The full quality workflow, benchmark-based multi-model router and real-meeting quality acceptance are planned; they are not completed by this document.

[Quality-first plan](docs/QUALITY-FIRST-PLAN.md) owns architecture, audited gaps and the phased roadmap. [Quality evaluation](docs/QUALITY-EVALUATION.md) owns proposed measurement gates. [task.md](task.md) tracks implementation; [FEATURES_MAP.md](FEATURES_MAP.md) distinguishes current features from proposed modules; [validation](docs/VALIDATION.md) records actual evidence. No checklist percentage is a production-quality score.
