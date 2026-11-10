# Immersive playback plan

Status: **implemented locally; device and release acceptance incomplete**. The owner approved the visual direction on 2026-11-10. The [concept image](../fullscreen-playback-concept.png) is illustrative, not evidence of deployment. This plan supplements [product requirements](PRODUCT.md), [architecture](ARCHITECTURE.md), and the [acceptance matrix](ROADMAP.md); [task.md](../task.md) tracks execution.

## Goal and scope

Provide a video-player-like, full-screen listening experience for an existing meeting recording. The central stage presents the current speaker's anonymous avatar and synchronized captions, with playback controls and an optional transcript panel. Continue to work browser-first, with locally available recording and meeting data; entering playback must not make provider requests or require a backend.

This is an audio playback interface, not a generated video or a claim of real-world identity. Reuse existing anonymous speaker colors, labels and confirmed display names. Photo upload, face or voice identification, generated avatars, automatic chapter inference and cross-meeting voiceprints are outside this plan. The concept's chapter markers are illustrative. Automatic acoustic speaker continuity is a separate project objective; immersive playback reflects the attribution actually available and does not claim to solve it.

## Experience and interaction

### Entry, exit and continuity

- Add an explicit **Immersive playback** entry to the existing Speakers playback experience. Retain the current recording, selected position, speed and playing or paused state when entering and exiting; do not instantiate a second player or restart the recording.
- On an explicit user gesture, request native element fullscreen when supported. If unavailable or rejected, show an in-page immersive view within the available viewport, with a clear exit control. Native browser or operating-system chrome may remain visible in the fallback.
- Reconcile actual `fullscreenchange` and failure events with UI state, including browser-initiated exit. On exit restore the prior workspace, tab, scroll position and meaningful focus; preserve the current playback state and position.
- Support a visible exit control and appropriate keyboard or browser exit paths. Do not require fullscreen support, orientation lock, an online connection, or a companion application.

### Speaker and caption stage

- Make the active speaker avatar, display name and synchronized caption the primary visual focus. Active indicators are based on actual source timing and speaker assignments. During overlap, show every attributed active speaker and the associated active caption evidence; never select one person arbitrarily.
- For a paused position use a distinct paused-at-position state, not a speaking animation. For silence, unknown attribution, buffering, error and unavailable timing, show an understandable state without inventing a speaker or time.
- Retain short between-word context only under the existing playback rule and label it as context, with no active-speech halo. Render untimed segments separately and never interpolate their timing.
- Support readable wrapping, long text, adjustable caption size and reduced motion. Join Chinese, English, mixed-language and punctuation fragments without introducing misleading spaces while retaining the exact underlying source fragments, identifiers and timestamps.
- Do not infer names or identity from display names, source labels, words, avatars or transcript overlap. Speaker edits and confirmation remain in the existing review workflow.

### Transcript panel

- Desktop: provide a toggleable side panel of chronological speaker turns, with current caption highlighting and click-to-seek for timed entries. Mobile: provide a dismissible, usable panel without permanently crowding the stage.
- Follow playback by default. Manual scrolling, keyboard browsing or paging suspends following; an explicit control resumes it without unexpectedly moving focus. Keep the existing bounded rendering and navigation to all captions for long meetings.
- Show overlapping and unknown attribution honestly. List untimed entries separately and do not offer a fabricated seek location. Maintain access to the original source and correction workflow.

### Player controls

Provide play/pause, seek, elapsed and total time, bounded 15-second forward/back navigation, playback speed, caption visibility and size, transcript-panel toggle and exit. Keep controls keyboard and touch accessible. Expose volume only where the actual browser/device supports the intended control. Preserve buffering, end and error feedback. Do not add chapter markers without a separately specified trustworthy source.

## Architecture and data boundaries

- `MeetingWorkspace` remains the owner of the existing player, cue state and reference-video mutual exclusion. `usePlaybackClock` and the existing player provide the authoritative media position and status; the new view subscribes to them and issues existing playback commands. Never advance a separate visual clock or create a second audio element.
- Reuse `src/domain/playback.ts` and existing speaker activity projections for caption grouping, exact source-interval matching, overlapping speakers, gap context and long-transcript windows. Extract a shared read-only projection only if required to avoid conflicting rules between the two views.
- A focused fullscreen lifecycle component or hook owns fullscreen events, in-page fallback, focus and scroll restoration. Presentation state such as panel visibility and caption size must not mutate the meeting, source revisions, provider output, human edits or memo citations.
- Preserve original provider runs, human edits, speaker correction, undo, revision invalidation, backups and existing audio ownership. Existing reference video remains explicit-load, separate from AI input, and mutually exclusive with local audio playback; entering or leaving the new view must not silently start it or bypass that contract.
- Existing chunked audio remains bounded. First reproduce or rule out the identified asynchronous window-switch race: a pending switch may apply an obsolete source or play intent after pause or seek. If reproduced, fix with current-operation and current-intent checks and focused regression tests before relying on it for immersive navigation. Do not claim the risk reproduced until demonstrated.

