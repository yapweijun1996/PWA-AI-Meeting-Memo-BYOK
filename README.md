# Meeting Memo — BYOK PWA

A browser-first workspace for recordings, speaker corrections, evidence-linked meeting notes, and local backups. Bring your own OpenAI or OpenRouter keys; no companion or application server is required.

**Status:** implemented browser beta. Local automated checks cover the review, recovery, speaker-listening and source-video workflows. Real recording accuracy, paid account access, and physical-phone acceptance remain user-run gates; this is not a claim of validated diarization quality.

Live app: **https://yapweijun1996.github.io/PWA-AI-Meeting-Memo-BYOK/**. GitHub Actions builds and publishes main commits without running the automated test suite; run the checks below locally. Successful deployment and live-browser evidence are recorded in [validation](docs/VALIDATION.md).

## Use the workspace
1. Create a meeting and attach a recording up to 4 GiB. MP3 and M4A/MP4 files larger than 24,000,000 bytes are split into locally stored chunks; shorter files keep the existing path. Paste a transcript or import a Meeting Memo JSON transcript instead.
2. In **Settings & API keys**, enter your provider keys. New settings use **OpenRouter / `elevenlabs/scribe-v2`** for transcription and OpenAI for notes; existing saved selections remain unchanged. Choose the providers and models separately. Click **Save settings** to keep keys, selections and the speech rate in this browser across reloads. Saving settings makes no API request. The **Appearance** tab offers a language choice and a font preview; font changes save immediately on this device and unavailable fonts use system fallbacks.
3. Choose **Transcribe** and review the provider, recording, and estimated/unknown charge before confirming. Keep the page open.
4. Open **Speakers**. **Playback mode** presents current speaker attribution, live captions and a synchronized transcript from the recording's audio clock. Seek or change speed using the persistent player; pause retains the selected position without claiming someone is speaking. Use **Edit speakers** for longer samples, name confirmation and merge. The separate **Transcript** tab retains source corrections, reassignment, split and undo. In Playback mode, optionally expand the video reference and explicitly load YouTube for manual comparison. Unknown timing and identity stay explicit.
For chunked recordings, speaker labels are numbered independently in each part. Review matching-word suggestions from overlapping audio in **Speakers**, or select speakers and merge manually; suggestions are not voice-identity checks, and merges can be undone. The **Transcript** tab groups adjacent short fragments for reading; expand a group to inspect or edit its original fragments, or mark the group reviewed. Use the speaker filter and page controls for longer meetings.
5. Choose **Generate meeting notes**, review the selected destination and what is sent, then inspect, edit, accept, or reject each cited item. **Original generated item** shows its separately saved generated snapshot. Source changes require re-review; new generations preserve older human versions.
6. Export Markdown/TXT for the selected notes version, JSON for all meeting data without audio, or ZIP for a full backup with audio. **Restore backup** creates a separate copy.

Use **How it works → Explore a synthetic example** to try local review without a recording, key, or charge. The example contains invented text and no recorded audio or generated memo.

Playback requires local audio and supported source timing. Long MP3 chunks play as frame-aligned, roughly 60-second mono PCM WAV windows so seeking and the playback clock do not depend on VBR byte-position estimates. A brief gap of a few tens of milliseconds can occur while switching windows; decoding is limited to the current window and one prefetched next window. Caption groups improve readability without changing original source fragments; gaps and overlapping voices remain visible. Adjust caption size in Playback mode. When browsing the playback transcript manually, following pauses; use **Follow playback** to return to the current position. Long playback transcripts render a bounded window with earlier/later navigation. The local **Immersive playback** view uses the same player and falls back to an in-page view when fullscreen is unavailable; iPhone standalone and physical-device acceptance remain open. The original correction editor remains a separate full-source view. These controls synchronize existing attribution; they do not independently recognize a person's voice or verify provider accuracy.

The immersive view shows the labels attributed at the selected position, including their name-confirmation state, with the full label list available on demand. Highlighting uses the supplied source timing; untimed text remains separately accessible without a seek position. See [validation](docs/VALIDATION.md) for deployed-build evidence and remaining limits.

Immersive playback offers Focus and Reading modes without restarting audio. The transcript searches timed and untimed text, supports click-to-seek for timed results, and can return to the current position. Desktop transcript width is adjustable; tablets stack the panels and phones use a dismissible transcript sheet. When the speaker stage has keyboard focus, Space toggles playback and the arrow keys skip five seconds.

