# Screenshot-driven UI follow-up

Scope: the owner's sidebar, confirmation, Settings and Evidence Review screenshots. The owner authorized implementation, automatic verification and main publication, with human checking after delivery. One read-only advisor reviewed the initial causes and final implementation; the implementation owner runs the browser/release checks. The advisor's review is static, not independent runtime or physical-device acceptance.

## Delivered behavior

- Sidebar storage text stays on one line and uses a container-relative font token. The visible English copy is shortened to “Saved locally on this device”; the complete storage explanation is available through keyboard/pointer tooltip and accessible text. A storage icon replaces the orphan dot in the collapsed rail. Only one information divider remains; update/Cancel behavior and ordinary bottom anchoring are preserved. Large user text is not shrunk below its preference to force a fit: extreme widths can ellipsize the visible label. Short screens with maximum text allow the sidebar to scroll so controls remain reachable. Empty recent-list guidance is hidden on short screens rather than overlapping footer actions.
- The three provider-consent/retry labels reuse the existing checkbox pattern, with a nonshrinking checkbox beside the first line and wrapping explanatory text. No paid-attempt authorization or retry logic changes.
- Memo output-language display names are localized separately from provider instructions. Current and legacy selective-review capacity errors receive fixed Chinese translations, retaining the distinction between an unsent request and an unsaved received response. Unknown user/provider content is not translated. Both the modal error slot and inline plan errors use the application message translator.
- Settings has Appearance, API & models, Storage and About tabs. Storage owns the existing local-storage, read-only monitor and speaker-cache panels; About owns the existing source/build information. Credential/language drafts remain in the mounted Settings owner, and the global PWA dirty guard stays active on the new tabs. Storage/About are outside the credential form. Tabs scroll internally on narrow screens; long Settings buttons wrap instead of widening the page.
- The global alert text now occupies its flex container, with a nonshrinking dismiss button at the right edge. Alert semantics and translated error content remain.
- Evidence Review groups type/status/review guidance, sizes the editor from actual wrapped content with a two-row minimum, and places review controls before supporting original/source evidence. Preview and citation controls have separate layout rows; previews use two columns on wide screens and one on phones. Original output, editor callbacks, touch/blur guards, source grouping and 3/15/20-fragment paging are preserved.

## Reproduction and bounded evidence

Use the repository's Node 22.23.3 version and existing project dependencies. Tests use isolated profiles and synthetic meetings, keys and recording-free fixtures. They do not read the owner's browser profile.

```bash
npm run build
npx playwright test tests/browser/ui-followup.spec.ts tests/browser/ui-followup-acceptance.spec.ts --workers=1
npm run test:unit
npm run lint
npm run check:ssot
npm run check:artifact
npm run test:pwa
```

Baseline Chromium observations reproduced two status-text lines, a checkbox 17px away from its text's first line, a left-positioned dismiss control and an oversized short wide editor. After the repair, the same short editor measured 86px instead of 133px at the same 1440px viewport; this is one fixture, not a universal size reduction. The first restore-based probes were blocked by the fixture's native confirmation, so synthetic restore consent was supplied before measuring those defects. Both failed setup and actual red results were retained.

The first expanded acceptance run found a real 320px/maximum-font English Settings button overflow; bounded wrapping repaired it. Chinese collapse selectors initially used the wrong translated label and were corrected. A later scroll assertion wrongly required overflow even when shorter Chinese text fit; the final check measures the actual scroll range, uses real wheel input when needed and verifies return to the top. It does not force hidden scroll positions to manufacture visibility.

**PASS:** 472 unit tests in 64 files, types/build, lint, SSOT 107 and artifact checks. The focused existing/new surface run passed 38 cases. Eight expanded Chromium/WebKit cases passed: English/Chinese, 320/390/768/1440px, maximum text, keyboard Home/End, hidden panels and drafts, footer tooltips and wheel reachability, Chinese capacity refusal and 85-source paging/edit/reload. A generated approximately 20 MB history triggers the real pre-request capacity refusal; the test asserts no outside request. These are desktop-hosted browser layouts, not physical phones. The final full regression adds explicit persisted-source/original checks after the human edit.

Whole-suite, final PWA and hosted identity results are recorded in [validation](VALIDATION.md) after execution. The theme matrix includes the new Storage/About surfaces; contrast incompletes still require their separate review. Physical devices, real screen readers, actual provider/model/account behavior, billing reconciliation and recording/voice quality remain unverified by this UI work.

## Owner's final check

Save open drafts before accepting an available PWA update. Check the expanded/collapsed footer, the four Settings tabs and preserved drafts, then open an existing memo's Evidence Review to inspect reading, review controls, originals and source navigation. A generation confirmation can be inspected and cancelled to check layout and language without authorizing a provider request. Human visual acceptance remains with the owner.

The first whole-application candidate completed 498 cases: 487 passed, eight failed and three were skipped. Two stale fixture expectations still required an English language label in Chinese UI and build information inside the old Settings grid; they now follow the intended localized label and About tab, retaining provider-instruction assertions and long-build overflow checks. The other two failure types exposed excessive hiding of the empty recent region; only its explanatory hint is now hidden, retaining the recent-list region, links and normal anchored-footer behavior. Each failure type reproduced in both engines.

A further advisor-requested maximum-text check reproduced a WebKit-only update-confirmation failure: the sidebar returned to scrollTop zero, placing Cancel at y598 outside the 568px viewport. The update component now reveals the complete action group only within an actually scrollable sidebar, and reveals the opener after Cancel. It preserves prevent-scroll focus and ordinary banner/page position. All 18 final related update/layout cases passed, including full button bounds, real wheel input, Cancel focus, no activation, new-tab draft guards, localized refusal and complete source paging. This is a production visibility correction, not a test-only forced hidden scroll.

## Final automatic verification

Final full suite: **500 collected, 497 passed, three existing skips, zero failures**, in 8.8 minutes. Both real-worker PWA update/recovery runs passed. Unit and fast gates above passed. The expanded theme matrix passed 60 cases / 528 scans, with 192 contrast-incomplete engine/state entries across 41 distinct targets requiring manual review. These results supersede the failed candidates without closing physical-device, provider, voice-quality or manual-contrast acceptance.
