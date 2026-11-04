# Feasibility and evidence

Research date: 2026-11-04. Official documentation describes available contracts; it does not establish this project's integration, account access, accuracy, or performance. No paid API request, real-recording evaluation, or physical-device test was performed. Implementation tests now exercise actual Chromium/WebKit UI and IndexedDB with mocked providers; see [validation](VALIDATION.md).

## Decision

A browser-first, static-hosted BYOK meeting memo application is feasible and implemented as a browser beta. Deepgram Nova-3 multilingual with diarizer v2 is the selected speech adapter; OpenAI Responses with GPT-6 Luna generates notes. The remaining release-critical uncertainty is live production-origin access and usable speaker/time output for real Chinese/English meetings. Keep a companion optional and verify that integration before claiming the full P0 acceptance criteria.

## Implemented compatibility boundary

Automated workflows pass in Playwright Chromium and Linux WebKit on Ubuntu ARM64. This verifies UI, local transactions, request orchestration with mocks, and PWA lifecycle; it does not certify physical iOS/Android, a vendor account, or model accuracy. WebKit required encoded audio bytes rather than directly persisting a File/Blob; the repository now reconstructs playback Blobs from atomically stored bytes.

The selected speech route uses one foreground upload of the original container, capped at 50 MB. It has no application-level chunking or remote polling contract. A nine-minute local timeout or cancellation leaves an ambiguous request possibly charged, and never schedules another submission. Cross-chunk mapping is N/A for this implementation. The 50 MB bound is a conservative rejection rule, not a measured phone capacity. Unknown memo/speech rates remain unknown; reported usage is not an invoice. See [provider support](PROVIDERS.md) and [validation](VALIDATION.md).

## Hosting and browser findings

