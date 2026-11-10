# Acoustic speaker continuity for long recordings

Status: partial implementation, updated 2026-11-10. Start with [HANDOFF.md](HANDOFF.md) for the current state, code map, pitfalls and next steps. A local model worker, bounded sample extraction, a single-recording voice check, multi-part matching and an existing-meeting workflow are implemented and unit tested with fake vectors. On one real 4-speaker, 5-part recording the multi-part matching produced 4 voices when told the speaker count and 7 plus 1 undecided without it (observed, not an accuracy measurement). Accuracy on meeting recordings, offline reload, arbitrary-length processing, browser acceptance and the model weight licence are not yet verified. This document concerns anonymous identities within one meeting, not cross-meeting recognition or real-world naming.

## Owner requirement

Automatically associate the same voice across recording parts without requiring users to listen, enroll speakers, or merge labels manually. A change to the single-upload size limit does not meet this requirement. Keep the PWA browser-first; an approved lightweight backend remains a fallback, not a mandatory architecture.

Long-recording support means bounded processing and durable continuation across parts. It does not mean infinite device storage, unlimited provider credit, perfect recognition, or uninterrupted browser background execution. Publish actual tested limits and unsupported cases.

## Current implementation boundaries

The current app imports at most 4 GiB, records at most 2,000 audio parts, and stores at most 20,000 current segments, 100 speakers, and 400 jobs in a meeting aggregate. `runChunkedSpeech` still collects and merges completed part transcripts into that aggregate. These limits remain until their owning implementations and consumers are changed and tested.

For an existing chunked meeting, **Auto-match voices** runs local analysis after model-download consent. It can recover part evidence from an older provider run and retains original output, current text, and undo history. Uncertain results remain unresolved; similarity thresholds are not calibrated for this application's recordings. A new chunked transcription can also opt into matching. The model and ONNX runtime are prepared separately and are not included in the installation precache. A build without prepared assets reports matching as unavailable.

For local development, run `node scripts/prepare-speaker-assets.mjs --source <verified-probe-public-directory> --output public/speaker-assets`. The command checks pinned hashes and does not download assets. For a production build, set `SPEAKER_ASSET_SOURCE` to that source directory and `SPEAKER_ASSETS_REQUIRED=1`; otherwise a build may contain an unavailable model manifest. The local asset directory is ignored by Git.

A single (non-chunked) MP3 or M4A also has **Auto-match voices** after transcription. It treats the file as one part and groups provider labels that the same voice was split into, only when every cross-label sample pair clears the acceptance cosine and the group is mutually consistent (`clusterRecordingSources`). Tick the same consent box in the transcription dialog to run it automatically once the transcript is saved; a failed check never discards the transcript. It needs a transcript with speaker labels and timestamps; a model that returns neither (for example `gpt-transcribe`) gives it nothing to sample, and the app says so. Labels that stand alone are not rewritten. Tested with a fake decoder and fake vectors only; accuracy on real single recordings is not yet measured. WAV/WebM recordings are not supported by this path.

Chunked recordings use the same rule inside each part: provider labels in one part whose samples all agree share the lead label's decision (new or matched identity). The manual **Auto-match voices** button re-decides every part (`restart`), reusing cached vectors for the same revision, so earlier results gain this grouping. Fake-vector tests only; real accuracy is not measured.

**Observation that changed the method (2026-11-10, one real 59-minute, 4-speaker, 5-part recording, WavLM, scribe-v2 labels).** Raw cosine could not separate voices: same-label pair median 0.82 vs different-label pair median 0.74, and every label had a raw closest match at or above 0.86 in another part (median 0.96), so a raw accept threshold would merge everyone. After subtracting the recording's average vector the medians were 0.27 (same label) vs -0.11 (different labels in a part), and the closest label in another part had median 0.63. Single short samples are noisy (same-label 10th percentile -0.22 centered), so decisions use whole-label averages, not worst-case pairs. For a chunked recording in which some part has two or more labels, `matchLabelsAcrossParts` therefore runs after all vectors are saved: it removes the recording average, treats labels in one part as different people (unless their averages are nearly identical), pairs each unit with at most one voice per part, best pairs first, starts a new voice when nothing clears the floor, and leaves near-ties ambiguous. `PART_MATCH_POLICY` (floor 0.35, margin 0.1, within-part merge 0.9) is an uncalibrated starting point taken from that single recording; it is not an accuracy result. With one label per part the per-part decisions are kept, because removing the average would erase a single voice. Fake-vector tests only; a real-recording result with the known 4 speakers is the pending check. A part-by-part human comparison panel is not built.

