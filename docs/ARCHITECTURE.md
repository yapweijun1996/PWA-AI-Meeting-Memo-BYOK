# Browser architecture

Status: browser implementation exists, 2026-11-04. The contracts below include original design intent; this implementation uses a versioned meeting aggregate plus a separate audio store. Read [feasibility](FEASIBILITY.md) for evidence and unresolved provider support.

## Execution and ownership

GitHub Pages serves only the static app shell and bundled assets. The browser owns local meeting state, calls explicitly selected providers, and stores returned results. GitHub Actions builds and deploys assets; it never processes a user's recording or supplies their provider credential.

```mermaid
flowchart LR
    R[Repository] --> C[Actions: checks and build]
    C --> H[GitHub Pages: static assets]
    H --> U[Browser UI]
    U <--> D[IndexedDB: meetings, audio, revisions, jobs]
    U --> W[Web Worker: bounded local processing]
    U --> K[Local settings database: unencrypted keys]
    U --> P[Explicitly selected cloud provider]
    P --> U
    U --> E[User-requested export]
    S[Service Worker: app shell only] --> U
```

Keep source recordings and meeting data out of Pages artifacts, Git, telemetry, and service-worker response caches. Storing user-approved meeting data in IndexedDB is a deliberate product function; it is different from indiscriminately caching network responses.

## Stack and modules

The implementation uses React/TypeScript/Vite, npm with a locked dependency tree, Zod validation, idb repositories, and a custom prompt-based app-shell worker. No application server is required. The original feature folders below map to the current `src/features/*.tsx` screens; domain, storage, providers, jobs, audio and PWA responsibilities are separate modules.

| Proposed module | Responsibility |
| --- | --- |
| `src/features/meetings/` | Library, metadata, import, deletion |
| `src/features/review/` | Speaker/transcript corrections and undo |
| `src/features/memo/` | Versioned memo generation and review |
| `src/domain/` | IDs, schema validation, provenance, revisions, stale rules |
| `src/storage/` | IndexedDB transactions, migrations, backup/restore |
| `src/providers/` | Explicit provider contracts, normalization, cost and errors |
| `src/jobs/` | Foreground scheduler, checkpoints, billing uncertainty |
| `src/audio/` | Original-file limits/metadata and bounded checksum worker; no decode/encode pipeline shipped |
| `src/pwa/` | Install, connectivity, worker update UX |

Prefer two small initial integrations over a universal plugin framework: one browser-validated speech provider and one memo provider. The speech integration must prove speaker/time capability before release. The same provider can serve both roles only when its contracts support them.

## Provider boundary

Record capabilities per model/endpoint rather than treating every transcription service as interchangeable:

- Accepted containers/codecs and request size/duration limits.
- Text, turn/word timestamps, anonymous speakers, overlap, and channel support.
- Language hints and domain terminology support.
- Synchronous/streamed versus durable asynchronous job behavior.
- Request IDs, polling, cancellation, idempotency, rate limits, and pricing basis.
- Browser CORS and response-header visibility verified for the exact production origin.

Normalize output into internal evidence records while retaining the provider/model/configuration and sanitized original payload. Missing timestamps stay `null`; never distribute text uniformly over time or ask the memo model to invent alignment. A browser CORS failure disables that integration; it does not trigger an undisclosed proxy.

Support importing an evidence-bearing transcript as a separate route. A text-only import remains text-only until a real mapping is supplied.

## Data contract

Use UUIDs, explicit schema/source/storage versions, finite second-based audio times, and validated imports. `src/domain/model.ts` is the authoritative shipped schema; the record table below explains logical responsibilities rather than separate database tables.

