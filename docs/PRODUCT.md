# Product requirements

Version: 1.1 browser-first design, 2026-11-04. Status: requirements and proposed implementation; not a shipped feature list.

## Product decision

Deliver an installable web application hosted on GitHub Pages. Users bring their own provider keys and work from a browser on desktop or mobile. A companion or hosted backend may be evaluated later as an optional extension; neither is the default architecture.

The core use case is reviewing ERP customer meetings, including Chinese/English mixed discussions. The product turns recordings into auditable notes while giving users control over speaker identity, corrections, transmission, and export.

Owner acceptance clarification, 2026-11-05: speaker detection is mandatory for the normal recording workflow. A text-only transcription is an explicitly limited recovery path and cannot satisfy this requirement. Anonymous labels must remain unconfirmed until reviewed; successful metadata delivery does not by itself establish accurate voice separation or real-person identity.

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

#### Requested preset and cost visibility (planned 2026-11-05)

Offer a clearly labeled recommended starting preset: OpenRouter `elevenlabs/scribe-v2` for transcription and OpenAI `gpt-6-luna` for memo generation. New installations may start with this combination; preserve existing users' saved selections, keys and custom model IDs through upgrades. Allow users to select and edit alternatives. Explain that the preset needs separate OpenRouter and OpenAI keys, and choosing it does not validate keys, send audio or guarantee model availability. Preserve explicit consent before paid requests and never silently fall back to a different provider or model.

Show cost and usage before and after each request and in meeting processing history. Before sending, label a cost as an estimate only when the needed duration/usage and a clearly dated, applicable rate are available; otherwise show unknown. After completion, show the provider-reported usage and, if actually returned, provider-reported request cost, with its currency and source. If calculating a cost from token usage and rates, label it as an estimate and expose its rate, date and assumptions; do not treat it as a bill. Failed, cancelled and interrupted submissions may be billable and can have unknown cost. Historical missing usage must remain unknown, not zero. Meeting totals must disclose incomplete entries and separate currencies and estimate versus provider-reported amounts; account-wide billing remains with each provider.

All preset, cost and usage states, explanations and accessible labels must support English and Simplified Chinese. Local validation records include one complete English MP3 exercised through speaker-aware transcription and memo generation after bounded input compaction; the paid long-recording memo request predates the current fragment-array transport, while current compaction is covered offline and synthetically. This does not establish diarization accuracy or arbitrary-length meeting support; see [validation](VALIDATION.md) for the tested scope and remaining review limitations. This section describes requirements, not a claim that all cost and localization acceptance criteria are complete.

### 3. Process and recover

Display meaningful stages and completed input chunks, not a fabricated overall percentage. Persist completed results and local job metadata. Warn that the app needs to remain open for reliable foreground processing.

After a reload or suspension, retain completed work. Require the key again and, if necessary, reselect the original file and verify its identity. Check a saved provider job ID when supported. An unknown paid outcome requires review before resubmission.

### 4. Review speakers

Each anonymous speaker has a stable local ID, speaking duration where supported, and multiple playable examples. Users can confirm a name, leave identity unknown, and correct assignments.

Support single-segment reassignment, selected-segment bulk reassignment with an impact preview, speaker merge, time-based segment split, and undo. A segment split with insufficient timing evidence becomes a text split with unresolved time boundaries; it cannot create precise timestamps.

Preserve overlap or multiple possible speakers. Provider labels from separate runs/chunks are independent until mapped. Never merge speakers because labels or display names match. Do not retain cross-meeting voiceprints by default.

#### Listening and identification workspace

Word-level segments can be too short to recognize a voice. The listening workspace offers longer, adjustable listening windows with transcript context and examples from distinct turns. It shows the actual range and makes clear that surrounding audio may contain other voices. Sample windows do not add or change source timestamps or imply that every voice in a window belongs to the selected speaker.

