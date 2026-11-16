# Scoped literal-style exceptions

Reviewed source scope for the DS01 implementation checkpoint. This register describes the retained literals; it does not add checker exclusions or establish complete behavioral acceptance. Remaining verification is tracked in `VALIDATION.md` and `../task.md`.

`src/style.css` and `src/theme.css` remain the authoritative primitive and semantic-token sources. Functional controls, captions, focus/selection states, active-speaker status rings, surfaces and local layers must consume their owning roles. Shared numeric values alone do not establish shared semantics.

The following literals remain counted by the static SSOT ratchet. No whole file or component is exempt. Every entry applies only to the listed selector, at-rule context and property. New literals still require review and cannot increase any per-file/per-rule baseline.

## Decorative illustration

Illustrated onboarding marks, ambient/table/puck surfaces and decorative avatars retain their authored shapes and paint. SpeakerAvatar is aria-hidden presentation, not an identity signal. Active-speaker status-ring shadows are functional roles and are excluded from this category.

Reviewed candidate scope: 57 declarations / 92 counted units.

| Source | Selector or source unit | At-rule context | Property |
| --- | --- | --- | --- |
| `src/style.css` | `.art-ring` | `Base` | `border-radius` |
| `src/style.css` | `.art-ring:after` | `Base` | `border-radius` |
| `src/style.css` | `.art-document` | `Base` | `border-radius` |
| `src/style.css` | `.art-document` | `Base` | `box-shadow` |
| `src/style.css` | `.art-document` | `Base` | `z-index` |
| `src/style.css` | `.small-mark` | `Base` | `border-radius` |
| `src/style.css` | `.wave-bars i` | `Base` | `border-radius` |
| `src/style.css` | `.art-line` | `Base` | `border-radius` |
| `src/style.css` | `.art-check > span` | `Base` | `border-radius` |
| `src/style.css` | `.floating-label` | `Base` | `z-index` |
| `src/style.css` | `.floating-label` | `Base` | `border-radius` |
| `src/style.css` | `.floating-label` | `Base` | `box-shadow` |
| `src/style.css` | `.floating-note` | `Base` | `z-index` |
| `src/style.css` | `.floating-note` | `Base` | `box-shadow` |
| `src/style.css` | `.floating-note` | `Base` | `border-radius` |
| `src/style.css` | `.immersive-stage::before` | `Base` | `z-index` |
| `src/style.css` | `.immersive-stage::before` | `Base` | `background` |
| `src/style.css` | `.immersive-avatar` | `Base` | `border-radius` |
| `src/style.css` | `.immersive-avatar` | `Base` | `background` |
| `src/style.css` | `.immersive-avatar` | `Base` | `color` |
| `src/style.css` | `.immersive-avatar` | `Base` | `font-size` |
| `src/style.css` | `.immersive-table-speakers::before` | `Base` | `z-index` |
| `src/style.css` | `.immersive-table-speakers::before` | `Base` | `border` |
| `src/style.css` | `.immersive-table-speakers::before` | `Base` | `border-radius` |
| `src/style.css` | `.immersive-table-speakers::before` | `Base` | `background` |
| `src/style.css` | `.immersive-table-speakers::before` | `Base` | `box-shadow` |
| `src/style.css` | `.immersive-table-speakers[data-count="4"]::before` | `Base` | `z-index` |
| `src/style.css` | `.immersive-table-speakers[data-count="4"]::before` | `Base` | `background` |
| `src/style.css` | `.immersive-table-speakers[data-count="4"]::before` | `Base` | `box-shadow` |
| `src/style.css` | `.immersive-table-speakers[data-count="4"]::after` | `Base` | `z-index` |
| `src/style.css` | `.immersive-table-speakers[data-count="4"]::after` | `Base` | `border` |
| `src/style.css` | `.immersive-table-speakers[data-count="4"]::after` | `Base` | `border-radius` |
| `src/style.css` | `.immersive-table-speakers[data-count="4"]::after` | `Base` | `background` |
| `src/style.css` | `.immersive-table-speakers[data-count="4"]::after` | `Base` | `box-shadow` |
| `src/style.css` | `.immersive-table-speakers[data-count="4"][data-glow-seat]::after` | `Base` | `background` |
| `src/style.css` | `.immersive-table-puck` | `Base` | `border` |
| `src/style.css` | `.immersive-table-puck` | `Base` | `border-radius` |
| `src/style.css` | `.immersive-table-puck` | `Base` | `background` |
| `src/style.css` | `.immersive-table-puck` | `Base` | `box-shadow` |
| `src/style.css` | `.immersive-table-puck span` | `Base` | `border-radius` |
| `src/style.css` | `.immersive-table-puck span` | `Base` | `background` |
| `src/style.css` | `.immersive-table-speakers[data-count="4"][data-glow-seat] .immersive-table-puck` | `Base` | `border-color` |
| `src/style.css` | `.immersive-table-speakers[data-count="4"][data-glow-seat] .immersive-table-puck` | `Base` | `box-shadow` |
| `src/style.css` | `.immersive-table-speaker .immersive-avatar` | `Base` | `font-size` |
| `src/style.css` | `.immersive-avatar` | `@media (max-width: 1000px)` | `font-size` |
| `src/components/SpeakerAvatar.tsx` | `decorative colors/hair arrays` | `Base` | `color: #dcebd5` |
| `src/components/SpeakerAvatar.tsx` | `decorative colors/hair arrays` | `Base` | `color: #ede2ef` |
| `src/components/SpeakerAvatar.tsx` | `decorative colors/hair arrays` | `Base` | `color: #f7e5cc` |
| `src/components/SpeakerAvatar.tsx` | `decorative colors/hair arrays` | `Base` | `color: #d9e9ed` |
| `src/components/SpeakerAvatar.tsx` | `decorative colors/hair arrays` | `Base` | `color: #f1dfd3` |
| `src/components/SpeakerAvatar.tsx` | `decorative colors/hair arrays` | `Base` | `color: #e5e2c9` |
| `src/components/SpeakerAvatar.tsx` | `decorative colors/hair arrays` | `Base` | `color: #415b49` |
| `src/components/SpeakerAvatar.tsx` | `decorative colors/hair arrays` | `Base` | `color: #6b5043` |
| `src/components/SpeakerAvatar.tsx` | `decorative colors/hair arrays` | `Base` | `color: #5f536c` |
| `src/components/SpeakerAvatar.tsx` | `decorative colors/hair arrays` | `Base` | `color: #455f6a` |
| `src/components/SpeakerAvatar.tsx` | `decorative colors/hair arrays` | `Base` | `color: #866049` |
| `src/components/SpeakerAvatar.tsx` | `decorative colors/hair arrays` | `Base` | `color: #786b4c` |