| Record | Core fields and invariants |
| --- | --- |
| `Meeting` | `id`, title, date, timezone, languages, template, `revision`, `schemaVersion` |
| `AudioAsset` | `id`, meeting ID, filename, MIME/codec, bytes, duration, content hash, channel metadata, persistence state |
| `ProviderRun` | `id`, provider, model, capability snapshot, sanitized configuration, audio hash, chunk ID, original result, timestamps; no key |
| `Speaker` | `id`, meeting ID, display name, identity state, source labels scoped by run/chunk |
| `SegmentRevision` | stable segment ID, revision, audio ID, nullable start/end, speaker IDs, original/edited text, timing origin, assignment/review state, parent revision refs |
| `ReviewOperation` | operation ID, affected revisions, before/after refs, undo state; committed with the change |
| `MemoVersion` | version ID, meeting/source revision, model, separate `originalItems` snapshot and editable `items`; older backups may lack the snapshot |
| `MemoItem` | item ID/type/text, nullable owner/date, original date wording, source `(segmentId, revision)` refs, review state |
| `ProcessingJob` | job/chunk IDs, stage, state, provider run, attempts, input hash, sanitized request ID, estimate, billing state, checkpoint |

Original provider results are immutable. Current transcript views project those results plus human revisions. Splitting or merging preserves lineage, so an old citation can still resolve to its original revision while being visibly stale.

Each new memo version clones the normalized generated items into `originalItems` before human review. Text/owner/date/review edits change only `items`; JSON and full backups retain both. The UI exposes the original text and fields. Existing v1 backups without originals remain readable and explicitly report that the original was not saved; it cannot be inferred from corrected text. The field is optional for old-backup compatibility. Older app builds may reject new optional fields, so update open tabs before editing newly created memo data; a refused old-client read must never trigger deletion or a lossy rewrite.

Start with a conservative invalidation rule: text, assignment, speaker identity, date, or timezone changes increment the meeting source revision and mark generated memo items for re-review. More selective invalidation can follow with tests. New generations never overwrite an accepted human version.

Memo review actions commit the displayed text, owner, due date, review state and reviewed source revision together. An item-scoped interaction guard suppresses competing blur saves until that review commit finishes; repository version checks remain authoritative for real stale-tab conflicts. Mouse focus prevention and touch default-click behavior differ. Touch interaction completion at Window/null must not be confused with explicit cancellation or departure to another element. Generated originals are never changed by a review commit.

Source IDs establish traceability, not semantic correctness. Independently validate that references exist, belong to the meeting, and use the expected revisions; users still review whether a claim follows from them.

## Storage and transaction rules

IndexedDB is the P0 source of truth. Structured records are stored as one versioned meeting aggregate, while encoded audio bytes and media type are stored separately by meeting ID. File-to-buffer conversion happens before database transactions, avoiding a reproduced WebKit File/Blob persistence failure. Playback reconstructs a Blob. One original audio hash is retained per meeting; rebinding a different recording is rejected. Keep provider responses outside Cache Storage. Add OPFS only if measurements justify its extra coordination and recovery costs.

- Save a completed chunk and its job checkpoint in one transaction before scheduling the next chunk.
- Save an edit and its undo operation together. Use expected revisions and a writer lease to prevent stale multi-tab writes.
- Perform network, hashing, and audio work outside live IndexedDB transactions. Use short database-only transactions and test them in actual Chromium/WebKit.
- Check estimated usage and request persistent storage where supported. Handle denial and quota failure without silently deleting existing meetings.
- Imported files have resource bounds, schema validation, collision handling, and a preview before replacing data. Imported credentials are rejected.
- Backup/restore includes schema version, manifest, audio references/hashes, revisions, and jobs. Mark absent audio explicitly.
- Namespace storage and remove only this application's named records/caches. A repository path is not a security boundary; see [deployment](DEPLOYMENT.md).

Future asynchronous file storage would need explicit pending/ready states and orphan cleanup because IndexedDB and file storage cannot share one atomic transaction.

## Foreground job and billing state

Use a small foreground scheduler with bounded concurrency and Web Locks where available, plus a transactional lease fallback for supported browsers. Locks protect local scheduling; they cannot prevent provider-side duplicate charging.

Persist intent before initiating a request. Distinguish these states:

```text
queued -> preparing -> ready_to_send -> in_flight -> completed
                           |              |
                           |              +-> outcome_unknown
                           +-> failed_before_send
queued/ready_to_send -> paused
in_flight -> cancel_requested -> cancelled_or_unknown
```

