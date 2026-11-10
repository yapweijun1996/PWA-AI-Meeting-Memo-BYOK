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

The new-meeting form shows the selected date in a spelled-out local UI format alongside the browser date control. It suggests timezones supported by the browser where available, accepts valid manually entered timezones, and reports an invalid timezone before importing or saving a meeting. Stored dates remain ISO calendar dates.

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

The speaker editor uses a single searchable review queue, unconfirmed-first filtering, and one identity inspector. Its voice review presents bounded samples for the selected label and an optional second label for manual A/B listening. Related transcript fragments follow the coarse player position. Saving a name does not confirm it; confirming advances to another unconfirmed label when available. The sample transcript can include other voices, and summed timed intervals can count overlaps more than once. This view does not currently render an audio-derived waveform or identify voices automatically.

During full-recording playback, present a responsive visual stage with one labeled participant per detected or manually added speaker; five participants are an example, not a limit. Highlight every speaker whose supported time interval contains the current playback position. The display represents the current transcript attribution, not proof of a person's identity or an independent voice detector. Show overlap, gaps, untimed passages and unconfirmed identities explicitly; do not animate a guessed speaker when evidence is absent. Seeking, playback, correction and the stage must remain synchronized, including after edits and reload. Users can inspect the relevant transcript and correct attribution through existing review and undo flows, without altering original provider output.

Provide English and Simplified Chinese throughout the application, including controls, guidance, errors, dialogs, accessible names and status announcements. UI language is independent of the recording's language. Preserve user content and stable IDs when switching; retain the selection locally, handle missing translations without exposing keys, and verify long text, mobile layout and screen readers in both languages. The saved language selection covers the main controls and known application messages. Unrecognized messages retain their original text; full message coverage and physical-device and screen-reader acceptance remain open.

Settings separates appearance from API and model configuration without discarding unsaved form entries when switching tabs. The appearance panel distinguishes the language save flow from immediately saved appearance choices and previews the current theme, palette, font and size. It provides a bounded set of local font stacks that fall back when a font is unavailable. Language and provider settings retain their explicit save flow. Font preferences do not enter meeting backups or provider requests, and clearing keys does not clear the font preference.

The [interactive concept](design/speaker-review-prototype.html) uses invented timing data to demonstrate the layout. It does not analyze uploaded recordings or connect to meeting data.

#### Synchronized playback acceptance contract

Owner-approved direction, 2026-11-06: prioritize the Audio → Active Speaker → Live Caption → Transcript Highlight synchronization loop before avatar uploads or further video enhancement. Implementation and release evidence belong in [validation](VALIDATION.md); these requirements alone do not establish completion.

Playback and Edit Speakers are separate views of the same meeting and recording. Switching views retains the audio position. Playback emphasizes the currently attributed speaker(s), readable captions and a synchronized transcript; Edit Speakers retains sample listening, name drafts, confirmation, merge and undo. Desktop uses a stage/transcript split when space permits; mobile stacks the content above a persistent accessible player.

The local immersive playback view presents the same recording and attribution in a full-screen stage, with an in-page fallback when native fullscreen is unavailable. It uses the existing player and clock, provides playback controls and a bounded transcript, and leaves speaker corrections in the existing editor. Device-specific fullscreen, iPhone standalone and physical screen-reader acceptance remain unverified.

The local immersive follow-up presents the current attributed speaker labels and their name-confirmation state in a separate stage, with a collapsible list of all meeting labels. Paused attribution does not imply active speech; overlapping and unknown attributions remain visible. Source-timed caption fragments receive visible emphasis, and untimed text has a separate transcript disclosure. The view does not establish cross-part voice identity. See the [immersive plan](IMMERSIVE-PLAYBACK-PLAN.md) for remaining verification.

The immersive view has a stable stage, a separate timeline and controls dock, and Focus/Reading modes that retain playback. Desktop users can adjust transcript width from 25–45%; tablet layouts stack the transcript, and phones open it as a dismissible sheet. Search covers timed caption groups and untimed passages without assigning times to untimed results; returning to the current position clears the search and resumes follow. The speaker-label list opens the existing editor rather than inferring identity links. Stage-focused keyboard shortcuts operate the existing player and do not intercept text inputs or transcript browsing.