Human confirmation wins over a voice match. When a voice contains exactly one human-confirmed speaker, its other labels join that confirmed speaker (so a confirmed name follows its voice across parts). When a voice contains two or more speakers a human confirmed as different people, the voice is not applied to any of its labels. Unconfirmed labels of one voice still join an anonymous voice. The change is one undoable revision and original provider output is untouched.

Current matching-word links describe overlapping transcription evidence. They do not measure voice characteristics and cannot establish acoustic identity across arbitrary parts.

## Candidate processing path

1. Retain each completed provider result as original evidence with its part index and absolute audio offset. Never repeat a paid submission merely because local voice analysis failed.
2. Automatically select bounded, timed speech samples from each anonymous part speaker. Exclude known overlap, missing timing, and windows containing other attributed voices. Do not treat surrounding context or a readable caption group as a clean single-speaker sample.
3. Decode only the required audio window, mix channels and resample according to the tested model contract. Do not decode an entire long recording to obtain a short sample.
4. Compute acoustic embeddings in a Web Worker. Compare multiple independent samples and retain contradictory evidence. A shared name, label, transcript, or chunk boundary is not a matching signal.
5. Associate supported matches with stable meeting-scoped identities. Insufficient or conflicting evidence remains unresolved; processing can continue without forcing a guessed merge or requiring a manual decision.
6. Persist bounded checkpoints. Apply validated attribution changes through the existing revision, undo, and conflict-protection contracts, preserving original outputs and human edits.

The first candidate is WavLM speaker verification through Transformers.js. The publisher provides ONNX weights and same/different-speaker example audio. Those examples are useful for runtime smoke testing, not a project accuracy benchmark. The model's published example threshold is dataset-dependent and must not become a claimed calibrated production threshold.

## State and ownership

| Owner | Responsibility |
| --- | --- |
| Audio | Verified source association, absolute offsets, bounded decoding, sample quality and cancellation |
| Model worker | Pinned runtime/model, finite normalized vectors, bounded inference, resource cleanup |
| Speaker domain | Acoustic match policy, conflicting/overlapping voices, stable meeting identity mapping |
| Storage | Per-part originals, analysis checkpoints, bounded reads, versioning and deletion |
| Jobs | Local analysis stages, recovery, cancellation and separation from paid submissions |
| Review UI | Clear matching/unresolved/error states, preserved edits, undo and correction |

Checkpoint identity must include the meeting, recording identity, provider result, model revision, sample-extraction version and relevant source revision. A changed recording, model, attribution edit or undo must not silently reuse incompatible decisions or automatically reapply a rejected merge.

Never silently merge two separately confirmed human identities or discard a confirmed name by choosing an anonymous merge target. Acoustic similarity does not confirm a person's real-world name.

## Long-recording storage work

Supporting more parts requires persistent transcript pages and paged task history, not simply larger array limits. Source lookup, playback, transcript editing, memo input, citations, undo, export, restore and deletion must all resolve the same authoritative records. A partial first page must not masquerade as the complete transcript.

Keep a bounded working set of audio, source pages, candidate samples and identity representatives. Persist completed part results before analysis or navigation. Define migration and rollback behavior before changing the shipped meeting schema. Existing meeting backups must remain readable, and unsupported exports or memo sizes must be explicit rather than truncated.

## Model delivery and privacy

