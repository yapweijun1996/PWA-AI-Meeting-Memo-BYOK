# Project instructions

- This project is a browser-first, speaker-aware meeting memo PWA with runtime BYOK and GitHub Pages hosting. Keep the normal user workflow usable without installing a companion or running a backend.
- Read [README.md](README.md), [docs/PRODUCT.md](docs/PRODUCT.md), and the documents relevant to a change before implementation. The 2026-11-04 browser-first decision takes precedence over older companion-first proposals.
- Treat the proposed stack, provider capabilities, and future module names as plans. Verify current official documentation and real browser behavior before claiming support.
- Keep speaker correction, source evidence, revision invalidation, local recovery, and export in scope. Preserve original model output separately from human edits.
- The user explicitly chose unencrypted provider-key persistence in this browser's IndexedDB. Make the shared-origin risk clear; keep keys out of meeting backups, source control, Actions secrets for frontend injection, public build artifacts, logs, and service-worker caches.
- A GitHub Pages repository path is not an origin security boundary. Scope this app's worker/cache/database names and never delete unrelated origin storage.
- Paid requests with unknown outcomes must not automatically retry, including retries inside SDKs. Provider polling and resubmission are different operations.
- Use the GitHub Pages base path consistently for assets, worker registration, manifest identity, and navigation. Production routing must work on a static host.
- Preserve drafts before user-triggered PWA updates. Verify offline use and the version N to N+1 update flow; manifest presence alone is not PWA completion.
- Apply the acceptance matrix in [docs/ROADMAP.md](docs/ROADMAP.md), including iOS standalone, safe areas, accessibility, and storage recovery. Record unsupported behavior explicitly.
- The workflow under `docs/examples/` is inactive. Activate it only alongside a runnable app, its required checks, and authorized publication. Documentation work alone does not establish deployment success.
- Report checks actually run and remaining limitations. Do not commit, push, or deploy without authorization from the current task or existing session instructions.