Speaker-name drafts remain protected when switching modes. Save or reset an unsaved video-reference draft before switching modes; the workspace keeps that editor open rather than silently discarding its URL or offset.

Playback now uses a sequential group-chat view: a persistent roster of all speakers above left-aligned, timestamped bubbles. Exact source fragments are highlighted inside each bubble; overlapping speakers remain visible. Clicking a bubble seeks while preserving play/pause state. Manual scrolling pauses following until **Follow playback** is selected. Untimed text is available separately under **Timing unavailable** and has no fabricated seek position. Speaker names remain editable in **Edit speakers**. The activity glyph indicates timed attribution, not independently measured speaker volume.

## What stays local

The meeting library, recordings, revisions, review history, and jobs live in this browser's IndexedDB. Encoded audio bytes and media type are stored atomically with metadata; playback reconstructs a Blob. Settings, including provider keys, are stored in a separate local IndexedDB database. The non-sensitive sidebar and font preferences use namespaced `localStorage` entries and are excluded from backups. **Keys are unencrypted** and accessible to scripts sharing this website origin and anyone with access to this browser profile. They are excluded from meeting exports, logs, service-worker caches and GitHub builds. Use **Forget keys** to remove saved keys; clearing site data also removes them and local meetings. `localhost` and the GitHub Pages address have different origins and do not automatically share or migrate keys; saving a key on either origin stores it only in that browser origin.

Offline use includes saved meetings, local playback, editing, review, and export after the app shell has been cached. Cloud AI requires a working connection. Browser background execution is not guaranteed; interrupted requests remain visible and never automatically resubmit. An unknown outcome or local cancellation may still be billable.

Optional source videos require a connection. Saving a YouTube reference does not load it; **Watch this sample** connects to YouTube's privacy-enhanced player. The local recording is not uploaded, and video references are excluded from AI input.

Browser storage is not backup or synchronization. Export a full backup regularly. The default Pages address shares its storage origin with other projects on `yapweijun1996.github.io`; namespacing prevents accidental collisions, not same-origin access. A dedicated hostname is recommended before sensitive production use.

## Processing boundaries

- Speech defaults to OpenRouter `elevenlabs/scribe-v2`, which requests speaker labels and word timestamps; one complete recording passed the local authenticated Chrome workflow with five anonymous labels, but diarization accuracy remains unscored (see [validation](docs/VALIDATION.md)). OpenAI `gpt-transcribe` provides text without established speaker/time evidence. OpenAI `gpt-4o-transcribe-diarize` is deprecated and scheduled to stop on 2027-02-26.
- Notes default to OpenAI Responses with GPT-6 Luna. Both providers offer selectable model IDs; notes require structured-output support and are validated against source IDs. OpenRouter routes data to an upstream provider and their retention policies apply.
- Provider-specific keys, selections and the speech rate persist in this browser after saving. The first update from an older version cannot recover keys that existed only in its page memory; enter and save them once. OpenRouter models and access vary by account. No provider call occurs until confirmation.
- Audio import supports recordings up to 4 GiB. Files over 24,000,000 bytes are locally chunked for MP3/MPEG and M4A/MP4; WAV, FLAC, OGG and WebM long recordings must be converted outside the browser. Chunked MP3/M4A recordings play in-app from locally stored parts and are excluded from backups; keep the original file. Chunked transcription sends one confirmed request per part sequentially, saves completed parts, and resumes only unfinished parts. Failed or unknown outcomes stop the run; unknown parts require an explicit billing review before resubmission. No provider request occurs during import.
- Each memo request is capped at 80,000 serialized characters and 8,000 output tokens. Inputs that fit retain the existing single-request path and lossless transport grouping. Longer transcripts can use a confirmed plan of at most eight extraction requests and one synthesis request. Each successful step is saved; interrupted/unknown attempts never resume automatically. Review prior billing and explicitly confirm a new paid attempt before retrying an unfinished step. Sources and generated originals remain available for human review. Oversized plans, extraction results or synthesis input stop without truncating text or silently adding requests.
- Requests time out after nine minutes; this stops waiting, not necessarily remote processing or billing.
- New memo versions preserve normalized generated items separately from human edits. Older backups without that snapshot still load, with the original explicitly unavailable. Update all open tabs before reviewing newly created memo data.
- Charges use your provider account. Speech estimates require a known duration and a user-entered rate bound to the model, with a public pricing URL and checked date; otherwise cost is unknown. OpenRouter transcription costs returned in the response are shown as provider-reported amounts; missing amounts remain unknown. Usage and totals are not an invoice.
- Optional local voice matching (**Auto-match voices**, or the checkbox in the transcription dialog): after explicit consent a pinned WavLM model runs in a browser worker and groups the provider's speaker labels that share a voice inside one meeting, across the parts of a long recording. An optional "How many people spoke?" field lets a person supply the speaker count. Audio and vectors never leave the browser; every change is one undoable revision; human-confirmed speakers win. If the build does not bundle the model, confirming starts a one-time download of the weights from huggingface.co (about 102 MB, SHA-256 checked, stored in this browser, deletable in Settings; the host sees the request and the publisher has not declared a licence for the weights; see [Deployment](docs/DEPLOYMENT.md)). Its thresholds are uncalibrated and accuracy is unmeasured. Start with the [handoff](docs/HANDOFF.md).
- No automatic email, ERP writes, KB writes, team sync, live meeting joining, PDF generation, or cross-meeting voiceprints.