| Finding | Evidence | Design consequence |
| --- | --- | --- |
| Pages serves static HTML/CSS/JS | [GitHub Pages overview](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) | No Python worker, secret vault, API proxy, webhook receiver, or durable application queue on Pages |
| Build paths must match the repository subdirectory | [Vite static deployment](https://vite.dev/guide/static-deploy.html) | Use `/PWA-AI-Meeting-Memo-BYOK/`; test production assets and installed launch |
| Provider authorization can trigger a CORS preflight | [MDN CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS) | Verify exact endpoints, headers, methods, and response visibility in the real browser; `no-cors` cannot make an unreadable response usable |
| Browser storage is origin-based | [MDN same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy) | Sibling Pages projects on the same owner hostname share a storage trust boundary; namespacing avoids collisions but does not isolate access |
| Storage is best-effort by default and can hit quota | [MDN storage quotas](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) | Local drafts need quota handling and user-controlled backups; persistence permission is not a backup |
| Background workers can be stopped | [MDN offline/background operation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation) | Checkpoint foreground work; do not promise processing through tab closure or phone suspension |
| AudioBuffer stores samples as 32-bit floats | [MDN AudioBuffer](https://developer.mozilla.org/en-US/docs/Web/API/AudioBuffer) | Compressed input size understates decoded-memory demand |
| ffmpeg.wasm documents substantial performance/resource limitations | [Project FAQ](https://ffmpegwasm.netlify.app/docs/faq/) | Conversion is a measured optional path, not a guarantee that every long mobile recording will work |
| SharedArrayBuffer-style execution requires cross-origin isolation | [MDN crossOriginIsolated](https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated) | Do not assume the necessary response headers exist on the deployed host |
| Screen-capture audio availability varies | [MDN getDisplayMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia) | Start with uploaded recordings; microphone capture does not establish capture of remote participants |

Memory calculation, not a benchmark: one hour decoded at 48 kHz, stereo, float32 requires `3600 × 48000 × 2 × 4 = 1,382,400,000` bytes (about 1.29 GiB) for samples alone. One hour of 16 kHz mono PCM16 is about 115.2 MB before container overhead. Neither is an acceptable default full-file allocation on mobile.

## Speech provider routes

| Route | Documentation evidence | Remaining gate |
| --- | --- | --- |
| OpenAI current file transcription | `gpt-transcribe` is the recommended file route; text and detected-language output are documented | Do not assume speaker labels or word timestamps; verify a separate evidence path |
| OpenAI legacy combined diarization | `gpt-4o-transcribe-diarize` returns speaker/time segments; announced shutdown 2027-02-26 | Transitional comparison only, not the long-term sole dependency |
| Integrated cloud speech candidate | Deepgram documents multilingual Nova-3 and diarization with per-word speaker/time output | Verify production-origin CORS, Chinese/English quality, pricing, retention, and account access |
| Local pyannote | Local diarization is available after model setup | Optional future extension; does not run as Python inside a static PWA |
| Imported transcript | Product can accept structured evidence or plain text | Validate input; plain text does not establish audio timing or automatic speaker capability |

Sources: [OpenAI transcription overview](https://developers.openai.com/api/docs/guides/transcription), [OpenAI file transcription](https://developers.openai.com/api/docs/guides/speech-to-text), [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations), [Deepgram language prompting](https://developers.deepgram.com/docs/nova-3-language-prompting), [Deepgram diarization](https://developers.deepgram.com/docs/diarization), [pyannote model card](https://huggingface.co/pyannote/speaker-diarization-community-1).

The file guide currently specifies an OpenAI upload limit of 25 MB. Limits are provider-specific and must be rechecked at implementation. Do not split all providers' inputs simply because one provider has that limit.

Recommendation: evaluate one integrated cloud speech candidate and OpenAI memo generation first. Keep speech and memo key fields separate. If only a single OpenAI key is acceptable, the durable speaker/time route remains unresolved; do not silently remove diarization or force a companion.

## Why alignment remains an independent problem

Text transcription plus diarization intervals does not identify which words belong to which intervals. Validate native timestamps, a real aligner, or turn-based transcription. Do not synthesize timestamps by asking a text model or spreading words evenly.

WhisperX demonstrates an alignment/diarization pipeline, but its maintainers note language-specific alignment, unaligned dictionary items, and overlap limitations. It is prior art for an experiment, not evidence that mixed-language alignment already works in this browser application. [WhisperX repository](https://github.com/m-bain/whisperX)

## BYOK, retry, and content correctness

The OpenAI JS SDK disables browser use by default because browser code exposes credentials; it also retries certain errors twice by default. Runtime user-supplied credentials are an intentional product choice, and paid submissions must disable automatic SDK retries. Explicit recovery policy belongs to the app. [OpenAI SDK documentation](https://developers.openai.com/api/reference/typescript)

Build-time frontend environment variables are public bundle input. They cannot hide a provider secret merely because the value came from an Actions secret. [Vite environment variables](https://vite.dev/guide/env-and-mode.html)

Structured Outputs constrains structure; it can still contain content mistakes. Validate source references and keep human review. [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

Provider data retention depends on the endpoint, feature, and account configuration. Local deletion or disabling response storage cannot justify a universal zero-retention claim. Review speech and memo endpoints separately before exposing a provider. [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data)

## Cost basis

The current OpenAI price page lists file transcription at US$0.0045/minute and live transcription at US$0.017/minute. Calculated 60-minute examples are US$0.27 and US$1.02 respectively. These examples exclude speaker processing, alignment, memo stages, retries, and any other provider. [OpenAI pricing](https://developers.openai.com/api/docs/pricing)

Store the rate date, unit, stage, and estimated quantity. Unknown rates stay unknown rather than zero. Record a provider's actual usage when available; an interrupted request can remain possibly charged.

## Unresolved decisions and evidence required

| Question | Current state | Required evidence |
| --- | --- | --- |
| Which speech provider meets the full P0 contract? | Deepgram adapter selected and mock-tested; live acceptance open | Production-origin browser test with a consented recording and normalized evidence |
| Does mixed Chinese/English preserve voice identity? | Unknown | Manually labeled samples with code switching, short responses, noise, and overlap |
| What formats and duration are reliable on phones? | Unknown | Real Safari/iOS standalone and Android runs; memory, quota, and recovery observations |
| Can async jobs be recovered directly? | N/A for the selected synchronous route; ambiguous submissions require account review | A later asynchronous provider must establish status/result access before adding polling |
| What is the usable local audio ceiling? | Unknown | Bounded-memory measurements and graceful rejection under pressure |
| Is a dedicated hostname available? | Not selected | Hosting decision before storing sensitive production meetings on a shared origin |
| Can an app be deployed now? | A runnable scaffold, locked dependencies, build and browser checks exist | Authorized Actions publication and served-build verification |

No accuracy percentage or wall-clock performance is established by this research. Suggested usability targets and test cases are in [the roadmap](ROADMAP.md).

## Research boundary

The initial read-only GitHub API inspection confirmed workflow-based Pages configuration, HTTPS enforcement, its configured address, and zero Actions workflows. It did not establish a working site. That historical inspection changed no settings or services; later implementation and publication evidence is recorded separately in [validation](VALIDATION.md).

KB-MCP prior art informed PWA lifecycle and mobile acceptance requirements. Historical success in another app does not certify this app. The older companion-first architecture is superseded for the default path by the user's browser-first direction; its speaker-review and evidence requirements remain relevant.
