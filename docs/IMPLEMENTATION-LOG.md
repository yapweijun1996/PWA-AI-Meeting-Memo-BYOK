# Implementation evidence

Each entry records a task checkpoint. Full commits are available in Git history. Live API and physical-device checks remain separate from mocks.

- **V01** — Reviewed official Deepgram and OpenAI contracts; docs/PROVIDERS.md records separate credentials, metadata, limits, billing and live validation gates.
- **F01** — npm install and npm run build pass on Node 22.23.3; locked React/Vite/TypeScript dependencies, ignored private data, and static build config added. Node 22 replaces the earlier Node 24 proposal to match the verified executor.
