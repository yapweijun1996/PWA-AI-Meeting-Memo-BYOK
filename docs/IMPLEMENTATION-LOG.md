# Implementation evidence

Each entry records a task checkpoint. Full commits are available in Git history. Live API and physical-device checks remain separate from mocks.

- **V01** — Reviewed official Deepgram and OpenAI contracts; docs/PROVIDERS.md records separate credentials, metadata, limits, billing and live validation gates.
- **F01** — npm install and npm run build pass on Node 22.23.3; locked React/Vite/TypeScript dependencies, ignored private data, and static build config added. Node 22 replaces the earlier Node 24 proposal to match the verified executor.
- **S01** — Type checking and 3 domain tests pass: untimed imports stay untimed, unexpected fields/credentials are rejected, and invalid dates/dangling speaker references fail.
- **S02** — Nine unit tests pass, including stale-write rejection, isolated delete/audio cleanup, and interrupted-request recovery; storage version is separate from source revision.
- **S07** — Operations tests verify original evidence resolves after edits/splits, merge does not confirm identity, and undo creates a new source revision leaving old memo review stale.
- **F03** — Production build, 13 unit tests and six Chromium/WebKit browser checks pass: create/import, correction/undo, confirmation/reload, session-key clearing and mobile navigation. App screens now connect the local repository and provider adapters; live API behavior remains unverified.
- **F02** — Chromium and WebKit production-path create/reload/navigation tests pass; skip navigation focuses content without overwriting the hash route.
