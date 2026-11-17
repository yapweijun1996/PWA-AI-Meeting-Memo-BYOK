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
- Live acceptance is recorded after deployment; local results alone do not
  establish the published artifact or its runtime behavior.

The original recording and browser's private IndexedDB were not available to
this checkout. The reproduction uses source-faithful synthetic timing and
text through the actual UI; it does not measure speaker-recognition accuracy.

## 2. Sentence-shaped source inspection

Pending implementation. The transcript already groups fragments into readable
sentences. The reported word-per-row layout occurs when source details expand
each fragment into a full repeated speaker/action card. Keep original source
fragments and citations; improve inspection rather than merging stored words.

## 3. Playback layout hierarchy

Pending implementation. Scope: standard speaker header size, immersive
participant table, subtitle-card proportions, controls and typography, including
narrow layouts. Use existing components and semantic tokens; retain truthful
current/retained/unknown attribution and keyboard controls.
