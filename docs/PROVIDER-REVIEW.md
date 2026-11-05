# Five-perspective review of the provider change

Reviewed 2026-11-05 against the repository and current provider documentation. The user subsequently chose unencrypted local key persistence; the memory-only recommendation below is historical. These are role-based engineering reviews, not independent user interviews or a substitute for live provider tests.

| Perspective | Finding and resulting decision |
| --- | --- |
| Product and UX | Keep OpenAI as the default and select the speech and memo provider/model independently. Show destination, model, data, estimated or unknown cost, and missing speaker/time evidence before sending. |
| Speech and models | `gpt-transcribe` provides text without assumed speaker/timing evidence. OpenRouter Scribe v2 is an optional speaker-aware candidate; provider features differ, and the retired OpenAI diarization model is not a durable default. Limit each upload to 25 MB. |
| Privacy and security | Keep each provider's key in session memory; send it only to its fixed HTTPS endpoint. OpenRouter may relay content to upstream providers. Do not cache provider traffic, commit keys, or display provider error bodies. |
| PWA and recovery | Keep old Deepgram transcript runs and backups accessible; never interrupt active work with an automatic update. Preserve drafts, evidence, service-worker scope, and offline review across releases. |
| Tests and release | Cover default and optional routes, request confirmation, selected model/key isolation, no client resubmission, true versus missing timestamps, old data, and browser upgrade. Synthetic mocks cannot prove live CORS, accuracy, billing, or physical-device behavior. |

The user will enter their own keys and perform real API acceptance on the published GitHub Pages app. No development provider key is created. Current implementation limitations and links to source documentation are in [PROVIDERS.md](PROVIDERS.md).
