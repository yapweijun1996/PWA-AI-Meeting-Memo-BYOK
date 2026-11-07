# Speaker profile evaluation plan (cross-meeting recognition)

Status: plan only, 2026-11-07. No code, model, dataset or product change exists. This document defines how to decide, with evidence, whether the app should ever suggest "this speaker may be Allen" in a later meeting. It does not approve the feature.

## 1. Question and scope

**Question.** After a user confirms that an anonymous speaker in meeting A is a named person, can a local model suggest that person in meeting B with an error rate low enough to help rather than mislead?

**In scope for the evaluation:** measuring accuracy, robustness, runtime cost and privacy handling of a browser-local speaker-embedding approach.

**Out of scope:** changing the app, storing any voice feature, uploading audio anywhere new, automatic identity assignment, or any claim about a real person's identity. Product scope still says "no cross-meeting voiceprints" ([README](../README.md), [future evaluation B05](FUTURE-EVALUATION.md)); that statement changes only after an explicit owner decision informed by this evaluation.

## 2. Candidate approaches

| ID | Approach | Biometric data | Status |
| --- | --- | --- | --- |
| C1 | Local speaker embeddings (for example the ONNX WavLM speaker-verification model via Transformers.js) compared with cosine similarity | Yes | Search found a model card and a merged library PR; model size, browser runtime, and error rates on meeting audio are NOT VERIFIED |
| C2 | Another local runtime (for example sherpa-onnx WebAssembly) | Yes | Browser support for speaker identification NOT VERIFIED; investigate before inclusion |
| C3 | Roster memory: a saved attendee list per meeting series, user maps anonymous labels to names once, with optional content cues (name mentioned, self-introduction) shown as hints | No | Baseline and fallback; also measured so C1/C2 must beat it |

The model card's example scores (about 0.96 same speaker, 0.62 different speaker) come from a single example. They are not an accuracy result for this project.

## 3. Consent and data handling for the evaluation itself

1. Written, per-person consent that names the purpose (accuracy testing of speaker recognition), what is stored (recordings, labels, derived vectors), where, for how long, and how to withdraw.
2. Use only the owner's private, consented recordings; no public figures, no scraped audio, no third-party recordings.
3. Keep recordings, labels and vectors out of Git, CI, logs, backups and build artifacts. Store them in an access-restricted local folder; delete on withdrawal.
4. Pseudonymize in the dataset (P01, P02, ...); the name-to-ID map is held separately.
5. Run inference locally; no audio or vectors are sent to any provider during evaluation.
6. Legal treatment of voice data varies by jurisdiction; the owner obtains compliance advice. This plan gives no legal conclusion.

## 4. Dataset design

Proposed minimums (the owner may change them before any data is scored):

- At least 10 speakers, to avoid conclusions from a handful of voices; report confidence intervals either way.
- At least 3 separate sessions per speaker on different days, so enrollment and test audio differ in room, microphone and condition.
- Languages and registers actually used: Mandarin, English, Singlish, ERP terminology, code-switching.
- Conditions: close microphone, laptop microphone, phone speaker, conference room, background noise, overlapping speech, short replies, a speaker with a cold or tired voice if available.
- Per speaker: enrollment audio of 60 to 120 seconds of clean single-speaker speech from session 1; test segments from sessions 2 and 3.
- Include impostors: speakers who are never enrolled, to measure open-set rejection.

**Labeling.** Two annotators label speaker identity per segment on a subset; report agreement. Mark overlap and uncertain segments instead of forcing a label. Gold segment boundaries come from annotation, not from a provider.

## 5. Protocol

1. Split by session, never by random segment: enrollment on session 1, tuning of the decision threshold on session 2, final test on session 3 (held out and scored once).
2. Fix the threshold rule and the acceptance numbers in writing before opening the test split.
3. Run two segmentations: (a) gold segments, to measure the model alone; (b) provider diarization segments from the real pipeline, to measure what the app would actually feed it.
4. Sweep segment length (for example 1, 2, 3, 5, 10 seconds) to find the shortest duration below which no suggestion should be shown.
5. Compare C1/C2 with C3 on the same sessions.
6. Repeat with and without noise and overlap subsets; do not merge them into one headline number.

