# Speaker model and provider selection record

Status: evidence record, 2026-11-10. **No model change is decided.** The shipped candidate remains `Xenova/wavlm-base-plus-sv` (see [ACOUSTIC-SPEAKER-CONTINUITY.md](ACOUSTIC-SPEAKER-CONTINUITY.md)). This file separates what was checked against a primary source in this session from what was only reported to us. Re-verify before relying on any row; versions, terms and prices change.

## Licence evidence correction — 2026-11-16

The earlier investigation's blanket statement that the upstream model has no declared terms is incomplete. Its metadata still has no `license` field and no separate LICENSE file, but the [Microsoft model card at revision `feb593a6c23c1cc3d9510425c29b0a14d2b07b1e`](https://huggingface.co/microsoft/wavlm-base-plus-sv/blob/feb593a6c23c1cc3d9510425c29b0a14d2b07b1e/README.md) explicitly links its licence section to UniSpeech. The [linked licence at commit `8f8cbd22d352fc59dfd5bf19de979b05bb5c7938`](https://github.com/microsoft/UniSpeech/blob/8f8cbd22d352fc59dfd5bf19de979b05bb5c7938/LICENSE) is **CC BY-SA 3.0 Unported**. This is newly verified evidence, not a claim that the licence changed recently.

The [ONNX conversion card at the application's pinned revision `e61029603001bd11295c36d878698708bf59190f`](https://huggingface.co/Xenova/wavlm-base-plus-sv/blob/e61029603001bd11295c36d878698708bf59190f/README.md) identifies that Microsoft model as its base, but has no separate licence declaration or LICENSE file in the checked repository metadata/file list. That establishes a stated provenance link; it does not independently verify the converter's notices or every term applying to the quantized derivative. The [licensor's deed](https://creativecommons.org/licenses/by-sa/3.0/) describes attribution, licence-link and adaptation/share-alike conditions. Using the model alone does not establish a change to this application's code licence.

Current disposition: upstream licence identified; ONNX attribution/derivation compliance and current consent text still require reconciliation before treating REL03 as closed. This task does not publish or replace weights. Runtime-download route B, labelled quality evaluation and device/download recovery remain separate acceptance gates. The dated 2026-11-10 findings below are historical and are superseded by this correction for the licence question. Missing API metadata alone is not evidence that no licence statement exists.

## Two different metrics

| Need in this app | Metric | Why |
| --- | --- | --- |
| Is this clip the same voice as that clip (link labels across parts or within a part) | EER, plus the rate of wrong merges at the chosen threshold | Verification between pairs |
| Who spoke when in a whole recording (a local fallback when provider labels are missing or wrong) | DER | Segmentation plus assignment |

Published numbers use celebrity or benchmark audio. None is a statement about this app's recordings (code switching, overlap, noise, brief turns). The decision metric is the one measured on our own labelled meeting audio.

## Verified against primary sources (2026-11-10)

| Item | Finding | Source |
| --- | --- | --- |
| `microsoft/wavlm-base-plus-sv` | Fine-tuned on VoxCeleb1 with an X-Vector head. Model card states no EER. Its example cosine threshold 0.86 is marked dataset-dependent. | Hugging Face model card |
| WavLM licence metadata | Both repositories omit the metadata licence field. The 2026-11-16 correction above additionally verifies the upstream model-card link to CC BY-SA 3.0; metadata absence alone was insufficient. | Hugging Face model API and revisioned model card above |
| pyannote community-1 | CC-BY-4.0, gated (login and accepted conditions), `pip install pyannote.audio`, CPU by default. No ONNX or browser support stated. Provides exclusive speaker diarization output. | Hugging Face model card |
| pyannote DER (no collar, overlap counted) | AISHELL-4 12.2 / 11.7 / 11.4; AliMeeting 24.5 / 20.3 / 15.2; AMI-IHM 18.8 / 17.0 / 12.9; VoxConverse 11.2 / 11.2 / 8.5 (3.1 / community-1 / precision-2). Precision-2 is a hosted commercial service (pyannoteAI key). | Same model card |
| WeSpeaker pretrained models | Weights follow the licence of their training dataset; the page's VoxCeleb example is CC BY 4.0 (applying it to a given model is an inference). Commercial use is not addressed. | WeSpeaker pretrained-model page |
| sherpa-onnx | README lists WebAssembly support; a browser speaker-diarization demo exists. | k2-fsa README and demo Space |
| OpenAI diarization | `gpt-4o-transcribe-diarize` is deprecated and shuts down **2027-02-26**. Up to four reference clips (2 to 10 s) may name known speakers. Files up to 25 MB. `gpt-transcribe` has no speaker labels. | OpenAI speech-to-text guide |
| ElevenLabs speech-to-text | Upload under 5.0 GB (another source says 3 GB; unresolved). `diarize` supports up to 32 speakers. `use_speaker_library` matches against a workspace library. Browser use is described via a single-use token; CORS is not documented. | ElevenLabs API reference |

- Repository record, not re-run here: [IMPLEMENTATION-LOG.md](IMPLEMENTATION-LOG.md) ("Speaker-count finding") reports an offline sherpa-onnx experiment (pyannote 3.0 segmentation plus WeSpeaker ResNet34) that found 4 voices above one minute on a 48.5-minute test recording, with no ground truth. It supports trying that route in a browser evaluation; it is not a browser result.

## Historical WavLM weight licence investigation (2026-11-10)

Question: may this repository, or its GitHub Pages site, redistribute `Xenova/wavlm-base-plus-sv` (about 101.7 MB)? This is a record of evidence, not legal advice.

Checked against primary sources:

- Historical metadata-only observation: the checked Microsoft repositories had no `license` field/tag or standalone LICENSE file; the Xenova conversion also omitted a separate declaration. This check missed the upstream model card's explicit licence link and was not sufficient to infer absence of terms. The revisioned 2026-11-16 evidence above supersedes that inference.
- The WavLM code lives in `microsoft/unilm`, whose root `LICENSE` is the MIT License (Copyright Microsoft Corporation). The WavLM README says the project is licensed under that file, links the pretrained checkpoints (Azure and Google Drive) and states **no separate terms for them**. Whether the MIT grant covers the checkpoints is an inference, not a statement.
- Training data (from the model card): pretraining on Libri-Light, GigaSpeech and VoxPopuli; fine-tuning of this speaker-verification model on VoxCeleb1. The VoxCeleb1 page states no licence or commercial terms (audio is released through a request form). The GigaSpeech repository lists Apache-2.0 for its code but states no dataset licence (access by form). The pages checked do not say whether models trained on these sets carry restrictions.
- Runtime packages, from the installed `package.json` files: `onnxruntime-web` is MIT and `@huggingface/transformers` is Apache-2.0. Both permit redistribution with their notices; the app does not yet ship those notices.

**Historical conclusion, superseded for upstream evidence:** this investigation had not identified public weight terms. The 2026-11-16 correction above identifies the upstream CC BY-SA 3.0 link; ONNX notices/derivation compliance remains to reconcile.

| Route | What changes | Open points |
| --- | --- | --- |
| A. Ask the publisher | Request an explicit written licence statement for the checkpoints (issue on the Hugging Face repository or `microsoft/unilm`) | External, no date; the answer may restrict use |
| B. Do not host the weights | Each user's browser downloads them from Hugging Face at the pinned revision after consent, SHA-256 verified before use, cached in an app-scoped cache | Code change (host allowlist, verify-before-use, disclosure that the host sees the download request); CORS, offline and cache behaviour untested; terms become the user's and the host's |
| C. Different model | Use weights with an explicit redistributable licence | Each candidate's weight and training-data terms must be verified, then evaluated on meeting audio (criteria above) |
| D. Keep it local | The Pages demo ships without voice matching (current behaviour); voice matching runs only where a developer prepares assets locally | No public demo of the feature |

Suggested order: keep D now, design B for the demo (smallest change, no dependency on a third-party reply), pursue A in parallel, and fold C into the planned labelled evaluation.

## Reported to us, not verified

- The EER table (3D-Speaker ERes2Net-large 0.52, ERes2NetV2 0.61, CAM++ 0.65, WeSpeaker r-vector 0.447, SpeechBrain ECAPA 0.80). Test sets differ (Vox1-O, Vox1-O-clean, cleaned), so the rows are not strictly comparable.
- The licence and maintenance table (3D-Speaker, pyannote.audio, SpeechBrain, WeSpeaker, NeMo, diart). A code licence is not the weight licence.
- Browser download size of sherpa-onnx with CAM++ (about 29 MB) and the pyannote segmentation model (about 6 MB). File sizes came from mirrors; the WebAssembly runtime size and total load time are unknown. One source gives CAM++ as 192-dimensional and another as 512-dimensional.

## Selection criteria, in order

1. **Weights may be redistributed with a static site**, with attribution and terms we can honour. This is a gate, not a score. Upstream WavLM terms are now identified; the pinned ONNX derivative's notices/derivation compliance is not yet reconciled, and this delivery keeps runtime-download route B.
2. Runs in a browser worker from the GitHub Pages base path, offline after first use, with pinned hashes.
3. Size and load time acceptable on a phone (iOS standalone and Android are separate acceptance checks).
4. Error rates measured on our own labelled meeting audio: wrong merges, missed merges and unresolved share, reported separately; DER if the model also segments.
5. Privacy: no audio, vector or key leaves the browser unless the owner approves a named recipient. A hosted API is a separate decision with disclosure; a cross-meeting speaker library is a voiceprint store and is not default.
6. Maintenance: current release and an owner willing to update the pinned revision.

## Candidate routes

| Route | For | Against / unknowns |
| --- | --- | --- |
| Keep WavLM (current) | Already integrated and tested with fake vectors; in-browser. Upstream card links CC BY-SA 3.0. | ONNX notices/derivation compliance outstanding; about 100 MB; app matching quality unmeasured; threshold uncalibrated. |
| sherpa-onnx (CAM++ or WeSpeaker, plus segmentation) in WebAssembly | Smaller models; includes segmentation, which would give a local diarization fallback. | Not integrated or tested here; weight licences, total download and worker behaviour unverified; its DER is not pyannote community-1's. |
| pyannote community-1 on a server | Best published open DER here; whole-file labels are globally consistent. | Needs a server (a backend fallback needs owner approval for infrastructure and spend); gated access; not browser-first. |
| Hosted diarization (ElevenLabs, OpenAI) | No local model. | Audio leaves the device; per-request charges; OpenAI route is deprecated; speaker libraries are cross-meeting voiceprints; browser CORS unverified. |

## Open items before any decision

- Decide the WavLM weight licence route (see the investigation above): ask the publisher, download from the host at run time, or choose a model with an explicit, redistributable licence.
- Build a small labelled evaluation (same/different pairs and, for segmentation, reference speaker turns) from a real recording, then compare candidates by the criteria above.
- Verify the sherpa-onnx browser build: licences, total download, load time, memory, worker, GitHub Pages path, offline reload.
- Decide whether a cross-meeting identity feature is wanted. If so, it needs explicit consent, local storage controls, deletion and no real-world naming.
