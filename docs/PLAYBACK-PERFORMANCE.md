# Synthetic playback measurements

Date: 2026-11-16. These are bounded software measurements on one Apple M4 virtual machine with 6 GiB of guest-visible memory. They do not establish physical-phone support, real audio synchronization, recording-duration limits or voice quality. The checklist's combined performance/device acceptance remains open.

## Reproduce

Use the pinned Node 22.23.3 runtime and locked dependencies:

```bash
npm run --silent benchmark:playback > projection.json
npm run build
npx playwright test tests/browser/playback-performance.spec.ts --workers=1 --output=private-fixtures/playback-benchmark
```

`benchmark:playback -- --quick` exercises three 1,000-source cases. The default measures 1,000 / 5,000 / 20,000 sources with sequential speech, 100 simultaneous captions, and long fragments. It accepts no recordings, paths or provider credentials. Its JSON identifies the projection source with SHA-256. The browser cases generate their own local backup and synthetic WAV, block external HTTPS requests and compare source digests before/after navigation. No paid request or model download is involved.

Inspect the recorded [projection data](benchmarks/playback-projection-2026-11-16.json) and [browser data](benchmarks/playback-browser-2026-11-16.json). The latter includes measured source checksums and the proposed caption scroll change; rerun after changing the implementation or environment rather than assuming these numbers still apply.

## In-process projection

Preparation builds captions and playback boundaries. Each query performs the same active/context/previous-caption, relevant-label and 40-row-window derivations used by the view. The timings exclude DOM, painting, storage and audio. Two hundred queries follow ten warm-ups per case. At 20,000 sources:

| Case | Preparation, ms | Median query, ms | p95 query, ms | Maximum query, ms |
| --- | ---: | ---: | ---: | ---: |
| Sequential | 10.24 | 0.4367 | 0.6756 | 0.7613 |
| 100-caption overlap | 7.08 | 0.4389 | 0.6248 | 0.6553 |
| Long fragments | 22.37 | 0.4505 | 0.6899 | 0.8626 |

Every caption was reachable through bounded manual windows. A 40-row transcript window does **not** contain every active caption under large overlap: the measured 100-caption case had up to 80 active captions outside that centered window. The separate current-caption region and relevant-label set retain all overlap, and transcript paging/search provide access to the complete source. A bounded transcript list is not a whole-DOM resource guarantee for arbitrary simultaneous input.

## Browser projection and source access

Eight cases passed in Chromium 156.0.8078.4 and WebKit 27.2 with one Playwright worker. Each used 20,000 stored fragments, 100 speaker labels, 100 simultaneous attributed passages plus one unknown passage, then a separate 17,435-character caption. The input has a synthetic timeline of about 83 minutes; **the attached WAV is two seconds and media time/duration are controlled by the fixture**. This is not an 83-minute recording or decoder acceptance test.

Each case takes eleven seek samples. The following interval runs from dispatching the synthetic seek event to the second animation-frame callback. It includes scheduling/render/layout work and two-frame waiting; it is neither audio-to-caption latency nor a frame-rate measurement. Shared host load was not controlled. With eleven samples, report median and maximum rather than a quality score:

| Engine | Viewport / preference | Median, ms | Maximum, ms |
| --- | --- | ---: | ---: |
| Chromium | 1440x900 / normal | 39.7 | 162.1 |
| Chromium | 768x1024 / normal | 53.5 | 144.6 |
| Chromium | 390x844 / xxlarge | 99.1 | 223.0 |
| Chromium | 844x390 / xxlarge | 51.3 | 174.8 |
| WebKit | 1440x900 / normal | 41 | 108 |
| WebKit | 768x1024 / normal | 37 | 144 |
| WebKit | 390x844 / xxlarge | 38 | 122 |
| WebKit | 844x390 / xxlarge | 39 | 94 |

The transcript stayed at or below 40 rendered rows. The measured maximum immersive subtree contained 1,731 elements, including all 101 current captions and all 100 known labels plus unknown attribution. Search reached fragment 20,000 and seeking used its exact source start. Sources/labels retained identical digests and processing history stayed empty. Footer bounds and horizontal overflow checks passed. These observations apply to this fixture, not every possible combination of the schema's limits.

## Caption scroll recovery

The initial test incorrectly assumed the caption box always owned scrolling; tablet/landscape layouts instead use an ancestor. The final regression uses actual wheel events over the visible caption text and checks the end marker against every clipping ancestor **within the fixed immersive surface**. It does not force `scrollIntoView` or assign a hidden ancestor's scroll position to manufacture a pass.

That stronger reproduction found a real input trap: the caption box had zero scroll range but `overscroll-behavior: contain` intercepted wheel chaining to an ancestor with a 4,505-pixel total scroll range. Three wheel gestures left that ancestor at the same position and the final source line outside the visible region. Changing the inner caption to `overscroll-behavior: auto` lets responsive scroll ownership work normally; the enclosing caption/stage containment remains. All eight browser cases then reached the exact end marker with ordinary wheel events, including both orientations and the long-text case. The fix changes no transcript text, timing, speaker identity or playback clock.

## Remaining acceptance

All measured safe-area insets were **zero**. Nonzero phone insets, browser/OS chrome, physical rotation, installed launch, suspension, touch gestures, real screen readers and real audio output remain unrun. The xxlarge preference and Extra large caption selection were exercised, but the existing long-caption fitting used a **16px** content floor in every case; these results do not certify large-font or zoom accessibility. Memory, storage and duration limits for real phones and near-64-MiB meeting records remain unmeasured. No literal unlimited-input claim or physical-device readiness percentage follows from these tests.
