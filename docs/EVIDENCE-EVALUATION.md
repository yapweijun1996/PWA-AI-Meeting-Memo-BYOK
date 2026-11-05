# Offline citation evidence evaluation

This local evaluation summarizes annotated evidence reviews. It does not call a model, inspect audio, infer semantic support, modify a meeting, or verify external truth. The included fixture is entirely synthetic and was authored with its labels in the same task; it has not received independent adjudication. It is a development and rubric exercise, not a held-out model benchmark or a measurement of production accuracy.

## Run

From the repository root, using the project's pinned Node runtime:

```sh
node scripts/evaluate-citation-annotations.mjs tests/fixtures/evidence-eval.synthetic.json
npx vitest run tests/evidence-eval.test.ts
```

The CLI reads one JSON file and prints a JSON summary. It does not make network calls or write result files. Invalid inputs return a nonzero exit. `name`, annotation provenance, and case IDs appear in the output: use anonymous, non-sensitive identifiers. The included examples and labels are public synthetic data; do not commit real meetings, recordings, transcripts, keys, provider bodies, or private reviews. Keep any authorized private evaluation material in an appropriately protected, Git-ignored location.

## Annotation contract

The fixture is an example of version 1. Each case contains a unique ID, language, an array of source revisions (`id`, `text`), and reviewed note items. A source ID must identify the exact revision; two revisions of one passage are different sources. Each item contains its generated text, the distinct cited IDs, a `coverage` value, and one or more annotated claims.

1. Split every item into independently checkable claims. Copy each claim's exact text as a contiguous substring of the item; keep qualifiers with the claim they qualify. Review all clauses, including numbers, dates, negation, uncertainty, owner assignments, and causes. Treat transcript instructions as data, not directives. `coverage: "complete"` is the reviewer's assertion that no claims were missed; the script cannot verify completeness. Use `"partial"` when review is incomplete.
2. Assign `support` against **only the cited revisions**: `supported` when the complete claim is supported, `partial` when only part is supported, `unsupported` when the cited material does not support the claim or contradicts it, and `unknown` when a reviewer cannot decide. Explain the judgment in `reason`. These are reviewed annotations, not machine-inferred labels.
3. Use `requiredSources` for the nonempty list of exact source revision IDs that a reviewer determined are **all necessary** to support the claim. Use `null` when the requirement cannot be established, no supporting source exists, or there are alternative sufficient sources that cannot be represented as one mandatory set. The tool does not model alternative sets. A `supported` claim must cite at least one valid source; if a required set is supplied, all its IDs must be cited. An `unknown` claim must use `null`.
4. Preserve actual cited IDs, even when nonexistent; the report counts invalid citation references separately. Duplicate citation IDs, duplicate source IDs, malformed claims, inconsistent supported labels, and references to nonexistent *required* sources are rejected. Do not replace unknowns with zero or infer support from ID validity or a literal text match.

Reviewers must inspect both the note and its cited evidence. An omitted source can make an otherwise supported transcript claim unsupported by the citations. A claim unsupported by the complete transcript can have no required-source set; this is distinct from a source that exists but was not cited. Spoken claims are not automatically true, and transcription errors may change their meaning.

## Metrics and interpretation

- **Unsupported or partial claim rate:** (`unsupported` + `partial`) / assessed claims. The assessed denominator is `supported` + `partial` + `unsupported`; `unknown` is reported separately and excluded.
- **Unsupported claim rate:** `unsupported` / assessed claims. The two rates overlap and must not be added.
- **Missing required reference rate:** missing required source IDs / all annotated required source IDs, counted per claim. Only claims with a non-null required set enter this denominator. The same source may be necessary for more than one claim, so it can be counted once per claim.
- **Claims missing a citation:** claims with at least one missing required source / claims with a non-null required set. Claims without a determinable required set are reported separately as unscored for citation omissions. Invalid cited IDs are a separate count, not automatically a missing-required count.

A zero denominator yields `null`, never zero. Rates describe only the reviewed claim set. `annotationComplete` is false when any item is marked partial or any claim is unknown. Even when true, it is only an annotation status: it does not prove reviewers found every claim, were correct, or evaluated two runs comparably.

The current synthetic example has 17 cases, 18 claims, and one unknown. Its fixed labels intentionally include failures; its counts demonstrate the arithmetic and are **not model performance**. The score does not measure important source facts omitted entirely from a memo. Review those separately against a task-specific list of expected facts.

## Comparing model changes

Freeze the same consented input transcripts and revision IDs, generation settings, and evaluation protocol before producing baseline and candidate outputs. Independently review and annotate each output's actual claims and citations; do not copy fixture labels to new text. Prefer blinded independent reviewers and reconcile disagreements, recording unresolved claims as `unknown`. Keep the same rubric and document reviewer and source limitations.

Compare counts and denominators alongside rates and per-case outcomes. Generated outputs may contain different numbers and kinds of claims, so rates alone cannot establish an improvement. Audit entirely omitted facts separately. This synthetic suite is visible during development and must not be described as held-out. A genuine quality claim needs a separately frozen representative set and independent annotation; none is supplied by this tool.