After a crash, an `in_flight` checkpoint becomes `outcome_unknown`, including the window between actual submission and local acknowledgement. A provider's durable job ID allows polling the same job. If no such ID was recorded, do not assume the request never ran.

Billing state is separate: `not_submitted`, `possibly_charged`, `provider_reported`, or `unknown`. Local cancellation stops waiting/scheduling but does not prove remote processing or billing stopped.

Disable SDK automatic retries for paid submissions, then implement explicit error policy. Safe status polling can retry with bounded backoff. A documented refusal before execution can be offered for retry; ambiguous timeouts/disconnects need user review. Do not treat a client-generated idempotency key as provider-supported exactly-once execution.

Saved keys and settings are restored from the separate local settings database before the app renders. Re-entry is needed after the first upgrade from a memory-only build or after forgetting/clearing site data. File re-selection remains a recovery state, not a lost-work error. Partial streamed text stays provisional until final completion and validation; never mark it complete after a broken stream.

## Audio handling

Keep encoded source audio for playback with object URLs and revoke URLs on release. Do not decode an entire long recording merely to show duration or draw a waveform.

### Playback synchronization boundary

The owner-approved playback redesign uses the existing persistent audio element as the media clock, with one shared snapshot for position and playback status. Presentation can read that snapshot frequently without advancing time independently or writing meeting revisions. `currentTime` also represents the selected position while paused; a matching source interval is attribution at that position, not proof of active speech. Media events remain important for seek, pause, rate, buffering, end and error transitions. See the browser contracts for [currentTime](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentTime) and [timeupdate](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/timeupdate_event).

`src/features/usePlaybackClock.ts` owns the media-event snapshot, including sticky buffering state and a synchronous `refresh()` after an explicit application seek. The latter reads the actual media position before a controlled range input can restore an old value between rapid keyboard steps; it does not predict the requested time. `src/domain/playback.ts` owns read-only caption grouping, exact source-interval matching and the nearest-time view anchor. `SpeakerReview` presents Playback/Edit Speakers modes, while `MeetingWorkspace` retains the persistent audio element, cue boundaries and video exclusion token.

Caption grouping and active-speaker/transcript projection belong to the read layer. The authoritative evidence stays in original segment IDs, revisions, text, speaker arrays and nullable time ranges. Group envelopes must not turn an internal gap into attributed speech. Overlapping source intervals may produce several active speakers and caption rows. Unknown timing never receives an interpolated range.

Playback following is view state, separate from memo-citation selection and correction state. Manual transcript browsing pauses following; resuming follow does not move keyboard focus. Bounded rendering must preserve navigation to every group and the existing source-inspection/editing paths. Player controls, sample cues, evidence cues and reference-video mutual exclusion retain a single audio owner. Photos or reference metadata, if added later, remain presentation metadata and must not enter provider prompts implicitly.

The beta stores one original recording up to 50 MiB, uploads up to 25 MB per transcription request, and computes its checksum in a worker; conversion and multi-chunk transcription are deferred. Valid future chunking requires container-aware processing or bounded decode/re-encode. `Blob.slice()` over arbitrary MP3/M4A/WebM bytes is not an independent playable file. Preserve source offsets, encoder delay where relevant, and boundary provenance. Handle overlapping transcription windows with a documented boundary reconciliation algorithm; text similarity alone must not delete genuinely repeated speech.

Prefer one provider request for the whole recording when its verified limits permit it, preserving global speaker clustering. Otherwise scope labels by run/chunk and require evidence-based mapping. Preserve isolated channels before any downmix; multiple people can still share one channel.

Use a single-thread browser processing fallback. WASM, WebCodecs, and supported codecs require device-specific verification; do not make cross-origin-isolated multithreaded WASM a baseline requirement on Pages. Limit work, offer cancellation, and explain unsupported large inputs.

## Memo generation

Send the reviewed transcript and only needed metadata. Treat transcript content as data, including any embedded instructions. The memo generator has no tools that send messages, write ERP records, or follow links.