## 6. Metrics

- Verification: equal error rate, false-accept rate and false-reject rate at the chosen threshold, with 95% confidence intervals.
- Identification: top-1 accuracy among enrolled speakers, and open-set behavior (rate at which an unenrolled speaker is wrongly matched to someone).
- Calibration: score bands (confident / uncertain / none) and the error rate inside each band.
- Minimum reliable segment duration.
- Per-condition breakdown (language, microphone, noise, overlap) and per-speaker breakdown to expose speakers the model handles badly.
- Human effort: correction time for the roster-only baseline versus suggestions, using the existing manual review flow.
- Runtime on target devices: model download size, first-load time, memory, time per minute of audio, WebGPU versus WebAssembly, behavior in iOS Safari and Android Chrome, and offline availability after first load.

## 7. Acceptance gates (proposals, owner to approve before testing)

The numbers below are starting proposals, not established requirements.

| Gate | Proposed condition |
| --- | --- |
| G1 wrong-name risk | False-accept rate at the shipped threshold is at most 1% on the held-out test, with the upper confidence bound reported; unenrolled speakers are wrongly matched at most 1% |
| G2 usefulness | At least 80% of correct enrolled segments reach the confident band, and the suggestion saves measurable review time versus C3 |
| G3 robustness | No condition subset (language, microphone, overlap) falls below the agreed floor; failures are listed, not averaged away |
| G4 runtime | First-load size and time are acceptable on the owner's devices and the page stays responsive during inference |
| G5 privacy | Consent, local-only storage, deletion and backup exclusion work as specified in section 8 |

If G1 fails, the feature does not ship in any form that names a person automatically. If only G2 fails, C3 may still be the better product.

## 8. Product constraints if the decision is GO

- Opt-in per person with recorded consent; off by default.
- The app only suggests; a human confirms. Unconfirmed identity stays anonymous, as it does today.
- A suggestion is never shown below the minimum segment duration or in the "uncertain" band.
- Vectors live in a separate, app-scoped local database, are excluded from meeting backups by default, are never sent to a provider, and can be deleted per person. An optional encrypted export needs its own design.
- Show the evidence for each suggestion (segment, score band) and always allow "not this person".
- Document the scope change in README, PRODUCT, ARCHITECTURE and the privacy copy before release; handle the shared-origin storage risk already described for provider keys.
- Existing meetings, speaker review, CAS and undo behavior are unchanged.

## 9. Deliverables

1. Consent form and dataset manifest (pseudonymous).
2. Evaluation script and its run log (written only after the owner supplies annotated audio).
3. Results report with the tables from section 6, confidence intervals, and the explicit PASS / FAIL / NOT RUN status of each gate.
4. Recommendation: GO (C1 or C2), GO with C3 only, or NO-GO, with limitations and remaining risks.

## 10. Risks

- Voice features can be misused for identification without consent; mitigated by opt-in, local-only storage and deletion.
- Models trained on celebrity interview data may not transfer to Singlish, code-switching or noisy rooms.
- Short or overlapping segments produce unstable vectors and confident wrong answers.
- A wrong suggestion that a user accepts silently attributes statements to the wrong person; review friction must be designed against this.
- Large model downloads and memory use may exceed phone limits.
- Third-party library and model licensing needs review before any dependency is added.

## 11. Open decisions for the owner

1. Approve the dataset minimums and the proposed gates, or change them before any scoring.
2. Name the person who gives compliance advice on voice data.
3. Supply consented, annotated recordings or approve a recording session.
4. Decide whether C3 (roster memory) should be built first regardless of the outcome.

## Sources

[Xenova/wavlm-base-plus-sv](https://huggingface.co/Xenova/wavlm-base-plus-sv), [transformers.js PR 603](https://github.com/huggingface/transformers.js/pull/603).
