# Design: download the speaker model from its host at run time (route B)

Status: **implemented 2026-11-10 (code and unit tests); not yet verified in WebKit, on a phone, offline, or against the live host from inside the app (see section 10).** Two feasibility spikes passed in Chromium (section 2). It is route B of the licence investigation in [SPEAKER-MODEL-SELECTION.md](SPEAKER-MODEL-SELECTION.md): this repository and its GitHub Pages site stop hosting the WavLM weights; with the user's consent the browser downloads them from Hugging Face at a pinned revision, verifies SHA-256, and caches them privately. Markers: **verified** (checked by running a request or reading code on 2026-11-10), **to verify** (needs a spike or test).

## 1. Why, and what this does not solve

- The Pages demo cannot ship the model: CI has no model files, and the weights' redistribution terms are undeclared (see the licence investigation).
- Route B removes **our redistribution** of the 101.7 MB weights. It does **not** establish that end users may use them: that question stays open, and the host's and publisher's terms apply to the user. Do not describe this route as licence-clean.
- It depends on a third-party mirror: the only ONNX conversion is `Xenova/wavlm-base-plus-sv`. If that repository or revision disappears, the feature stops. The failure must be clear and non-destructive.

## 2. Facts established

| Fact | Result |
| --- | --- |
| Pinned revision `e61029603001bd11295c36d878698708bf59190f`, file `onnx/model_quantized.onnx` | **Verified:** 101,683,453 bytes, LFS sha256 `576bf6017796bdd179824d801b3a355a1dda2451559c6a398562175e33589f68`, identical to `SPEAKER_ASSET_FILES` in `src/audio/speaker-embedding.ts` |
| Small files (`config.json` 58,609 B, `preprocessor_config.json` 215 B, `quantize_config.json` 1,154 B) | **Verified** sizes; they are not LFS, so integrity relies on the sha256 values already pinned in our source |
| CORS on `huggingface.co/<repo>/resolve/<rev>/<file>` | **Verified** by request: `Access-Control-Allow-Origin` echoes the page origin on the 302/307 responses |
| CDN hop for the ONNX file (`us.aws.cdn.hf.co/xet-bridge-…`) | **Verified:** `206 Partial Content`, `Accept-Ranges: bytes`, `Content-Range … /101683453`, `Access-Control-Allow-Origin: *` |
| Current CSP in `index.html` | **Verified:** `connect-src 'self' https://api.openai.com https://openrouter.ai`; a page fetch to Hugging Face would be blocked |
| Whether the dedicated worker is bound by the page's meta CSP | **Verified in Chromium only (spike S2):** with the app's exact meta CSP, a main-thread fetch to `huggingface.co` was blocked, while the same fetch inside a dedicated worker reached the host (status 200); WebAssembly also compiled in the worker without `wasm-unsafe-eval`. WebKit and Firefox are **not tested** |
| Feeding verified bytes to Transformers.js 4.3.2 | **Verified by source and by experiment (spike S1, Chromium):** `env.useCustomCache` plus `env.customCache` (`match`, `put`) is consulted before any fetch (`checkCachedResource`). The page downloaded the four files, all sizes and SHA-256 values matched the pinned ones, the worker loaded the model from the custom cache and returned a finite 512-dimension embedding (load plus first inference 13.5 s). A server log showed each model file requested once (the download step) and none by the worker; keys arrive as `<localModelPath>/wavlm-base-plus-sv/<file>`, so map by suffix |
| CDN host stability (`us.aws.cdn.hf.co` observed; other regions or hosts may be used) | **To verify**; allow a pattern such as `https://*.hf.co`, not one host |

## 3. Current design this changes