- Bundle a pinned JavaScript runtime and verify model revision, license, size and integrity before shipping.
- Explain the model download before first use; keep it separate from paid provider operations.
- Use an app-scoped model cache containing only approved public model/runtime assets. Never place recordings, embeddings, keys or provider responses in that cache.
- Keep acoustic checkpoints scoped to the current meeting and exclude them from ordinary exports and backups unless a separate export contract is approved. Remove them when the meeting or recording is deleted or replaced.
- Do not send audio or embeddings to a new endpoint without explicit recipient/data disclosure. Do not introduce a hidden proxy when browser CORS fails.
- Preserve the existing BYOK storage and unknown-billing rules. Model download, local analysis recovery, provider polling and paid resubmission are different operations.

## Required acceptance evidence

- Real browser execution: finite nonempty embeddings, actual sample comparisons, loaded bytes, backend and timing; do not reproduce model-card scores as measured results.
- Independent same/different-speaker evaluation on suitable held-out meeting audio, including code switching, brief turns, similar voices, noise, overlap and speakers returning after many parts. Report incorrect merges and unresolved coverage separately.
- Bounded-memory behavior as part count grows, including persistence and reads beyond the current aggregate limits.
- Reload/cancel/model-download failure/quota failure/multiple-tab conflict recovery without repeated paid submissions.
- Unchanged source text and IDs, preserved original output and human names, correct citation invalidation and reversible attribution changes.
- Model/cache/checkpoint deletion, export/key exclusion, offline behavior after model availability, and draft-safe PWA updates.
- Chromium and WebKit automation, followed by physical iOS standalone and Android checks before claiming mobile acceptance.

Runtime proof alone is not feature completion or quality validation. An isolated probe is not an integrated user workflow.

### Initial browser runtime observation

An independent Chrome DevTools run of the isolated production preview loaded Transformers.js 4.3.2 and `Xenova/wavlm-base-plus-sv` revision `e61029603001bd11295c36d878698708bf59190f`, using q8 WASM with one thread. The ONNX model was 101,683,453 bytes; its local SHA-256 was `576bf6017796bdd179824d801b3a355a1dda2451559c6a398562175e33589f68`.

All four publisher example clips returned finite 512-dimensional embeddings. Observed same-speaker cosine scores were 0.960303 and 0.909882; one different-speaker comparison was 0.764879. The run took approximately 47.2 seconds, including loading, with individual clip operations taking approximately 5.9 to 8.8 seconds. These are observations from one desktop run, not calibrated accuracy or a performance benchmark.

Although model and sample audio were served locally, this initial build loaded the ONNX Runtime WASM and module from jsDelivr. It therefore does not prove self-contained or offline inference. Local runtime delivery, blocked-external-network testing, WebKit, worker responsiveness, physical phones and real meeting-audio quality remain separate checks. The earlier development-page attempt returned to its idle state and produced no completed result; it is not counted as a successful inference run or proof of model failure.

After runtime delivery was changed to local assets, an independent headless Chromium and WebKit run blocked every request outside the local static preview origin. Both completed with zero attempted external requests and zero page exceptions, returning the same four 512-dimensional embeddings and cosine comparisons above. Observed totals were approximately 16.1 seconds and 27.2 seconds respectively; varying load and cache conditions mean these runs do not establish a speed improvement. This proves browser execution with self-hosted assets. It does not prove offline app/model caching, an integrated Web Worker workflow, physical Safari behavior or meeting-level recognition quality.

## Primary references

- [Transformers.js browser runtime](https://huggingface.co/docs/transformers.js/en/index)
- [ONNX speaker-verification model and example samples](https://huggingface.co/Xenova/wavlm-base-plus-sv)
- [Microsoft model input requirements and threshold caveat](https://huggingface.co/microsoft/wavlm-base-plus-sv)
- [PWA offline and background execution limits](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation)

The separate [speaker profile evaluation plan](SPEAKER-PROFILE-EVALUATION.md) concerns cross-meeting named-person recognition and does not authorize that capability here.
