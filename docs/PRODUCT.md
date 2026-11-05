# Product requirements

Version: 1.1 browser-first design, 2026-11-04. Status: requirements and proposed implementation; not a shipped feature list.

## Product decision

Deliver an installable web application hosted on GitHub Pages. Users bring their own provider keys and work from a browser on desktop or mobile. A companion or hosted backend may be evaluated later as an optional extension; neither is the default architecture.

The core use case is reviewing ERP customer meetings, including Chinese/English mixed discussions. The product turns recordings into auditable notes while giving users control over speaker identity, corrections, transmission, and export.

## Scope

| Priority | Capability |
| --- | --- |
| P0 | Meeting setup; audio import and playback; transcript import; capability-aware cloud transcription and speaker labels; speaker review and correction; transcript editing; evidence-linked memo generation and review; local drafts; export and backup; runtime BYOK; estimates and explicit send confirmation; checkpoint recovery |
| P1 | Microphone recording; richer waveform; ERP templates and glossary; additional verified providers; improved audio conversion; optional encrypted backup |
| P2 | Live transcription/diarization; platform integrations; collaboration and synchronization; local model inference; optional companion or backend |

A transcript-only preview can ship as an explicitly limited milestone. A speaker-aware P0 release needs at least one browser-validated provider returning usable speaker and time evidence. Manual labeling is a recovery/editing feature, not proof that automatic diarization works.

## User journey

### 1. Create and import

Capture title, meeting date, timezone, language hints, meeting type, optional attendees, and glossary. The attendee list provides naming choices; it does not establish voice identity.

Show audio filename, type, size, duration when obtainable, and playback before transmission. Preserve independent channels and original source metadata. Explain unsupported formats or oversized inputs before starting a paid request. Importing text remains available when audio processing is unavailable.

For text-only imports, keep audio timestamps and speaker identity absent unless the import contains trustworthy mappings. Never invent time positions to make playback links appear complete.

### 2. Select processing and confirm

Show transcription provider/model, memo provider/model, which key each needs, transmitted data, expected stages, and a dated estimate. More than one provider can require more than one key. BYOK does not imply one universal key.

The user chose to persist provider keys, provider/model selections, and speech rate in this browser. Keys are unencrypted in a separate IndexedDB database; describe the shared-origin/browser-profile trust boundary, provide explicit forgetting, and exclude keys from meeting backups. The first update from an older memory-only version requires one re-entry. No paid validation request occurs just because the user typed a key. Any test that sends data is explicit and describes its potential charge.

Before sending, show a clear confirmation of the selected data and recipient. Estimates include known stages and identify missing rates; an estimate is neither an invoice nor an account-level spending cap.

### 3. Process and recover

Display meaningful stages and completed input chunks, not a fabricated overall percentage. Persist completed results and local job metadata. Warn that the app needs to remain open for reliable foreground processing.

After a reload or suspension, retain completed work. Require the key again and, if necessary, reselect the original file and verify its identity. Check a saved provider job ID when supported. An unknown paid outcome requires review before resubmission.

### 4. Review speakers

Each anonymous speaker has a stable local ID, speaking duration where supported, and multiple playable examples. Users can confirm a name, leave identity unknown, and correct assignments.

Support single-segment reassignment, selected-segment bulk reassignment with an impact preview, speaker merge, time-based segment split, and undo. A segment split with insufficient timing evidence becomes a text split with unresolved time boundaries; it cannot create precise timestamps.

Preserve overlap or multiple possible speakers. Provider labels from separate runs/chunks are independent until mapped. Never merge speakers because labels or display names match. Do not retain cross-meeting voiceprints by default.

### 5. Review the transcript

Show segment time range, speaker/identity state, original text, corrected text, and review state. Playback jumps to the source range when known. Users can edit text without erasing the original result and filter unknown or flagged segments.

Allow continued memo work with unresolved segments, but carry those limitations into the result. A model score, heuristic flag, and human confirmation must be visually distinguishable.

### 6. Generate and review a memo

Produce summary, discussion, decisions, action items, open questions, and risks with source segment references. Require review for critical owner, date, amount, and business-rule claims. Missing fields remain unknown; a suggestion does not become an agreed decision.

Store original relative dates as well as any resolved date. Resolve only when meeting date, timezone, and wording support it. Speaker confirmation does not by itself prove that the speaker owns an action.

Users accept, edit, or reject individual items and jump to transcript/audio evidence. Changed transcript text, speaker attribution, meeting date, or timezone marks affected items stale. Regeneration creates a new version and preserves human edits.

### 7. Export, back up, and delete

Support human-readable Markdown/TXT and versioned JSON. A full meeting backup also carries audio or explicitly records its absence. Exported review state and unknowns remain visible. Print/PDF is a separate tested capability.

Deleting a meeting removes its local audio, chunks, revisions, and jobs according to the documented storage transaction. It cannot retract downloaded exports or promise deletion of provider-side copies. No automatic email, ERP write, KB write, or other external publication is part of P0.

## Screens and interaction

Meeting Library, New Meeting/Import, Processing, Speaker Review, Transcript Editor, Memo Review, and Settings are the primary screens. Use consistent navigation and a persistent compact player when reviewing evidence.

Desktop can show a speaker list, transcript, and review panel side by side. Mobile uses a single column with filters and an accessible bottom sheet or full-screen editor. Keep controls usable with touch, keyboard, and screen readers.

Apply iPhone standalone safe areas, opaque theme-aware top surfaces, at least 16px mobile form text, visible focus, approximately 44px primary touch targets, pinch zoom, and reduced-motion support. Long screens can use a non-jittering hide/reveal top bar and contextual scroll-to-top; omit them where they add no value.

## Offline and lifecycle contract

| Operation | Offline expectation after application assets are cached |
| --- | --- |
| Open saved meetings and review/edit drafts | Available |
| Play recording | Available only if its audio is saved locally |
| Import a locally supported file or transcript | Available; unsupported conversion stays unavailable |
| Export saved data | Available |
| Start or resume cloud AI | Requires network, key, and explicit authorization |
| Continue work after tab closure | Not guaranteed |
| Synchronize another device | Not part of P0 |

Show offline, update available, updating, and failure states. A new release must offer a user-controlled update, save drafts, show immediate progress after the update action, and reload only after activation is ready. Do not interrupt an active paid request with an automatic refresh.

## Product acceptance

P0 is complete only when an end-to-end real-browser recording can be transcribed with speaker/time evidence, corrected, converted into reviewed memo items, exported, restored, and played back with valid references. See [the release matrix](ROADMAP.md) for failure and browser coverage. Documentation, mocked APIs, and a manifest alone cannot satisfy this acceptance criterion.
