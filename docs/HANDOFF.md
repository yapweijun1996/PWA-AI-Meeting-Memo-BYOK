# Handoff: speaker voice matching and project state

Written 2026-11-10 for the next engineer or AI agent; section 8 and the 2026-11-16 changes are current as of 2026-11-16 (`9471b4a`). Read this first, then [AGENTS.md](../AGENTS.md), then the documents linked below for the area you touch. Statements are marked **verified** (checked by running code or reading a primary source in this work), **observed** (one real recording, not a benchmark) or **not verified**. Do not upgrade a claim without new evidence.

Licence correction, 2026-11-16: the upstream Microsoft model card explicitly links CC BY-SA 3.0 terms; the earlier blanket absence claim below is historical. The pinned ONNX conversion's notices/derivation compliance remains open. Consent now links the reviewed sources and preserves distinct local-analysis/provider-transcription disclosures; [validation](VALIDATION.md#speaker-model-consent-disclosure--2026-11-16) owns its tested delivery scope. [The selection record](SPEAKER-MODEL-SELECTION.md#licence-evidence-correction--2026-11-16) owns exact sources and remaining gates. No weights are published by this correction, and matching accuracy remains unmeasured.

## 1. The project in one paragraph

A browser-first, speaker-aware meeting memo PWA hosted on GitHub Pages. The user brings their own provider keys (BYOK); meetings, recordings and revisions live in this browser's IndexedDB. Speech is transcribed by a provider (default OpenRouter `elevenlabs/scribe-v2`); notes are generated from reviewed transcript passages. See [README.md](../README.md), [PRODUCT.md](PRODUCT.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

## 2. The feature this handoff is about

**Owner goal:** inside one meeting, automatically give each person one anonymous, meeting-scoped voice identity (a "Voice ID") across processing chunks, so nobody has to listen and merge speaker labels by hand. Original provider output and human edits are preserved; every change is one undoable revision. No cross-meeting voiceprints and no real-world names by default.

**Why it is needed:** a recording over 24 MB is split into parts and each part is transcribed separately, so the provider numbers speakers from scratch in every part. A 59-minute, 4-person episode became 5 parts and 19 labels.

## 3. State on 2026-11-10

