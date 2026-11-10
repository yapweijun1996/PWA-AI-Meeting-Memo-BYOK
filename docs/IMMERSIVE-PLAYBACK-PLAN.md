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

## Immersive review findings — 2026-11-10

Status: **open review and verification**. These observations come from a user-provided desktop screenshot and static inspection of the local working tree, including uncommitted changes. They do not establish behavior of a deployed build. No browser, performance, device or screen-reader test was run for this review.

Local follow-up: the stage now presents current attributed speakers separately from a collapsible label list, includes confirmation status and visible source-fragment emphasis, and puts untimed text in its own disclosure. The follow state is visible. This is local work, not a claim of deployed or physical-device acceptance. The observations below describe the reviewed baseline; overlap visibility, keyboard behavior, performance and device acceptance remain open where not independently verified.

Transcript follow-up: when automatic following needs to reposition, the local view aligns a complete preceding row where space permits and keeps a bottom margin around the current row. A clipped top row also triggers correction during follow. Manual browsing continues to suspend this adjustment; resuming follow restores it. A row taller than the viewport cannot be fully visible at once. Focused Chromium/WebKit browser tests cover whole-row alignment, manual scrolling and follow resumption; physical-device and long-row acceptance remain open.

Avatar follow-up: during an existing same-caption internal gap of at most 350 ms, the local view retains the caption's speaker card as context. In other gaps or after the last timed caption, it displays the most recently completed timed caption and its speakers. Context and previous-caption descriptions are available to screen readers, while frequent status text is visually hidden at the owner's request. Neither fallback shows a speaking halo or active-fragment highlight. Buffering and playback errors remain visible. Current source intervals take precedence, overlap remains visible, and seeking before the first timed caption does not invent earlier content. This is a presentation projection; it does not change attribution or source evidence.

Highlight responsiveness follow-up: foreground playback now samples the real media time on animation frames rather than throttling sampling to 50 ms; the transcript and central caption still share exact source boundaries. A native synthetic WAV probe in local Chromium, with `timeupdate` suppressed, observed 13 mismatched frames and a maximum 35.6 ms boundary mismatch before the change; one subsequent run observed none across 154 frames. These are small local samples, not guarantees of device latency or recognition accuracy. Real-recording word timestamps, long-transcript performance and physical-device audio output remain unverified. No offset or source timestamp correction is applied.

Responsive redesign: the local stage centers bounded, scrollable captions under the current speaker; the dock separates the timeline from controls. Desktop transcript width is adjustable, tablet panels stack and the phone transcript opens as a sheet. Focus/Reading switches and stage-focused keyboard shortcuts preserve the shared player. Search covers timed groups and untimed passages; Jump to current clears the filter and resumes follow. These are local changes pending the associated browser and physical-device acceptance, not proof of deployment.

### Observed and code-supported issues

- The stage renders every meeting speaker label as a large avatar. The screenshot shows 19 part-scoped labels dominating the stage. The avatar's `S` number is its current list position, not the provider label or a stable identity. Identically named speakers from different parts cannot be assumed to be the same person. Current overlap-word suggestions are not acoustic identity evidence; automatic acoustic continuity remains a separate, unverified objective described in [the continuity plan](ACOUSTIC-SPEAKER-CONTINUITY.md).
- A paused position retains source attribution, but the visible avatar highlight requires active playback; the position-specific label is visually hidden. The central caption normally omits the speaker name for a single attributed caption. Together these make the current speaker difficult to find while paused. Distinguish position attribution from live speech, preserve all overlapping speakers and expose unknown or unconfirmed identity honestly.
- The current central caption fragment has a `data-current` marker used for scrolling, but no dedicated visible emphasis in the immersive CSS. The transcript does visibly emphasize the fragment. Any improvement must use only supplied source timing and avoid layout jitter or invented word timing.
- The desktop roster scrolls when it exceeds its height limit, but does not follow the attributed speaker. An active avatar can therefore be outside the visible roster. The fixed 92px desktop avatars and wrapping roster compete with caption space; mobile removes the roster height limit and needs actual small-screen evaluation.
- The transcript follows the first current caption during overlap; the central caption scroll also targets the first current fragment. Other concurrent evidence can be outside the visible area. Preserve all overlapping source fragments and make their availability understandable.
- Pointer down, wheel, touch movement and any keydown within the transcript suspend following; selecting a timed row seeks but leaves follow suspended. Clarify the state and test keyboard browsing and resumption without stealing focus. Untimed entries appear after each timed window and have separate pagination, making discovery and navigation less obvious.
- The single status text can say `Unknown speaker` when known and unknown attributions overlap, without describing both. The visible stage does not distinguish confirmed names from unconfirmed labels. Playback status changes have no explicit live announcement in this view; assess useful, non-intrusive announcements with real assistive technology.
- A failed play-button request sets a local alert that is cleared on a later successful immersive toggle or re-entry, not explicitly on every possible recovery path. Reproduce any stale-alert scenario before changing error handling.

### Risks requiring reproduction or measurement

- Stress the 40-caption window with long, heavily overlapping intervals: its anchor is the first active caption, so other active captions may fall outside the rendered window. Verify access to all source evidence without inventing timing or dropping overlap.
- Measure current/context/window scans on representative long transcripts and devices, including near the supported aggregate limit. Bounded rendered rows do not alone establish bounded per-update work or acceptable responsiveness.
- Check long captions and active-fragment visibility in the mobile layout, where the outer content scrolls and the caption container is no longer a bounded scroll area. Test portrait, landscape, large text, safe areas and the persistent controls.
- Exercise rapid native fullscreen entry, denial, exit and re-entry, including browser-initiated exit and component teardown. Verify final fullscreen state, focus and scroll restoration. These are race risks, not reproduced failures.
- Test focus when automatic windows change after seeks, and verify overlapping rows, keyboard navigation and follow resumption with real screen readers. The control bar's position is updated in coarse 0.25-second buckets; measure the effect on 15-second skips before characterizing it as a user-visible defect.

The screenshot alone cannot establish touch-target dimensions, contrast compliance or the meaning of the green outline on the Captions button: the interface also uses a visible focus outline. Existing synthetic tests and the local 19-speaker layout regression are evidence only when run and do not establish real-device usability or recognition accuracy.

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
