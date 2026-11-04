# PWA AI Meeting Memo — BYOK

A browser-first meeting memo PWA: import a recording, review who said what, and produce meeting notes with traceable evidence using your own API keys.

## Status

**Design and documentation stage — no application has been implemented.** The current direction was updated on 2026-11-04 to prioritize an ordinary browser and GitHub Pages. A local companion, application backend, account, and cloud synchronization are not prerequisites for the core workflow.

The original KB-MCP design remains the source of the meeting-review requirements. This repository records the newer browser-first hosting decision and its consequences. Product scope is agreed direction; the implementation stack and providers are proposals until the validation gates pass.

| Item | Observed state on 2026-11-04 |
| --- | --- |
| Source baseline | `d596e1e58f83af6c5b131ed40cac15ed9470d39b`; only `.gitattributes` |
| GitHub Pages configuration | Live API: `build_type=workflow`, `https_enforced=true` |
| Configured Pages address | `https://yapweijun1996.github.io/PWA-AI-Meeting-Memo-BYOK/` |
| Active Actions workflows | Live API: zero at the time of inspection |
| Successful application deployment | Not verified; Pages API returned `status=null` |
| Provider/browser/audio tests | Not performed |

The configured address is a deployment target, not a claim that a working application is available.

## Intended workflow

1. Create a meeting with a date, timezone, languages, optional attendee names, and domain terms.
2. Import and preview a recording, or import an existing transcript.
3. Select a supported provider and enter its API key for this session.
4. Review the data destination and estimated cost before sending anything.
5. Review anonymous speakers, listen to examples, confirm names, and correct transcript assignments.
6. Generate a memo, inspect its source passages, and accept or edit each item.
7. Save locally and export Markdown, TXT, JSON, or a complete meeting backup.

Speaker review is core functionality. A transcript-only path is useful but does not satisfy the speaker-aware release criteria.

## Browser-first contract

- GitHub Pages serves static application files. API processing happens at the provider selected by the user.
- Keys are supplied at runtime and kept in memory by default. No provider key belongs in GitHub Actions, build variables, or deployed files.
- Browser storage holds local meeting drafts; it is not automatic backup or cross-device sync.
- Offline work covers saved meetings, editing, review, playback of saved audio, and export. Cloud AI requires a connection.
- Processing is foreground work with durable checkpoints. Closing or suspending the app can interrupt it.
- Anonymous speaker labels need user confirmation. Unsupported timestamps, overlap, and unknown identity must stay explicit.
- A failed browser integration is reported honestly. The app must not silently route keys or recordings through a proxy.

## Documentation

| Document | Purpose |
| --- | --- |
| [Product requirements](docs/PRODUCT.md) | Scope, user flows, UI, and acceptance requirements |
| [Browser architecture](docs/ARCHITECTURE.md) | Modules, data ownership, jobs, storage, and PWA lifecycle |
| [Feasibility and evidence](docs/FEASIBILITY.md) | Official sources, provider options, risks, and unresolved questions |
| [GitHub Pages deployment](docs/DEPLOYMENT.md) | Build paths, CI/CD, security boundaries, updates, and rollback |
| [Implementation roadmap](docs/ROADMAP.md) | Ordered work and measurable release gates |
| [Inactive Actions example](docs/examples/github-pages.yml) | Reviewed deployment blueprint for the future app |

There is currently no `package.json`, development server, or runnable build. Commands and module paths in the design documents describe the intended implementation.