## Physical circular geometry

A 50% radius defines a circular dot, avatar, transport control or slider thumb. It is geometric intent rather than a reusable surface-corner scale; colors, status shadows and layers on those elements are not included.

Reviewed candidate scope: 10 declarations / 10 counted units.

| Source | Selector or source unit | At-rule context | Property |
| --- | --- | --- | --- |
| `src/style.css` | `.status-dot` | `Base` | `border-radius` |
| `src/style.css` | `.eyebrow > span:not(.pill)` | `Base` | `border-radius` |
| `src/style.css` | `.immersive-table-speaker[data-active="true"] .immersive-avatar::after` | `Base` | `border-radius` |
| `src/style.css` | `.play-button` | `Base` | `border-radius` |
| `src/style.css` | `.processing-indicator` | `Base` | `border-radius` |
| `src/style.css` | `.back-to-top` | `Base` | `border-radius` |
| `src/style.css` | `.playback-active-speakers .speaker-avatar.large` | `Base` | `border-radius` |
| `src/style.css` | `.chat-avatars .speaker-avatar` | `Base` | `border-radius` |
| `src/style.css` | `.player-progress::-webkit-slider-thumb` | `Base` | `border-radius` |
| `src/style.css` | `.player-progress::-moz-range-thumb` | `Base` | `border-radius` |

## Mobile input minimum

The listed responsive font-size declarations retain a fixed 16px minimum to avoid iOS input zoom. This does not exempt desktop reading text or establish physical-iOS acceptance.

Reviewed candidate scope: 5 declarations / 5 counted units.

| Source | Selector or source unit | At-rule context | Property |
| --- | --- | --- | --- |
| `src/features/memo-reading.css` | `.memo-document .memo-item textarea` | `@media (max-width: 600px)` | `font-size` |
| `src/features/SpeakerPlayback.css` | `.playback-transcript-head .live-caption-head select` | `@media (max-width: 600px)` | `font-size` |
| `src/style.css` | `.immersive-search input` | `@media (max-width: 1000px)` | `font-size` |
| `src/style.css` | `.immersive-control-row select` | `@media (max-width: 600px)` | `font-size` |
| `src/style.css` | `.playback-stage .live-caption-head select` | `@media (max-width: 600px)` | `font-size` |

The candidate total is 107 counted units across 72 declarations. Multiple colors and a shadow can contribute more than one unit. Keep this rationale separate from the mechanically reviewed per-rule counts in scripts/ssot-baseline.json.
