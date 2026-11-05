# Provider support matrix

Updated 2026-11-05 for the user's OpenAI-default/OpenRouter-optional decision. Deepgram is no longer a selectable endpoint; existing Deepgram runs and backups remain readable. These are documented request contracts and synthetic tests, not evidence of live access or quality.

| Role | Default | Optional | Output and limits |
| --- | --- | --- | --- |
| Transcription | OpenAI `/v1/audio/transcriptions`, `gpt-transcribe` | OpenRouter `/api/v1/audio/transcriptions`, `elevenlabs/scribe-v2`; configurable model ID | One original file up to 25 MB. OpenAI default provides text with no assumed speakers or timestamps. Scribe requests diarization and word timestamps. Missing metadata stays unknown. Model/format support varies. |
| Memo | OpenAI Responses `gpt-6-luna` | OpenRouter Responses `openai/gpt-6-luna`; configurable model ID | Selected model must support strict JSON schema. Generated content, citations, and refusal/incomplete results are validated before saving. |
| Local review | Text/structured transcript | Existing backed-up runs, including Deepgram | No key or network required. |

Both stages have independent provider/model selections and provider-specific memory-only keys. The default requires only an OpenAI key. A custom model ID is user supplied; the app does not guarantee compatibility or account access. OpenAI's `gpt-4o-transcribe-diarize` is selectable for temporary use but is deprecated and scheduled to stop on 2027-02-26. Do not interpret plain text as diarization or infer timestamps.

OpenRouter passes content to upstream providers. Its transcription routing options do not have the same control contract as text routing; actual upstream and retention depend on the selected service and account. For Responses, the app requests `allow_fallbacks: false`. The app itself never automatically resubmits a paid request. Timeouts, cancellation and broken connections remain possibly chargeable. The 25 MB cap applies before either upload; imported audio up to 50 MiB may remain stored locally and be played back. No arbitrary byte slicing or automatic remote upload is performed.

Provider costs and model availability vary; speech rate is an optional user-entered session estimate, not a cap. Memo cost remains unknown before actual usage. Keys never enter backups, logs, worker caches or build artifacts. Users explicitly confirm the recipient, model, data, and possible charge before each cloud operation.

Live release gates: valid-key production-origin CORS, account/model access, consented Chinese/English recordings, diarization accuracy, actual costs, interrupted real requests and physical devices. No development keys are created; the user tests the finished website. Synthetic tests only establish app orchestration.

Sources: [OpenAI file transcription](https://developers.openai.com/api/docs/guides/speech-to-text), [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations), [OpenRouter transcription](https://openrouter.ai/docs/guides/overview/multimodal/stt), [OpenRouter Scribe](https://openrouter.ai/blog/announcements/elevenlabs-on-openrouter/), [OpenRouter Responses](https://openrouter.ai/docs/api/reference/overview).
