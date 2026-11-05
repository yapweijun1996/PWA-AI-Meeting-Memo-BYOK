# Meeting Memo — BYOK PWA

A browser-first workspace for recordings, speaker corrections, evidence-linked meeting notes, and local backups. Bring your own OpenAI or OpenRouter keys; no companion or application server is required.

**Status:** implemented browser beta. Local automated checks cover the review and recovery workflow. Real recording accuracy, paid account access, and physical-phone acceptance remain user-run gates; this is not a claim of validated diarization quality.

Live app: **https://yapweijun1996.github.io/PWA-AI-Meeting-Memo-BYOK/**. GitHub Actions checks each main commit before publishing. Successful deployment and live-browser evidence are recorded in [validation](docs/VALIDATION.md).

## Use the workspace

1. Create a meeting and attach a recording up to 50 MB, paste a transcript, or import a Meeting Memo JSON transcript.
2. In **Settings & API keys**, enter your OpenAI key and optionally an OpenRouter key. Choose a provider and model separately for transcription and notes. Click **Save settings** to keep keys, provider/model selections and the speech rate in this browser across reloads. Saving settings makes no API request.
3. Choose **Transcribe** and review the provider, recording, and estimated/unknown charge before confirming. Keep the page open.
4. Listen to speaker samples, confirm names, correct text and assignments, merge voices, split passages, and undo changes. Unknown timing or identity stays explicit.
5. Choose **Generate meeting notes**, review the selected destination and what is sent, then inspect, edit, accept, or reject each cited item. **Original generated item** shows its separately saved generated snapshot. Source changes require re-review; new generations preserve older human versions.
6. Export Markdown/TXT for the selected notes version, JSON for all meeting data without audio, or ZIP for a full backup with audio. **Restore backup** creates a separate copy.

Use **How it works → Explore a synthetic example** to try local review without a recording, key, or charge. The example contains invented text and no recorded audio or generated memo.

## What stays local

The meeting library, recordings, revisions, review history, and jobs live in this browser's IndexedDB. Encoded audio bytes and media type are stored atomically with metadata; playback reconstructs a Blob. Settings, including provider keys, are stored in a separate local IndexedDB database. **Keys are unencrypted** and accessible to scripts sharing this website origin and anyone with access to this browser profile. They are excluded from meeting exports, logs, service-worker caches and GitHub builds. Use **Forget keys** to remove saved keys; clearing site data also removes them and local meetings.

Offline use includes saved meetings, local playback, editing, review, and export after the app shell has been cached. Cloud AI requires a working connection. Browser background execution is not guaranteed; interrupted requests remain visible and never automatically resubmit. An unknown outcome or local cancellation may still be billable.

Browser storage is not backup or synchronization. Export a full backup regularly. The default Pages address shares its storage origin with other projects on `yapweijun1996.github.io`; namespacing prevents accidental collisions, not same-origin access. A dedicated hostname is recommended before sensitive production use.

## Processing boundaries

- Speech defaults to OpenAI `gpt-transcribe`, which provides text without established speaker/time evidence. OpenRouter `elevenlabs/scribe-v2` requests speaker labels and word timestamps; account access, CORS and real quality remain unverified. OpenAI `gpt-4o-transcribe-diarize` is deprecated and scheduled to stop on 2027-02-26.
- Notes default to OpenAI Responses with GPT-6 Luna. Both providers offer selectable model IDs; notes require structured-output support and are validated against source IDs. OpenRouter routes data to an upstream provider and their retention policies apply.
- Provider-specific keys, selections and the speech rate persist in this browser after saving. The first update from an older version cannot recover keys that existed only in its page memory; enter and save them once. OpenRouter models and access vary by account. No provider call occurs until confirmation.
- Local audio import is capped at 50 MiB; single-request transcription is capped at 25 MB and sent as the original container. No arbitrary byte chunking, full-file PCM conversion, or local model inference is advertised.
- Memo input is capped at 80,000 serialized characters and output at 8,000 tokens. Unsupported inputs are rejected before submission rather than silently truncated.
- Requests time out after nine minutes; this stops waiting, not necessarily remote processing or billing.
- New memo versions preserve normalized generated items separately from human edits. Older backups without that snapshot still load, with the original explicitly unavailable. Update all open tabs before reviewing newly created memo data.
- Charges use your provider account. Speech estimates require an entered plan rate and known duration; unknown rates and memo cost stay unknown. Reported token/duration usage is not an invoice.
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

## Documentation

| Document | Purpose |
| --- | --- |
| [Implementation tasks](task.md) | Completed checkpoints and remaining acceptance gates |
| [Product requirements](docs/PRODUCT.md) | Workflow and P0/P1/P2 scope |
| [Browser architecture](docs/ARCHITECTURE.md) | State ownership, evidence, jobs, and PWA lifecycle |
| [Provider matrix](docs/PROVIDERS.md) | Selected endpoints, capabilities, limits, and uncertainty |
| [Five-perspective review](docs/PROVIDER-REVIEW.md) | Product, speech, privacy, PWA, and testing findings |
| [Feasibility](docs/FEASIBILITY.md) | Official research and unresolved live validation |
| [Deployment](docs/DEPLOYMENT.md) | Pages path, CI/CD, updates, and rollback |
| [Roadmap](docs/ROADMAP.md) | Release verification matrix |
| [Validation](docs/VALIDATION.md) | Actual test/deployment results and limits |
| [Implementation log](docs/IMPLEMENTATION-LOG.md) | Per-task verification notes; commits in Git history |

The original KB design supplied the meeting-review requirements. The user's later browser-first/GitHub Pages direction supersedes a mandatory-companion proposal. Optional features remain tracked separately and are not prerequisites for using this beta.