- `verifySpeakerAssetManifest` requires a same-origin `speaker-assets/manifest.json` with `status: "ready"`, matching the pinned model id, revision, runtime and the six allowlisted files (path, bytes, sha256).
- The worker sets `env.allowRemoteModels = false`, `localModelPath` and `wasmPaths` to same-origin `speaker-assets/` URLs, and uses `env.useBrowserCache` with cache key `meeting-memo-byok-speaker-model-v1`.
- `scripts/build-pwa.mjs` copies assets from `SPEAKER_ASSET_SOURCE` or writes an `unavailable` manifest; assets are deferred and never precached.

## 4. Proposed design

**Split the assets.** Only the ONNX Runtime WASM and its loader (about 26.9 MB; `onnxruntime-web` is MIT) are served from our own origin, with MIT and Apache-2.0 notices added to the build. **Every model file**, the 101.7 MB weights and the three small configuration files, comes from the host, because all of them belong to the same repository whose terms are undeclared.

**Flow**

```
user starts Auto-match / ticks the checkbox
  └─ model state: not_installed ──► consent dialog (see 5) ──► downloading
        fetch pinned URL, credentials omit, no-referrer, Range-resumable, progress to UI
        └─ all bytes received ──► SHA-256 == pinned value? ── no ──► delete partial, state failed_integrity
                                   └─ yes ──► write to app-scoped cache ──► ready
  model state: ready ──► worker loads from the app-scoped cache ──► embed (unchanged)
```

States: `not_installed`, `downloading`, `verifying`, `ready`, `failed_network`, `failed_integrity`, `failed_quota`, `unavailable_remote` (host returned 404/403/other).

**Feeding the verified bytes to Transformers.js.** Use a custom cache (spike S1 passed in Chromium). The page, or a worker, downloads and verifies the files, stores them in an app-scoped store (Cache Storage or IndexedDB), and the model worker sets `env.useCustomCache = true` with a `customCache.match` that returns a `Response` for the requested file name. It needs neither a service worker nor same-origin model URLs, so it also works in the development server. The existing local `speaker-assets` path can remain as a developer fallback. **To verify:** the same flow in WebKit, and offline reload from the app-scoped store.

**Pinning.** Reuse the pinned revision and sha256 values already in source; the remote manifest is never trusted. The URL is built from constants. Any future revision change is a code change plus a new hash.

**Integrity and memory.** WebCrypto digests need the whole buffer. Hashing 101.7 MB means a peak of roughly twice that in memory. **To verify** on a low-memory phone; if it fails, adopt an incremental SHA-256 implementation or chunked verification with a pinned chunk-hash list.

**Storage.** An app-scoped cache name, never touching other origin storage; a **Delete speaker model** control in Settings; excluded from meeting backups and exports; quota checked before download with a clear failure.

**CSP.** Do the download inside the worker (it was not blocked in Chromium, spike S2) **and** add `https://huggingface.co https://*.hf.co` to `connect-src` so the declared policy matches the real traffic and a main-thread download also works; keep every other directive. Worker behaviour under a page `<meta>` policy is browser-specific until WebKit is tested. A test asserts the policy still blocks unrelated hosts.

## 5. Consent and disclosure (user-facing)

State before the first download: the file is about 102 MB; it is fetched from `huggingface.co` and its CDN, which will see the request (IP address and browser details); no recording, transcript, vector or key is sent; the model is stored in this browser and can be deleted in Settings; the licence of the weights is not declared by the publisher. The existing consent checkbox and dialog already mention the download size; they need this added text. No download happens without the confirmation.

## 6. Failure and recovery

- Interrupted download: resume with `Range` from the partial bytes held in memory or an app-scoped partial store; never mark `ready` before the hash passes.
- Offline after `ready`: voice matching works from the cache; offline before `ready`: clear message, nothing partial is used.
- Hash mismatch: delete the partial, show `failed_integrity`, never retry silently.
- Host unavailable or revision removed: `unavailable_remote`, with a link to the documented local preparation route (`scripts/prepare-speaker-assets.mjs`) for developers.
- Rate limiting or a CORS change on the host: `failed_network` with the reason; do not fall back to another host without a design change.

