# Shared UI component contracts

Status: DS04 includes a runnable synthetic [actual-component catalogue](../catalogue/main.tsx), with an independent local build and Chromium/WebKit interaction tests. Repository npm/type/lint/CI integration and release verification are recorded in [validation](VALIDATION.md). TypeScript source owns exact prop types. This document owns usage and interaction contracts, not copies of implementation; automated checks do not replace real assistive-technology acceptance.

| Component / owner | Inputs and variants | Interaction and accessibility contract |
| --- | --- | --- |
| `Modal`, `src/components/ui.tsx` | `title`, `onClose`, children, optional class name | Wrap the native dialog; keep Escape/cancel and native or marked initial focus. After unmount, restore the previously focused opener without scrolling only if it remains connected and no other valid focus, explicit inert ancestor or competing open dialog prevents it. StrictMode replay cancels obsolete restoration. Feature-owned focus choices take precedence. Global operation errors remain visible alerts; preserve unsaved work before closing. |
| `Brand`, `src/components/ui.tsx` | Standard and `small` variants | Shared brand and localized tagline. Do not copy brand markup into views. |
| `Empty`, `src/components/ui.tsx` | Title and explanatory children | Describe the actual empty state and expose the relevant next action. Do not manufacture meeting content or workflow metrics. |
| `Pill`, `src/components/ui.tsx` | `neutral`, `green`, `sand`, `danger`, `light` | Noninteractive status text. Use paired semantic foreground/background roles; do not turn a span into an unlabeled control. Color supplements the visible status. |
| `TooltipLayer`, `src/components/TooltipLayer.tsx` | One application layer; triggers use `data-tooltip` | Supports pointer and keyboard-focus hints, an accessible description, Escape and scroll dismissal. Touch is not a required discovery mechanism. Controls still need their own accessible names. Do not mount a layer per button. |
| `ToastLayer` / `showToast`, `src/components/ToastLayer.tsx` | One active message, localized dismissal | Polite status feedback with bounded automatic dismissal. Persistent operation failures belong at their point of action; do not hide recovery instructions in a disappearing toast. |
| `SpeakerAvatar`, `src/components/SpeakerAvatar.tsx` | Deterministic default by label, optional local image and class name | Decorative illustration: hidden from assistive technology and empty image alt text. Adjacent text owns the speaker name and confirmation state. Artwork, image and palette position never establish acoustic or real-person identity. |
| `LoadingPlaceholder`, `src/components/LoadingPlaceholder.tsx` | `library` / `meeting`, accessible label | Use only while actual local data loads. Announce status; hide decorative skeleton shapes. Do not use a perpetual skeleton to disguise a failed read. |
| `MemoEditorField`, `src/features/MemoEditorField.tsx` | Label/value, disabled, failure text, tools, autofocus, heading/bullet text, save/dirty/selection callbacks | Source-bound paragraph editor with debounce and blur/unmount flushing. Preserve the draft on save failure; keep dirty/error markers used by backup/update protection. Selection and formatting must preserve native keyboard editing. Do not silently replace human text after a source revision changes. |

## Related shared owners

`useSpeakerAvatars(meetingId)` owns meeting-local image loading and unavailable/stale state. Pure catalogue examples should render `SpeakerAvatar` directly, without opening a meeting image database. The application owns image persistence, deletion, backup and restore; the decorative renderer does not.

`speakerBackground(index)` owns the five token-based presentation slots. Slot selection follows list order and must not be used as an identity-matching signal. `useBackToTopPosition(visible)` measures persistent-player geometry; the application owns when the control appears. Neither helper should become a second workflow or playback-state store.

## Usage boundaries

Use the existing native dialog and disclosure semantics where they provide the tested behavior. DS03 separately owns consolidation of repeated interactive controls; this inventory does not imply that a universal Button, Field or Tabs API already exists. Do not merge `MemoDateField` into a text editor solely to make the inventory shorter.

The runtime application mounts the shared tooltip and toast layers once. Transient success and loading states must correspond to real state transitions. Errors, unsaved drafts, source revisions and confirmation remain owned by their feature; shared presentation must not hide or overwrite them.

Dialog invokers own identifying their trigger. Keyboard activation naturally focuses it; a pointer invoker that needs the same guarantee can focus `event.currentTarget` before opening, as the catalogue does. `Modal` does not infer a mouse target when the browser left focus on the body. A feature may explicitly choose another return target, such as the source-evidence control, without duplicating the default fallback. The catalogue no longer maintains a separate restoration effect.

## Run and verify the catalogue

Use `npm run catalogue:build` to type-check and build the developer reference, `npm run catalogue:preview` to open its static preview on port 4183, and `npm run test:catalogue` for its independent Playwright configuration. Output goes to ignored `private-fixtures/catalogue-dist`, outside the normal `dist` publication artifact; there is no application navigation entry or production catalogue route.

The catalogue imports the actual components, uses synthetic local callbacks and demonstrates variants, disabled/loading/error states and keyboard interactions. It does not initialize provider keys, create meetings or call providers. Tests monitor initial navigation and reload, check empty IndexedDB, retain failed drafts, verify focus restoration and cover both installed browser engines. The screenshot set covers 1440x900, 768x1024 and 390x844 plus mobile loading/error/modal states. These checks remain distinct from real screen-reader, phone, complete contrast and production workflow acceptance.
