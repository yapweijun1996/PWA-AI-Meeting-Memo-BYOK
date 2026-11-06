# Optional capability evaluation

Decision date: 2026-11-06. These are design evaluations, not implemented feature claims. Preserve static hosting, runtime BYOK, explicit sends, original evidence and local recovery. No automatic external messages, platform joining, server installation or new infrastructure is introduced.

## B01 — microphone capture

Recommendation: a later local-first MediaRecorder flow with visible start/pause/stop, permission-denial handling and a playable locally saved result before cloud confirmation. Probe MIME support with `isTypeSupported`, then verify actual recorded files on iOS and Android; a capability boolean does not certify a long recording. Save bounded recording data progressively, retain a stop/failure recovery state, and stop all tracks when leaving. Microphone access does not establish capture of remote meeting participants. Document source and consent.

Start after core phone/storage acceptance, with measured formats and recording limits. Existing upload remains the fallback. B01 stays unchecked until recording and interruption recovery actually work. [MediaRecorder reference](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder).

## B02 — waveform, ERP templates, glossary and engines

Split these into independent deliveries. A waveform needs bounded peak extraction and its own cancellable worker; never decode the whole long recording for decoration. Peaks are presentation data and do not create timestamps. ERP templates should shape reviewable output categories, never invent business rules. The existing glossary is input context; changes need source/version invalidation where relevant. Additional engines need a capability, retention, pricing, browser CORS and quality evaluation before being labeled supported. No engine silently replaces the selected provider.

Start each feature only with measured benefit and focused regression evidence. B02 remains an implementation backlog, not complete because these options were assessed.

## B03 — optional encrypted backups

Recommendation: a separate opt-in encrypted download/restore format, leaving the user's deliberately unencrypted browser key storage unchanged. Use authenticated encryption, versioned public metadata, random salt and unique nonce, a password-derived key and authenticated format parameters. Exclude provider keys before encryption. Reject wrong passwords, altered ciphertext, invalid parameters and oversized decompressed data without overwriting meetings. Decrypt and validate before creating a separate restored copy.

Threat boundary: protects a downloaded archive at rest; does not protect against the running origin's scripts, an unlocked browser or a compromised device. A forgotten password is unrecoverable unless the user separately retains it; no server recovery service is proposed. Avoid whole-archive encryption allocations on phones until bounded memory is measured. Password derivation cost, archive streaming and format parameters require a measured prototype and security review before implementation; they are deliberately not a production cryptographic specification.

Decision: technically plausible, deferred pending those tests. Evaluation complete; encryption is not shipped. [Web Crypto authenticated encryption and memory limits](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt).

## B04 — local inference or optional companion

Browser inference keeps the default architecture but requires locally vendored runtime/model provenance, model-download consent, storage/CPU/memory/thermal measurements, and verified speaker/time output. Do not assume GPU support or cross-origin-isolated multithreaded WASM on Pages. A basic local model that only returns text fails the speaker-aware requirement.

A companion can offer larger models, durable jobs and container-aware processing, but adds installation, upgrades, authentication and a separate local data boundary. Any future prototype must bind only intended interfaces, authenticate the app, validate origins and file access, report exact data destinations and survive version mismatch. An unavailable companion must not break the normal browser workflow. Existing BYOK keys are not automatically passed to it.

Decision: do not add either to the current runtime. Compare real device measurements and independent quality/correction time in a separate spike before selection. Evaluation complete; no local model or companion is shipped.

## B05 — live transcription, platform audio, collaboration and synchronization

Treat these as four different products. Live transcription needs partial/final evidence, stable revisions, latency measurement, reconnect boundaries and per-session billing controls; partial output cannot become final memo evidence silently. Platform audio capture needs explicit browser/platform permission and source disclosure. Screen sharing can return no audio track despite an audio hint; microphone permission cannot substitute for platform capture. [Screen-capture audio constraints](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia).

Collaboration needs users, authorization, meeting membership, audit, conflict handling and shared evidence ownership. Cross-device sync additionally needs encrypted transport, deletion/restore policy, server storage/retention and migration out of origin-local IndexedDB. Never synchronize provider keys by default. Static Pages alone does not provide these application services; adding them requires a separately authorized backend scope, not an implicit extension of deployment permission.

Decision: defer all four. Future specifications must select target platform, identity/security boundary, conflict rules and paid-session limits before implementation. Evaluation complete; none of these capabilities is shipped.