Generation instructions request independently checkable claims whose numbers, conditions, entities and qualifiers are completely supported by their selected passages. Claims that need different evidence must be split; unsupported details must be omitted, and uncertainty must come from the transcript. These are generation instructions, not a semantic proof: actual model output can still cite incomplete evidence. Keep new items pending and compare every clause with the selected source text before accepting it. Human corrections change editable items while retaining generated originals.

Validate structured responses, handle refusal and truncation, and require nullable unknown fields. `src/providers/memo-input.ts` owns the 80,000-character serialized input limit used by both job preflight and the provider request. Inputs that already fit retain their original segment IDs. Larger inputs group consecutive segments only when their ordered speaker assignments match, with at most 20 original segments per transport group. The builder retains all text and a request-local map from compact IDs to original IDs and revisions; it does not modify stored segments, timestamps, speakers, history or normalized runs. A compact response may cite at most five groups per item, which are expanded, revision-validated and deduplicated before persistence within the existing 100-source limit. Unknown groups or invalid references reject the result. Compact IDs are never persisted as evidence references.

Compact group text is an ordered array of the original fragments, preserving each fragment's exact content and boundaries without claiming what whitespace belongs between them. Speaker entries use zero-based indices into the accompanying speaker list, falling back to the original ID if it is absent. The request instructs the model not to infer exact values from ambiguous boundaries and to return actual speaker IDs for owners. The complete serialized input must still fit 80,000 characters after grouping; otherwise preflight rejects it without a request. This is metadata compaction, not transcript truncation or a multistage summarization pipeline. Output remains capped at 8,000 tokens. Any future extraction/synthesis pipeline must preserve original evidence through every stage, recheck contradictions and include every paid stage in the estimate.

## Keys and network destinations

The user explicitly selected unencrypted local IndexedDB persistence for provider keys. Store settings separately from meeting records and restore them before requests; expose the shared-origin/browser-profile risk in Settings. Use atomic revision-checked writes to reject stale-tab saves, propagate changes to other tabs, and keep keys out of meeting snapshots, URLs, logs, exports, error reports, static artifacts and worker caches. Forgetting keys updates the stored record while preserving other preferences. Protect in-flight settings saves and unsaved settings when updating the PWA. Do not claim encryption or forensic memory erasure.

Provider selection controls the allowed HTTPS destination, key namespace, and `connect-src` policy. Never reuse one provider's key against another endpoint or auto-follow an unexpected credential-bearing redirect. Custom endpoints are a separately reviewed capability, not a default free-text URL.

Bundle runtime scripts locally, avoid trackers and remote script CDNs, render imported/generated text safely, and sanitize any supported Markdown. Browser BYOK necessarily trusts the app's code and its origin.

## PWA lifecycle

Cache a bounded, versioned app shell under this project's path. Intercept only same-origin app assets/navigation in scope; let provider requests bypass caching. Clone a response before asynchronous cache writes if a custom caching handler is needed.

Precache each release with `Request.cache="reload"` so fresh browser HTTP entries cannot supply old HTML. Serve navigations from the activated release's cached index, keeping HTML and its hashed assets together online and offline. Worker discovery bypasses HTTP caching and changes only through the explicit activation flow. Cache identity includes both assets and worker source. Clean only this app's obsolete cache names and retain one previous app cache for still-running clients. [Request cache modes](https://developer.mozilla.org/en-US/docs/Web/API/Request/cache), [Cache.addAll Request inputs](https://developer.mozilla.org/en-US/docs/Web/API/Cache/addAll)

The update flow is: detect waiting worker, notify, save edits, settle active submissions or expose a safe pause, user clicks update, show progress, activate, wait for controller change, reload. Provide timeout/error recovery. Coordinate database migrations and old tabs before schema changes. Never auto-reload while reviewing or processing a meeting.

## Optional extensions

Local pyannote, self-hosted models, and persistent server jobs are separate future deployment modes. Adding one must document origin/authentication, data destination, installation, and state ownership. Failure of a direct browser provider is not authorization to introduce a mandatory backend.