The immersive stage uses a subtle ambient background and a pulse around attributed speakers only while playback is active. The pulse represents transcript attribution, not measured audio energy or verified identity; it stops for pauses, buffering and gaps and respects reduced-motion preferences. Caption groups fade in briefly when they enter the stage, without changing their position or restarting for each source fragment. Reduced motion disables the fade. Current source-timed fragments and transcript rows have additional visual emphasis without changing their timing or text.

The recording's `HTMLAudioElement.currentTime` is the only audio timeline. Play, pause, seeking, rate changes, buffering, end and media errors update a shared playback state. A render callback may read the media time but must not advance a second clock from elapsed wall time. Every playback view derives active source fragments from the same half-open intervals (`start <= time < end`). Overlapping intervals retain all speakers; gaps and unknown timestamps remain explicit. A paused position may retain attribution, but must not claim that someone is currently speaking or animate speech.

Caption grouping is a read-only presentation over original fragments and source IDs, not a source revision or a fabricated alignment. Untimed text remains available for review without being assigned an inferred audio position. Short word gaps inside an existing same-speaker group may retain explicitly inactive context to avoid flashing the stage empty; active-speaker state and transcript highlighting still require an exact source interval. Do not delay real speaker changes or merge identities to hide uncertain source attribution. Long transcripts need bounded rendering with a way to reach every displayed group. Automatic following pauses when the user browses manually and resumes only through an explicit follow action; it must not steal keyboard focus. Caption size is adjustable, speaker state does not rely on color alone, and reduced-motion preferences apply. Speaker counts refer to source fragments, and any summed interval duration must not be presented as independently measured unique speaking time.

#### Group-chat playback stage, audio-reactive avatars, and synchronized captions (planned 2026-11-06)

The sequential group-chat layout is implemented with an N-speaker roster, source-fragment highlighting, state-preserving seeking, bounded timed/untimed views and explicit follow recovery. The former duplicated hero/live-caption layout is removed. Audio-energy sampling and pulse halos remain planned; the activity glyph currently reflects exact source attribution only.

To make multi-speaker playback easier to scan than a split live-caption box plus separate transcript cards, the Playback view adopts a **WhatsApp-style sequential group-chat stream** paired with a persistent top speaker avatar stage:

| Element | Behavior during playback |
| --- | --- |
| **5 Speakers (or $N$ detected/manual speakers)** | Persistent top row of speaker cards; each speaker has a fixed circular avatar (`S1`–`S5`), distinct SSOT identity color (`--speaker-1` to `--speaker-5`), and status label (`Idle` when inactive; live equalizer indicator `·\|·\|·` and highlighted border when active). |
| **Active Avatar** | Soft outer pulse halo (`scale(1.00)` to `1.12`) driven by smoothed audio energy from the recording when both `playing === true` and an attributed segment is active. |
| **Chat Bubble** | Chronological, left-aligned group-chat bubbles (no left/right private-chat alternation). Each bubble displays the speaker's circular avatar anchored at the bottom-left, speaker name at top-left, active waveform icon at top-right, caption text in the body, and timestamp at bottom-right. |
| **Live Captions** | Consecutive short segments from the same speaker merge into one readable bubble while preserving underlying fragment timestamps for word- or sentence-level synchronized highlighting. |
| **Timestamp** | Clicking a bubble or its bottom-right timestamp (`00:08`) seeks `HTMLAudioElement.currentTime` directly to that segment's `start`. |
| **Speaker Switch** | Previous speaker's avatar immediately stops pulsing and returns to `Idle`; new active speaker's avatar and chat bubble transition smoothly without reflowing the layout. |
| **Audio Player** | Persistent bottom bar controlling the shared `HTMLAudioElement.currentTime` timeline across the entire chat stream and speaker stage. |

Production animation and data-integrity rules for this layout:

- **Avatar Pulse**: The outer halo expands within a bounded `1.00–1.12` scale range driven by smoothed audio energy (`0.0–1.0`) from a Web Audio `AnalyserNode`. Silence, paused playback, inter-segment gaps, and inactive speakers must display zero pulse (`scale(1.00)`).
- **Active Chat Bubble**: The active bubble uses a soft green surface (`#eaf5ec`), green accent border (`#5b9b70`), and a `150–200ms` color transition without changing box dimensions or re-sorting the chat list.
- **Caption Highlight (Word vs. Sentence Granularity)**: When sub-sentence or word-level timestamps exist within a merged bubble (`fragments.length > 1`), highlight the active fragment/words as `currentTime` advances; when only sentence-level timestamps exist (`fragments.length === 1`), highlight the full sentence. Never divide duration evenly by character count or interpolate missing timestamps to claim word-level synchronization.
- **Smart Auto Scroll**: Auto-scroll follows the active chat bubble by default. Manual user scrolling immediately pauses auto-follow and surfaces an explicit `Jump to live` / `Follow playback` button so playback never steals the user's reading position or keyboard focus.
- **Overlap and Evidence Preservation**: Merging consecutive short turns from the same speaker into one visual bubble is a read-only view projection; the underlying model must retain every segment's `id`, `start`, `end`, `speakerIds`, and `text`. When overlapping speech occurs, multiple speaker avatars may be active simultaneously—never overwrite overlapping attribution with a single speaker ID.
- **Responsive Layout and Reduced Motion**: Mobile uses a single-column chat list, a compact horizontal avatar bar at the top, and a fixed bottom audio player; desktop can present the chat stream alongside the speaker stage/inspector. When `prefers-reduced-motion: reduce` is active, disable pulse scaling and smooth-scroll motion while keeping static active borders and badges.

An optional original YouTube reference lets users see people while checking a voice manually. A video ID in an audio filename is only a suggestion; it is not proof of the source or synchronization. The user explicitly saves a validated YouTube link and can adjust the time offset (video time = recording time + offset). The reference is auxiliary meeting metadata, included in backups but excluded from AI input; changing it does not revise transcript evidence or confirm an identity. Older meetings without this field remain valid.