## 7. Tests and acceptance

- Unit: URL construction from constants; hash match and mismatch; partial resume; quota failure; state machine; no request without consent.
- Browser (external requests are normally blocked in tests): route-intercepted fixtures for success, mismatch, 404, interrupted download and offline reload, in Chromium and WebKit.
- One manual real-network run against the live host, recorded with date, browser, size and time; physical iOS and Android memory and storage checks before any mobile claim.
- Acceptance: the Pages build shows the download flow and, after a successful download, completes a voice check on a test meeting; deleting the model returns to `not_installed`.

## 8. Effort and order

1. Spikes. **Done in Chromium:** S1 feeding mechanism, S2 worker CSP. **Still open:** S1 and S2 in WebKit, S3 memory peak of hashing 102 MB on a phone, S4 resumable download, S5 offline reload from the app-scoped store. The spike harness lived outside the repository (scratch directory) and is not committed.
2. State machine, download, verify, cache, Settings delete.
3. CSP, build manifest (`remote-pinned` status), notices, documentation.
4. Tests and the real-network and device runs.

## 9. Open decisions for the owner

- Accept route B despite the open use-terms question, or wait for the publisher's answer first (route A).
- Whether the demo should offer the download at all before the licence is clarified.
- Whether to add a second pinned mirror (for example a repository the owner controls) as a fallback; that would reintroduce a redistribution question.

## 10. Implementation status (2026-11-10)

**Done (code, unit tests, local CI-style build)**

- `src/audio/speaker-model-store.ts`: consent gate, URL built only from pinned constants, `credentials: omit`, `referrerPolicy: no-referrer`, `cache: no-store`; size and SHA-256 checked before anything is stored; files already stored are skipped on retry; errors `consent`, `network`, `remote`, `integrity`, `quota`, `aborted`; app-scoped cache `meeting-memo-byok-speaker-model-remote-v1`; delete only that cache.
- `src/audio/speaker-embedding.ts`: accepts the `remote_model` manifest, reads the pinned model files and source, downloads only when the caller set `allowRemoteDownload` (the confirmed voice-matching flows do), then loads from the cache.
- `src/audio/speaker-embedding.worker.ts`: `modelSource: "remote-cache"` mode with `env.useCustomCache`, serving the verified files from Cache Storage.
- Build: `scripts/speaker-assets.mjs` adds the `remote_model` status (runtime files only, hash-verified, exact allowlist) and `prepareRuntimeSpeakerAssets`; `scripts/build-pwa.mjs` ships the pinned ONNX Runtime from the installed `onnxruntime-web` when `SPEAKER_ASSET_SOURCE` is not set, otherwise falls back to `unavailable`.
- `index.html` CSP: `connect-src` adds `https://huggingface.co https://*.hf.co`.
- UI: consent text in the transcription and Auto-match dialogs names the host and size; **Settings > Speaker model** shows the state and deletes the model.
- Tests: `tests/speaker-model-store.test.ts` (10), `tests/speaker-embedding-remote.test.ts` (6), `tests/speaker-runtime-assets.test.ts` (3); existing speaker and PWA build tests pass. A CI-style build without model files produced status `remote_model`, shipped only the two runtime files (not precached), and passed `check:artifact`.

**Not done or not verified**

- Resuming inside one file: an interrupted 102 MB file restarts from its first byte (only completed files are kept). The design's `Range` resume is not implemented.
- WebKit and Firefox (spikes S1 and S2 were Chromium only); a phone's memory peak when hashing 102 MB (the file is held in one buffer plus the digest); offline reload from the app cache.
- A browser test (Playwright) of the download flow and of the Settings control; a real-network download run from inside the application (the spike used a local stand-in host, and the live host was only probed with HTTP requests).
- The licence question: end-user use terms of the weights are still undeclared by the publisher. This route removes our redistribution only.