During full-recording playback, present a responsive visual stage with one labeled participant per detected or manually added speaker; five participants are an example, not a limit. Highlight every speaker whose supported time interval contains the current playback position. The display represents the current transcript attribution, not proof of a person's identity or an independent voice detector. Show overlap, gaps, untimed passages and unconfirmed identities explicitly; do not animate a guessed speaker when evidence is absent. Seeking, playback, correction and the stage must remain synchronized, including after edits and reload. Users can inspect the relevant transcript and correct attribution through existing review and undo flows, without altering original provider output.

Provide English and Simplified Chinese throughout the application, including controls, guidance, errors, dialogs, accessible names and status announcements. UI language is independent of the recording's language. Preserve user content and stable IDs when switching; retain the selection locally, handle missing translations without exposing keys, and verify long text, mobile layout and screen readers in both languages. The saved language selection covers the main controls and known application messages. Unrecognized messages retain their original text; full message coverage and physical-device and screen-reader acceptance remain open.

The [interactive concept](design/speaker-review-prototype.html) uses invented timing data to demonstrate the layout. It does not analyze uploaded recordings or connect to meeting data.

An optional original YouTube reference lets users see people while checking a voice manually. A video ID in an audio filename is only a suggestion; it is not proof of the source or synchronization. The user explicitly saves a validated YouTube link and can adjust the time offset (video time = recording time + offset). The reference is auxiliary meeting metadata, included in backups but excluded from AI input; changing it does not revise transcript evidence or confirm an identity. Older meetings without this field remain valid.

The player connects to YouTube only after an explicit load/watch action, uses privacy-enhanced embedding, and provides a timestamped external link when embedding is unavailable. Local recording playback and the embedded video are mutually exclusive. The reference requires a network connection and does not upload the local recording. See [YouTube embedding guidance](https://support.google.com/youtube/answer/171780?hl=en) and [player timing parameters](https://developers.google.com/youtube/player_parameters). People remain anonymous until a user confirms a name; the app does not recognize faces or voices as real identities.

### 5. Review the transcript

Show segment time range, speaker/identity state, original text, corrected text, and review state. Playback jumps to the source range when known. Users can edit text without erasing the original result and filter unknown or flagged segments.

Allow continued memo work with unresolved segments, but carry those limitations into the result. A model score, heuristic flag, and human confirmation must be visually distinguishable.

### 6. Generate and review a memo

Produce summary, discussion, decisions, action items, open questions, and risks with source segment references. Require review for critical owner, date, amount, and business-rule claims. Missing fields remain unknown; a suggestion does not become an agreed decision.

Store original relative dates as well as any resolved date. Resolve only when meeting date, timezone, and wording support it. Speaker confirmation does not by itself prove that the speaker owns an action.

Users accept, edit, or reject individual items and jump to transcript/audio evidence. Changed transcript text, speaker attribution, meeting date, or timezone marks affected items stale. Regeneration creates a new version and preserves human edits.

The review screen can expand the cited revisions together in citation order and open each revision in the source inspector. Check the full claim against those passages: matching citation identifiers do not establish that the claim is supported. This view does not perform semantic fact-checking.

### 7. Export, back up, and delete

Support human-readable Markdown/TXT and versioned JSON. A full meeting backup also carries audio or explicitly records its absence. Exported review state and unknowns remain visible. Print/PDF is a separate tested capability.

Deleting a meeting removes its local audio, chunks, revisions, and jobs according to the documented storage transaction. It cannot retract downloaded exports or promise deletion of provider-side copies. No automatic email, ERP write, KB write, or other external publication is part of P0.

## Screens and interaction

Meeting Library, New Meeting/Import, Processing, Speaker Review, Transcript Editor, Memo Review, and Settings are the primary screens. Use consistent navigation and a persistent compact player when reviewing evidence.

Desktop can show a speaker list, transcript, and review panel side by side. The speaker review stage provides adjustable listening samples and an optional explicit-load public-video reference beside the samples. Mobile uses a single column with filters and an accessible bottom sheet or full-screen editor. Keep controls usable with touch, keyboard, and screen readers.

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