## Development

Use Node **22.23.3** (see `.node-version`) and npm:

```bash
npm ci
npm run dev
```

Open the Vite URL including `/PWA-AI-Meeting-Memo-BYOK/`. A development server does not register the production service worker. To inspect the installable build:

```bash
npm run build
npm run preview
```

Checks:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run build
npx playwright install chromium webkit
npm run test:e2e
npm run test:pwa
npm run check:artifact
```

Provider browser tests block service workers and unhandled external requests while mocking responses. They exercise real IndexedDB, UI, and request orchestration; they do not test vendor accuracy. No development API key or `.env` file is needed.

Meeting records now use schema v2; v1 backups remain readable. Older app versions may safely reject v2 data. Save drafts and update all open tabs before editing; prefer a forward fix over rolling back to a v1-only client. Backup/restore retains plan checkpoints without provider keys.

## Documentation

| Document | Purpose |
| --- | --- |
| [Owner acceptance pack](docs/RELEASE-ACCEPTANCE.md) | Device, billing and annotated quality procedures |
| [Optional capability evaluation](docs/FUTURE-EVALUATION.md) | B01?B05 decisions and future entry gates |
| [Handoff: voice matching and project state](docs/HANDOFF.md) | Start here: current state, code map, pitfalls, risks and next steps |
| [Acoustic speaker continuity](docs/ACOUSTIC-SPEAKER-CONTINUITY.md) | Design, observations and acceptance evidence for automatic Voice IDs |
| [Speaker model selection](docs/SPEAKER-MODEL-SELECTION.md) | Candidate models and providers, licences, metrics and open items |
| [Speaker model download design](docs/SPEAKER-MODEL-DOWNLOAD-DESIGN.md) | Run-time download of the speaker model from its host: design, spike evidence and implementation status |
| [Implementation tasks](task.md) | Completed checkpoints and remaining acceptance gates |
| [Product requirements](docs/PRODUCT.md) | Workflow and P0/P1/P2 scope |
| [Browser architecture](docs/ARCHITECTURE.md) | State ownership, evidence, jobs, and PWA lifecycle |
| [Provider matrix](docs/PROVIDERS.md) | Selected endpoints, capabilities, limits, and uncertainty |
| [Five-perspective review](docs/PROVIDER-REVIEW.md) | Product, speech, privacy, PWA, and testing findings |
| [Feasibility](docs/FEASIBILITY.md) | Official research and unresolved live validation |
| [Deployment](docs/DEPLOYMENT.md) | Pages path, CI/CD, updates, and rollback |
| [Roadmap](docs/ROADMAP.md) | Release verification matrix |
| [Validation](docs/VALIDATION.md) | Actual test/deployment results and limits |
| [Offline evidence evaluation](docs/EVIDENCE-EVALUATION.md) | Synthetic citation-review examples, annotation rubric and metric limits |
| [Implementation log](docs/IMPLEMENTATION-LOG.md) | Per-task verification notes; commits in Git history |

The original KB design supplied the meeting-review requirements. The user's later browser-first/GitHub Pages direction supersedes a mandatory-companion proposal. Optional features remain tracked separately and are not prerequisites for using this beta.
