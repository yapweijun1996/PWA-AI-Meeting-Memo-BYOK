# Provider support matrix

Implementation selection: 2026-11-04. A supported response contract and a mocked integration do not establish live account access or audio accuracy.

| Role | Provider and endpoint | Authentication | Required output | Execution and recovery |
| --- | --- | --- | --- | --- |
| Speaker-aware transcription | Deepgram Nova-3, `POST https://api.deepgram.com/v1/listen`, `language=multi`, `diarize_model=v2`, utterances enabled | User-supplied Deepgram Key, `Authorization: Token` | Speaker-labeled timed words/utterances; preserve unknown labels | Foreground single bounded upload; no automatic retry or remote polling promise |
| Meeting memo | OpenAI Responses, `POST https://api.openai.com/v1/responses`, `gpt-6-luna` | Separate user-supplied OpenAI Key, Bearer authorization | Schema-validated memo items with explicit source IDs and unknown fields | Foreground, `store=false`, no tools or automatic retries |
| Offline review | Validated text/structured import | None | Text-only imports retain unknown timing; structured imports preserve evidence | Local IndexedDB with backup/restore |

Keys are kept only in page memory. Providers never receive each other's key. Uploading audio and generating a memo require separate, explicit confirmation. The software does not proxy traffic or use GitHub Actions to process meetings.

Speech limits are intentionally conservative application limits, not vendor claims. Unsupported or oversized recordings are rejected before transmission. Users can import an externally prepared transcript. A later chunking implementation must preserve container validity and speaker label scope; arbitrary byte slicing is forbidden.

Cost: show an optional user-entered speech rate per minute and mark the total unknown if that rate or duration is missing. OpenAI memo cost is unknown before actual usage/rates are established; never display an invented zero. Estimates are not billing caps.

Live release gates: production-origin authenticated CORS, paid authorized sample quality, actual costs, interrupted real requests, and physical devices. No valid-key paid evaluation is recorded. The user will enter keys in the finished website; development creates no key. Provider browser tests block workers and unhandled external requests while intercepting both selected endpoints.

Observed test support: Chromium and Linux WebKit exercise explicit confirmation, normalized speaker/time evidence, human correction, notes and backups using synthetic responses. Offline review, local IndexedDB, multi-tab conflict protection, and user-triggered worker updates run against real browser APIs. Physical iPhone/Android and vendor access remain unverified. Exact endpoint/account failures are surfaced without provider response bodies or credentials; ambiguous results never automatically retry.

Official sources checked during selection: [Deepgram pre-recorded API](https://developers.deepgram.com/docs/pre-recorded-audio), [diarization and versioning](https://developers.deepgram.com/docs/diarization), [multilingual support](https://developers.deepgram.com/docs/nova-3-language-prompting), [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).
