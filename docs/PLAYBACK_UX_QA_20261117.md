# Playback and source-reading UX corrections

The owner requested three sequential changes, with local verification, an
individual main push, and live deployment after each change. Preserve the
existing meeting originals, IDs, revisions, timing, speaker attribution,
correction/undo, and browser-only storage and provider consent boundaries.

## 1. Stable avatar across caption boundaries

The standard playback stage removed a speaker's avatar during short pauses
between captions. `captionContextAtTime` only covered gaps within one caption;
the 220-character readability boundary could split the same turn and leave a
100 ms gap with neither a current caption nor retained context.

The correction extends the existing 350 ms inactive-context rule to adjacent
captions with the same nonempty speaker IDs. It does not extend active speech,
word highlighting or source timestamps. Changed/unknown attribution, overlap
and longer silence retain their existing behavior. The shared domain helper
also supplies immersive playback; no new animation timer or storage change is
introduced.

Evidence from the clean `af728a7` worktree:

- Before: the added unit regression failed at the empty context; the Chromium
  UI regression failed because the avatar DOM node disappeared at 0.75 s.
- After: 17 focused domain/boundary tests and six Chromium/WebKit playback
  cases passed. The avatar keeps its DOM node through the pause and the next
  caption; active speech remains absent during the gap and source data is equal.
- Full unit suite: 509 passed. Lint, type/build, SSOT and artifact checks passed.
- Full Chromium/WebKit browser suite: `PLAYBACK_UX_SCREENSHOTS=1 npm run test:e2e`
  passed 575 tests, with three existing browser-specific skips (13.9 minutes).
- The manager and independent UI advisor inspected the 1440 px and 390 px
  retained-context screenshots: APPROVE for the avatar correction.
- Released as `53157ddd4ac6b9e110068663f016639b16395753` to `main`.
  Pages run `44064811145` passed. The live JavaScript bundle contains that exact
  build ID, and the same avatar DOM-retention browser case passed against
  `https://yapweijun1996.github.io/PWA-AI-Meeting-Memo-BYOK/`. The live case
  uses a synthetic media clock and proves UI behavior, not native decoding.

The original recording and browser's private IndexedDB were not available to
this checkout. The reproduction uses source-faithful synthetic timing and
text through the actual UI; it does not measure speaker-recognition accuracy.

## 2. Sentence-shaped source inspection

The transcript already groups fragments into readable sentences. Expanded
source details repeated a complete speaker/action card for every original word.
They now present inline, keyboard-selectable fragments with the existing
English/CJK separator rules and one selected fragment inspector. Inspection
does not modify stored fragments or bulk selection. Citation navigation selects
the exact source ID; correction, split, review and undo retain their existing
contracts. Single-fragment groups retain their existing editor.

- Before: the browser regression reproduced four repeated cards for one sentence.
- After: eight focused Chromium/WebKit cases passed, including exact editing,
  split/undo, source citation, unchanged source data during inspection, and
  80 CJK fragments with keyboard navigation and WCAG AA checks on a phone.
- Build/type checking, lint, SSOT and all 509 unit tests passed.
- Two test-harness defects were corrected during verification: a dangling
  original-note source reference and an exact wrapped-label query. The production
  validation and editor were not weakened.
- Initial full browser run: 578 passed, three browser-specific skips, one
  existing sidebar tooltip failure. Instrumentation reproduced it in one of
  five unchanged runs: a delayed pointer exit from the sidebar toggle cleared
  the focused Confirm update tooltip. A deterministic pointer-exit check also
  reproduced the missing accessible description. The shared tooltip now only
  clears on an exit from its own trigger, when that trigger is not focused.
  Escape and scroll dismissal remain unchanged. The regression retains the
  original assertions and adds accessible-description checks.
- The manager and independent advisor approved actual desktop (1440 px) and
  phone (390 px) screenshots. The mobile test clicks Edit on fragment 80,
  verifies its exact content, closes without saving and verifies unchanged data.
- After the tooltip correction, 22 focused Chromium/WebKit cases passed.
  Build, lint, SSOT, artifact checks and the 509-unit-test suite passed again.
- `npm run test:pwa` passed in Chromium and WebKit: N to N+1 updates,
  active-request/editor protection, saved drafts, old-asset and unrelated-cache
  handling, visible activation failure and forward recovery.
- Final pre-integration browser run: 579 passed, three browser-specific skips,
  no failures (11.5 minutes). Remote main advanced with separate Pi recovery
  changes during this run. Rebased without conflicts onto `4d15128` and retained
  those changes. The integrated build, lint, SSOT and artifact checks passed,
  along with 519 unit tests and 215 relevant Chromium/WebKit cases (three
  browser-specific skips) across speaker review, workspace, sidebar confirmation,
  Pi agent review and saved-final recovery. Live release evidence follows below.

## 3. Playback layout hierarchy

Pending implementation. Scope: standard speaker header size, immersive
participant table, subtitle-card proportions, controls and typography, including
narrow layouts. Use existing components and semantic tokens; retain truthful
current/retained/unknown attribution and keyboard controls.

## Verification scope and recovery

The applicable PWA profile is STATIC_OFFLINE: local recordings, transcripts,
review and correction remain browser-local; provider requests require the
existing online BYOK/consent flow. This change does not alter the worker,
IndexedDB schema, key persistence or request authorization. Existing scoped
cache, draft-safe update and static-publication checks are reused rather than
replacing the worker with another project's implementation.

Browser evidence covers automated Chromium and WebKit on macOS plus responsive
viewport checks. Physical iOS/Android installed mode and VoiceOver are NOT_RUN;
field Core Web Vitals are NOT_VERIFIED. These UI corrections do not establish a
whole-product PWA certification or recognition-quality score. No new real
provider requests, private recordings or stored credentials are used in tests.

Rollback uses a normal revert of the individual UI commit on current main,
followed by the same verification and Pages publication. Preserve subsequent
unrelated commits and browser-local data; do not force-push or reset IndexedDB.