The player connects to YouTube only after an explicit load/watch action, uses privacy-enhanced embedding, and provides a timestamped external link when embedding is unavailable. Local recording playback and the embedded video are mutually exclusive. The reference requires a network connection and does not upload the local recording. See [YouTube embedding guidance](https://support.google.com/youtube/answer/171780?hl=en) and [player timing parameters](https://developers.google.com/youtube/player_parameters). People remain anonymous until a user confirms a name; the app does not recognize faces or voices as real identities.

### 5. Review the transcript

Show segment time range, speaker/identity state, original text, corrected text, and review state. Playback jumps to the source range when known. Users can edit text without erasing the original result and filter unknown or flagged segments.

The transcript review view groups adjacent short timed fragments from the same attribution into readable paragraphs without changing source records. Users can expand each group to edit and review individual fragments, or mark the group's fragments reviewed in one undoable operation. Filtering preserves breaks between nonadjacent fragments. Long reviews use paged groups; a note citation opens the page containing its exact source. Untimed and overlapping fragments retain their original evidence and are not assigned inferred times.

Allow continued memo work with unresolved segments, but carry those limitations into the result. A model score, heuristic flag, and human confirmation must be visually distinguishable.

### 6. Generate and review a memo

Produce summary, discussion, decisions, action items, open questions, and risks with source segment references. Require review for critical owner, date, amount, and business-rule claims. Missing fields remain unknown; a suggestion does not become an agreed decision.

Store original relative dates as well as any resolved date. Resolve only when meeting date, timezone, and wording support it. Speaker confirmation does not by itself prove that the speaker owns an action.

Users accept, edit, or reject individual items and jump to transcript/audio evidence. Changed transcript text, speaker attribution, meeting date, or timezone marks affected items stale. Regeneration creates a new version and preserves human edits.

The review screen can expand the cited revisions together in citation order and open each revision in the source inspector. Check the full claim against those passages: matching citation identifiers do not establish that the claim is supported. This view does not perform semantic fact-checking.

Long transcripts may require a bounded plan of up to eight evidence-extraction requests plus one synthesis request. Before sending, show the full stage count, destination and known/unknown charge; one confirmation covers the remaining sequential steps. Save successful steps before proceeding, stop on every error and never automatically resume after reload. Explicit retry of a failed/unknown step requires a billing-review acknowledgement. Keep all source fragments and revision references; do not silently truncate or promise arbitrary-length support. Extraction and synthesis remain unverified model claims requiring human review. See the owner acceptance pack for real-data quality gates.

### 7. Export, back up, and delete

Support human-readable Markdown/TXT and versioned JSON. A full meeting backup also carries audio or explicitly records its absence. Exported review state and unknowns remain visible. Print/PDF is a separate tested capability.

Deleting a meeting removes its local audio, chunks, revisions, and jobs according to the documented storage transaction. It cannot retract downloaded exports or promise deletion of provider-side copies. No automatic email, ERP write, KB write, or other external publication is part of P0.

## Screens and interaction

Meeting Library, New Meeting/Import, Processing, Speaker Review, Transcript Editor, Memo Review, and Settings are the primary screens. Use consistent navigation and a persistent compact player when reviewing evidence.

### Dashboard information architecture and SSOT design system (2026-11-06)

The home screen is a task-oriented Meeting Management Workspace rather than a promotional landing page:

- **Primary CTA hierarchy**: Keep one primary `New meeting` button in the page heading; sidebar shortcuts (`Your meetings`, `Needs review`, `New meeting`, `Restore backup`, and `Recent meetings`) and the compact overview banner's `How it works` action remain visually secondary.
- **Above-the-fold priority**: Order the dashboard as compact sticky topbar (`52px` desktop, `56px` mobile) -> page heading -> three workflow KPI cards (`Total meetings`, `Needs review`, `Completed notes`) -> compact single-row overview banner -> unified `Meeting library` toolbar (status filter pills, search input, and sort selector in one wrapping row) -> meeting cards. Local-storage disclosure belongs in the topbar and sidebar status regions rather than occupying a KPI card.
- **Recent meetings**: Show the four most recently updated meetings with their workflow status; provide the full title on pointer or keyboard focus and a direct link to the complete meeting library when more exist. On small screens, selecting a recent meeting closes the navigation drawer.
- **Unified workflow statuses**: Represent each meeting's lifecycle state consistently across library cards, sidebar recent indicators, and the topbar breadcrumb badge using `Recording`, `Transcribing`, `Needs review`, `Ready`, and `Failed`, paired with the stage subtitle (`Draft notes`, `Review transcript`, `Completed notes`, `Ready to transcribe`, `Outcome unknown`) and an explicit next-step CTA (`Review`, `Transcribe`, `Open`, `View`, `Start`).
- **SSOT Design System protocol**: Define colors, typography scale (14–16px body text, at least 12px supporting text on desktop, and 16px mobile form controls), spacing, radii, semantic status tones (`neutral`, `green`, `sand`, `danger`, `light`), and the 5-color speaker identity palette in one authoritative token/component layer (`src/style.css` `:root` tokens and `src/components/ui.tsx`) with verified WCAG 2.1/2.2 AA contrast (>= 4.5:1).

Desktop can show a speaker list, transcript, and review panel side by side. The speaker review stage provides adjustable listening samples. Playback mode offers an optional explicit-load public-video reference. Mobile uses a single column with filters and an accessible bottom sheet or full-screen editor. Keep controls usable with touch, keyboard, and screen readers.

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

### Interface preferences and update status

The top bar provides an immediate, device-local language selector. It updates the interface while preserving unsaved settings drafts; an in-progress settings write must finish first. A separate unsaved language choice in Appearance remains a draft until settings are saved. English and Simplified Chinese are supported; Malay currently translates common navigation and review labels and explicitly falls back to English for untranslated text. The Appearance settings offer ten local font-family choices, five text sizes, light or dark mode, and four color palettes. These choices use locally available fonts with system fallbacks. These interface preferences do not change transcript language or send text to a provider.

The sidebar shows the package version and current build identity, plus a manual update check. A waiting update uses the same user-confirmed activation flow as the main notice. Pending edits and provider requests remain protected. A development build or unavailable service worker cannot perform an update check.

Immersive captions fit ordinary caption groups to the available stage up to the selected preferred size, down to a 16px minimum. Exceptionally long groups may still need internal scrolling to preserve the full transcript. A separate fullscreen control returns to the immersive player when fullscreen is exited.

Speaker avatars are meeting-local presentation only and never establish or alter voice identity. Default avatars are deterministic, anonymous illustrations. A user may replace one with a locally cropped JPEG, PNG, or WebP image (source limit 5 MB). Full ZIP backups include saved profile images, including images retained for undo; plain meeting JSON exports do not. Older app builds that reject unknown ZIP entries cannot import a backup containing avatars. If image processing or storage is unavailable, the interface reports an error and retains the previous avatar.

## Product acceptance

P0 is complete only when an end-to-end real-browser recording can be transcribed with speaker/time evidence, corrected, converted into reviewed memo items, exported, restored, and played back with valid references. See [the release matrix](ROADMAP.md) for failure and browser coverage. Documentation, mocked APIs, and a manifest alone cannot satisfy this acceptance criterion.