| Area | State |
| --- | --- |
| Local speaker model (WavLM base plus SV, q8, WASM worker, pinned revision) | Implemented; runs in the browser |
| Single (non-chunked) MP3/M4A: group provider labels that share a voice | Implemented, **verified with fake vectors only** |
| Chunked recordings: match labels across parts | Implemented; **observed** to turn 19 and 18 labels into 4 voices on one recording when told "4 people" |
| Without a speaker count | **Observed** 7 voices plus 1 undecided on the same recording (not 4) |
| Human-confirmed speakers absorb their voice's other labels | Implemented and unit tested |
| Accuracy on meeting audio | **Not measured.** No labelled ground truth exists |
| Thresholds | Uncalibrated starting values from one recording; mixed-label margin 0.2 and head-count floor 0 added 2026-11-16, also uncalibrated |
| 2026-11-16 changes (VID02–VID09) | Vector reuse, filtered 16 kHz audio, six samples per label, human "not the same" decisions as constraints, mixed-label check, head-count floor, evaluation export and replay. Fake vectors and synthetic audio only; **none has been measured on a real recording**. See [gap.md](../gap.md#voice-identity-logic-gap-register--2026-11-16) |
| Voice matching on the GitHub Pages demo | Route B implemented: the build ships only the runtime and the browser downloads the weights from Hugging Face after consent. **Not verified on the deployed site**; see section 8 and [SPEAKER-MODEL-DOWNLOAD-DESIGN.md](SPEAKER-MODEL-DOWNLOAD-DESIGN.md) |
| WavLM weight licence | Upstream card links CC BY-SA 3.0; ONNX notices/derivation compliance remains unreconciled. See the 2026-11-16 correction above. |

## 4. How it works

```
chunked recording ─► provider transcript per part (paid, sequential, saved per part)
                      │
                      ▼
   select clean samples ─► decode only that window ─► WavLM embedding (worker) ─► save vector
   (1.5–4 s, one speaker,        (never the whole file)      (512-dim)           (IndexedDB)
    timed, no overlap)
   Since 2026-11-16: up to 6 samples per label per part, one per turn first, 0.25 s inside
   turn edges; filtered 16 kHz conversion; silent or clipped windows are left out.
                      │   all parts embedded
                      ▼
   matchLabelsAcrossParts  (multi-part, some part has 2+ labels)
     1 subtract the recording's average vector      ← raw cosine cannot separate voices
     2 label mean = average of its samples
     3 within a part: labels are different people, unless their means are ~identical (>= 0.9)
     4 across parts: one voice per label, one label per voice per part, best pairs first
        floor 0.35, lead over runner-up 0.10; no pair above floor => new voice
     5 optional expectedVoices N: group further, most similar first, until N remain;
        sharing a part is penalised (-0.5) but allowed (providers over-split)
                      │
                      ▼
   assignments + identities (derived, replaceable) ─► apply to transcript
     human-confirmed speaker in the voice  → other labels join that speaker
     two different confirmed speakers      → the voice is not applied
     already re-keyed speakers             → followed back to their original labels
     one undoable revision; provider run and text untouched
```

Assignment states: `matched`, `new_identity`, `ambiguous`, `unresolved` (too few samples), `conflict` (a label's own samples contradict), `stale`.

### Code map

| File | Role |
| --- | --- |
| `src/domain/acoustic-speaker.ts` | Policy constants, sample selection, `chooseAcousticAssignment` (per label), `clusterRecordingSources` (single file), `matchLabelsAcrossParts` (multi-part), `applyAcousticAssignments*` |
| `src/jobs/acoustic-continuity.ts` | Resumable per-part runner, consolidation step, `describeAcousticState` diagnostics |
| `src/jobs/single-recording-voices.ts` | Single MP3/M4A voice check |
| `src/jobs/chunked-runner.ts` | Chunked transcription; runs the acoustic step after all parts are saved |
| `src/audio/speaker-embedding.ts`, `.worker.ts`, `acoustic-audio.ts` | Model worker, pinned asset manifest, bounded window decode |
| `src/storage/acoustic-store.ts` | IndexedDB stores: embeddings, identities, assignments, checkpoints, transcript pages |
| `src/features/MeetingWorkspace.tsx` | Consent checkbox, **Auto-match voices**, optional "How many people spoke?", result notice |
| `scripts/prepare-speaker-assets.mjs`, `speaker-assets.mjs`, `build-pwa.mjs` | Hash-verified model assets and the build step |

Tests: `tests/acoustic-*.test.ts`, `tests/single-recording-voices.test.ts`, `tests/speaker-*.test.ts`, `tests/browser/acoustic-old-run.spec.ts`.

## 5. Evidence and its limits

One real recording (59:06, 78.2 MB, 5 parts, 4 speakers according to the owner), transcribed twice (meetings "222" and "333"), WavLM, scribe-v2 labels. **Observed, not a benchmark:**

- Raw cosine fails: same-label sample pairs median 0.82 vs different labels in one part median 0.74, and every label had a raw best match at or above 0.86 in another part (median 0.96). A raw accept threshold would merge everyone.
- After subtracting the recording's average vector: 0.27 vs -0.11, and the closest label in another part had median 0.63. Single short samples are very noisy (same-label 10th percentile -0.22), so decisions use whole-label averages.
- Same-person similarity (0.32–0.57) overlaps different-person similarity (0.40), so a similarity threshold alone cannot decide; the one-to-one and same-part constraints plus an optional speaker count do the work.
- Two independent transcriptions of the same audio produced near-identical speaker shares (about 26/41% for the two main speakers), which suggests the grouping is stable. It is not proof of correctness; nobody has listened to every label.
- An earlier offline experiment (see [IMPLEMENTATION-LOG.md](IMPLEMENTATION-LOG.md), "Speaker-count finding") found 4 voices with sherpa-onnx pyannote segmentation plus WeSpeaker on a different recording.

## 6. Run, verify, diagnose

Node **22.23.3** (`.node-version`; CI uses it). Local machines may run newer Node; do not rely on that.

```bash
npm ci
npm run dev                  # http://127.0.0.1:5173/PWA-AI-Meeting-Memo-BYOK/
npm run lint && npm run typecheck && npm run test:unit
npm run build                # also needs SPEAKER_ASSET_SOURCE for a build that can match voices
```

Voice-related unit tests run in about 3 seconds: `npx vitest run tests/acoustic-*.test.ts tests/single-recording-voices.test.ts`.

**Pitfalls learned the hard way**

1. **The dev server reloads the page on every source save.** A local voice analysis takes minutes and is killed by each reload, leaving the checkpoint `running`. When several people or agents edit the tree, run long analyses from a static build instead: `npx vite build --outDir <scratch dir>` then `npx vite preview --outDir <scratch dir> --host 127.0.0.1 --port 5173 --strictPort`. Same origin, same IndexedDB.
2. **IndexedDB is per origin.** `127.0.0.1:5173`, `127.0.0.1:4173` and the Pages URL do not share meetings or keys.
3. Voice analysis uses the meeting's Web Lock through its final save. A second tab is refused while another meeting job holds that lock. If Web Locks are unavailable, local voice analysis stops with a message; ordinary transcription can continue without opting into voice analysis. Closing the owning tab releases its lock. An explicit re-analysis restarts derived decisions and reuses compatible saved vectors; it does not resubmit paid audio.
4. A re-run after a merge used to find nothing to change because merged speakers lost their original label ids; this is handled by aliases computed from the immutable provider run (`runs[].originalSegments`). Undo, then re-run, if a result looks wrong.
5. Until 2026-11-16 re-analysis recomputed every vector whenever the meeting revision changed (about 2 minutes for 57 samples on the test machine). Saved vectors are now reused when the recording, sample window, model and `ACOUSTIC_POLICY.extractionVersion` match; only decisions are revision-bound. Change `extractionVersion` when audio preparation or model input changes, never for a threshold change.

**Reading a result.** The workspace notice after **Auto-match voices** reports samples analysed, labels resolved into N voices, counts per state, pair statistics before and after removing the recording's average vector, and the closest cross-part match per label. Raw state can be read in DevTools:

```js
// Run in the page console. Read-only.
const db = await new Promise(r => { const q = indexedDB.open('meeting-memo-byok-v1'); q.onsuccess = () => r(q.result); });
const all = s => new Promise(r => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => r(q.result); });
const [assignments, identities, checkpoints] = await Promise.all(['acousticAssignments', 'acousticIdentities', 'acousticCheckpoints'].map(all));
```

Filter by `meetingId`; an `assignment.thresholdVersion` ending in `one-to-one-centered-v2` (`-v1` before the 2026-11-16 mixed-label and head-count safeguards) means the multi-part consolidation produced it.

**Measuring a result.** After confirming speakers by ear, **Export voice evaluation data** (Speakers tab, under "Most similar voices") downloads the saved vectors and decisions with confirmed speakers as pseudonymous references. `node scripts/evaluate-voice-matching.mjs <file>` reports same-person and different-person similarity, the balanced threshold with its error rates, labels that mix people, and the saved grouping's correct, wrong and missed merges. Add `--replay` to re-run the app's multi-part matcher on the same vectors under other floors, margins, the reference head count and the human "different" pairs. It describes that one recording; the reference inherits any error the person did not catch, and settings tuned on one recording must be confirmed on another. No real recording has been measured yet. The full gap list is in [gap.md](../gap.md#voice-identity-logic-gap-register--2026-11-16).

## 7. Rules that bind this work

From [AGENTS.md](../AGENTS.md) and the owner: acoustic evidence only (names, labels or overlapping words are not voice identity); keep ambiguity and overlap; preserve original output and human edits; support undo and revision invalidation; never retry a paid request automatically; keys are never in backups, logs, caches or builds; no cross-meeting voiceprints by default; never claim real-world identity or unmeasured accuracy; disclose tested limits.

## 8. Risks and blockers

1. **Model licence follow-up.** The upstream Microsoft model card links CC BY-SA 3.0 despite missing API licence metadata. The pinned Xenova ONNX conversion identifies that base model, but its notices/derivation compliance remains open. Consent links the reviewed evidence and states that limitation. Runtime-download route B remains selected; no weights are published by this correction. Exact sources and remaining gates: [SPEAKER-MODEL-SELECTION.md](SPEAKER-MODEL-SELECTION.md#licence-evidence-correction--2026-11-16).
2. **The demo downloads its model at run time (route B).** `.github/workflows/pages.yml` does not set `SPEAKER_ASSET_SOURCE`, so the build writes a `remote_model` manifest and ships only the ONNX Runtime; the browser fetches the 102 MB weights from `huggingface.co` after consent and caches them (Settings can delete them). Verified: a CI-style build and the artifact check. **Not verified:** the download from the deployed site, WebKit, offline reload, phone memory, resume inside one file. `public/speaker-assets/` stays git-ignored.
3. **Thresholds are one recording's worth of evidence.** Calibrate on more meeting audio with labelled pairs before any accuracy claim.
4. **The speaker count is a human input.** A wrong number forces wrong merges. Do not infer it silently.
5. **Single-voice recordings** (one label per part) bypass the centered matching, because removing the average would erase the only voice; per-part decisions are kept.
6. **Provider labels that mix voices** limit everything downstream; no step here splits a label by voice.
7. Speaker review shows a "Most similar voices" hint per speaker (`src/domain/voice-suggestions.ts`, added 2026-11-16): it ranks other speakers from the saved vectors (recording average removed), plays one clean sample of each back to back, and merges through the existing undoable path. It is a hint, not a decision: bands (high/medium/low) reuse `PART_MATCH_POLICY` and are uncalibrated; since 2026-11-16 a rejected pair is saved with the meeting (`voiceDecisions`) and, with confirmed speakers, constrains re-analysis (`src/domain/voice-constraints.ts`): confirmed speakers' labels share a voice, and labels of different confirmed speakers or of a rejected pair never do. Verified with fake vectors (unit tests) and one seeded browser flow in Chromium and WebKit; back-to-back playback in Chromium only; not yet checked on a real recording.
8. Not built: local diarization independent of provider labels, WAV/WebM single-file support, cross-meeting identities.

## 9. Recommended next steps

1. Verify route B on the deployed site (real download, WebKit, offline reload, a phone), add a Playwright test of the download flow, and resolve the weight licence question (route A: ask the publisher; or choose a model with an explicit licence).
2. Measure on real recordings (VID01b): re-run Auto-match voices on a meeting (vectors from earlier builds are recomputed once), confirm each speaker by listening, **Export voice evaluation data**, then `node scripts/evaluate-voice-matching.mjs <file> --replay`. Calibrate only after at least two recordings agree; compare WavLM with the sherpa-onnx route (VID13).
3. Extend the speaker review voice hints (built 2026-11-16, see section 8 item 7): persist "not the same" decisions with revision invalidation, and record confirmations as ground truth for calibration.
4. Run Chromium and WebKit browser acceptance for the voice flow and physical iOS/Android checks before any mobile claim.
5. Decide whether cross-meeting identity is wanted; it needs consent, local controls, deletion and no real-world naming.

## 10. Working in a shared directory

Several people and agents may edit one working tree. Check `git status` and the current branch before branch-sensitive operations, stage explicit files, and never discard changes you did not make. Reconcile with `origin/main` in a separate clean worktree when the shared tree is dirty. Do not commit, push or deploy without the owner's authorization for the current task.

## 11. Where else the context lives

[ACOUSTIC-SPEAKER-CONTINUITY.md](ACOUSTIC-SPEAKER-CONTINUITY.md) (design and observations), [SPEAKER-MODEL-SELECTION.md](SPEAKER-MODEL-SELECTION.md) (candidates, licences, criteria), [SPEAKER-MODEL-DOWNLOAD-DESIGN.md](SPEAKER-MODEL-DOWNLOAD-DESIGN.md) (proposal: download the model from its host at run time), [DEPLOYMENT.md](DEPLOYMENT.md) (Pages, CI, assets), [IMPLEMENTATION-LOG.md](IMPLEMENTATION-LOG.md) (per-task evidence), [task.md](../task.md) (checklist), and the KB-MCP project memories for `PWA-AI-Meeting-Memo-BYOK`.
