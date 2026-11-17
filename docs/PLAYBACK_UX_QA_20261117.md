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
  Pi agent review and saved-final recovery.
- Released as `3f59da120d0ffc9299176d18876a7a9ce925e201`. Pages run
  `44070506270` initially failed during ONNX dependency download with ETIMEDOUT;
  one rerun completed verification and publication without code/dependency/gate
  changes. Live bundle identity matched, and four real-site browser cases passed
  for the avatar, sentence review/undo, exact edits/citations and mobile CJK edits.

## 3. Playback layout hierarchy

Standard playback avatars grow from 26 to 44 px with a clearer name/status
hierarchy. Immersive table surfaces use existing semantic theme roles, omit the
decorative puck, and retain four-seat geometry and truthful source-driven active
rings. Spacious desktop reading cards have a stable 180–240 px budget rather
than filling all remaining height. Tablet/mobile and low-height scrolling rules
remain intact. Fullscreen and immersive-exit icons are distinct; layout choices
are grouped, and transcript paging gets clear directional controls.

The pre-change layout regression failed at the 26 px avatar. Added responsive
Chinese UI cases cover light/dark themes at 1440, 768 and 390 px, source-data
preservation, accessible controls, phone reading-panel reachability and WCAG AA
checks. Verification and independent screenshot results follow execution.

- The initial 12 responsive cases passed. Screenshot review found an orphaned
  Chinese attribution character on phones and a width slider with no effect in
  the stacked tablet layout. New assertions reproduced both defects; a smaller
  badge inset and the correctly scoped tablet selector fixed them.
- The wider regression run found the existing 1280 x 720 long-caption case
  failing in both engines: taller controls left 39 px for 43 px of text at the
  16 px minimum. A short-desktop-only 8 px stage gap restores space without
  shrinking text or moving seats. All 30 focused browser cases then passed,
  including that original assertion, fixed seats and caption-layout stability.
- The manager and independent advisor inspected final light/dark screenshots at
  1440, 768 and 390 px: PASS. No blocking visual issue remains in those captures.
- Build, lint, SSOT, artifact checks and 519 unit tests passed before integrating
  concurrent speaker-review and playback-follow fixes from main. The lowered
  SSOT baseline records removed decorative literals; no allowance was raised.
- Rebased onto `64d1801` without conflicts, preserving the concurrent speaker
  review and playback-follow corrections. The integrated build, lint, SSOT,
  artifact and 519-unit-test checks passed. All 37 shared-component browser
  cases and Chromium/WebKit PWA update/recovery checks passed.
- The first full integrated browser run had 604 passes, three existing WebKit
  skips and one native-clock probe failure. Isolated repetition still failed
  three of five times. Instrumentation established an observation-order defect:
  the probe read the previous highlight, then the correct DOM mutation occurred
  0.9–2.3 ms later in the same rendering turn. Other runs observed the mutation
  before the probe. No playback clock or boundary implementation was changed.
- The probe now reads actual media time and DOM synchronously in one next-task
  observation after each animation frame. It never polls for a matching word,
  and rejects observations crossing into a later frame in the measured window.
  The original frame count, mismatch ratio, 120 ms residual and seven-second
  deadline remain. This measures completed-frame synchronization, not a hard
  wall-clock audio-to-paint latency guarantee. Independent review approved it.
- Temporary negative controls correctly failed the unchanged mismatch assertion:
  frozen highlights mismatched 29/29 observations; one-word lag mismatched 35/35.
  These controls were removed from the test after verification. The first lag
  experiment hit the frame guard during unmeasured startup, so the guard was
  scoped to the same measured interval as the original assertions before the
  successful negative-control experiment.
- A guarded repeat performed alongside lint/type checking had nine passes and
  one explicitly rejected cross-frame observation. The default Playwright suite
  now isolates the native-clock gate in `chromium-native-clock`, after both
  functional projects finish. Discovery lists 608 tests, including exactly one
  active native-clock case and the original WebKit skip. Chromium-only runs
  exclude this gate; if its dependencies fail, report it as NOT_RUN.
- The final guarded, isolated native-clock gate passed ten consecutive runs:
  `npm run test:e2e -- --project=chromium-native-clock --no-deps --workers=1 --repeat-each=10`.
  No lint, compilation or other browser workload ran alongside this measurement.
  Lint and type checking passed separately afterward. Full-suite evidence below
  uses the default dependency order rather than `--no-deps`.
- Final default suite: `PLAYBACK_UX_SCREENSHOTS=1 npm run test:e2e` passed
  605 tests with three existing WebKit skips and no failures (12.1 minutes).
  The native-clock gate ran last and passed with 37 observations, no mismatches
  and no cross-frame rejection. Fresh integrated phone and desktop screenshots
  also received independent visual approval.
- Main subsequently advanced to `4e8a413` with shared appearance and language
  controls. Rebased without conflicts and retained those changes. The new
  responsive fixture now uses the existing `changeTopbarLanguage` helper to
  operate the real menu. Build, lint, SSOT, artifact, 520 unit tests, 39 catalogue
  cases and both PWA lifecycle checks passed on this final integration.
- Final integration browser run passed **621 tests with three existing skips**
  and no failures (13.5 minutes). Selecting the nine relevant suites also
  selected the native-clock project; its dependencies expanded the run to all
  624 cases in 51 files. The final native-clock gate passed with 52 observations,
  no mismatches and no cross-frame rejection. This supersedes the earlier
  605-pass run as final source-integration evidence.

Final local commands used Node 22.22.0, within the repository's required range:

| Command | Result |
| --- | --- |
| `npm run build` | PASS: TypeScript and static production build |
| `npm run lint` / `npm run typecheck` | PASS, including the corrected probe |
| `npm run test:unit` | PASS: 520 tests |
| `npm run check:ssot` | PASS: reduced 54-unit baseline, no increased allowance |
| `npm run check:artifact` | PASS: static artifact and publication boundary |
| `npm run test:catalogue` | PASS: 39 browser cases |
| `npm run test:pwa` | PASS: Chromium and WebKit update/recovery |
| Final integration browser command below | PASS: 621; SKIP: 3 existing WebKit-specific exclusions |

```sh
PLAYBACK_UX_SCREENSHOTS=1 npm run test:e2e -- \
  tests/browser/speaker-review.spec.ts tests/browser/appearance-system.spec.ts \
  tests/browser/settings-appearance.spec.ts tests/browser/sidebar-confirmation.spec.ts \
  tests/browser/theme-matrix.spec.ts tests/browser/localization.spec.ts \
  tests/browser/workspace.spec.ts tests/browser/sidebar-check-feedback.spec.ts \
  tests/browser/theme-token-roles.spec.ts
```

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