Baseline investigation, 2026-11-10: controlled delayed-decode tests reproduced a boundary switch restarting after pause and replacing a newer seek. The local working-tree repair guards window operations and playback intent; `tests/chunked-audio-race.test.ts` covers these races, MP4 seeks, late play events, disposal, and aborted seek playback. These synthetic tests do not establish real-device timing or complete immersive-playback acceptance.

## Platform, accessibility and responsive behavior

Use a user-initiated [Fullscreen API request](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen) with failure handling and an in-page fallback. Fullscreen availability is browser-dependent; [WebKit's non-video fullscreen issue](https://bugs.webkit.org/show_bug.cgi?id=212934) illustrates why iPhone support must not be assumed. Test the actual supported iOS versions in Safari and installed standalone mode. Do not promise hidden browser chrome or orientation locking.

- Desktop: centered stage with optional side transcript. Tablet: adapt panel and speaker arrangement to available space. Phone: prioritize avatars, captions and controls; use a dismissible transcript panel and test both orientations.
- Respect dynamic viewport changes, safe-area insets, system gestures, zoom, long speaker names, large text and on-screen keyboards. Fixed controls must not cover captions, focus or critical actions.
- Give controls accessible names, states and visible focus; support keyboard, touch and screen readers. Do not rely on color alone. Honor reduced-motion settings and avoid intrusive live announcements for every caption update. Restore focus on panel and fullscreen exit.

## Delivery sequence

1. **Establish baseline:** inspect current playback ownership, fullscreen/scroll lifecycle and changed working-tree state; reproduce or rule out the chunk-switch race using controlled timing; document actual device constraints.
2. **Core stage:** implement entry/exit, native fullscreen and in-page fallback, shared playback state, anonymous avatars, captions, overlap, gap, unknown, pause and error states. Prove switching does not reset or duplicate audio.
3. **Controls and transcript:** implement bounded seek and speed controls, captions and transcript panel, manual-follow suspension/resume, untimed handling and multilingual text display.
4. **Adaptation and verification:** complete responsive and accessibility behavior, focused regressions, real browser and physical-device checks. Update authoritative product/architecture documentation to describe verified behavior and disclose remaining platform limits.

The local implementation does not by itself complete device, accessibility or release acceptance. No checkbox is complete solely because a mockup, unit test, or implementation exists.

## Acceptance and verification

| Area | Required evidence |
| --- | --- |
| Continuity | Enter and exit while playing and paused; actual media position, rate and state persist, with one player and no duplicate playback. |
| Attribution | Boundary times, single and overlapping speakers, unknown attribution, short gaps, silence, pause and untimed segments are represented without fabricated activity or timing. |
| Controls | Seek, bounded skip, speed, captions, panel toggle, keyboard, touch, buffering, error and end states behave correctly. |
| Long recordings | Cross-chunk playback, seeks, concurrent pause/seek and window loads, resumed playback and bounded rendering are exercised with representative fixtures; report tested duration and device limits. |
| Captions | Word and sentence timings, Chinese, English, mixed text, punctuation, long lines and large text remain readable and preserve source evidence. |
| Transcript | Follow, user interruption, resume, panel navigation, untimed entries and long-meeting pagination or windowing retain access to all evidence. |
| Fullscreen | Native entry, denial, unavailable API, browser-initiated exit, in-page fallback, focus and scroll restoration. |
| Devices | Current desktop browsers, mobile browsers, physical iPhone Safari and installed iOS PWA; record exact versions, viewport/orientation, results and unsupported cases. |
| Accessibility | Keyboard, real screen-reader checks, focus order, visible focus, touch targets, zoom, contrast, reduced motion and safe areas. |
| Data and offline | Existing locally stored audio plays offline; source output, edits, revisions, citations, backups and keys are unchanged. No provider call or charge is introduced. |

Use focused unit and browser tests for deterministic behavior, plus real-browser and physical-device checks for media, fullscreen, screen-reader and safe-area behavior. Synthetic fixtures are not proof of real diarization quality, iOS support or long-recording performance. Keep unavailable tests open with their concrete limitations; do not treat a build or screenshot as full acceptance.
