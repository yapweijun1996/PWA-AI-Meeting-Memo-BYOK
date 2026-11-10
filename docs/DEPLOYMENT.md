# GitHub Pages automatic deployment

Status: deployed browser beta, 2026-11-04. A runnable static app and all required scripts exist. [The active workflow](../.github/workflows/pages.yml) has completed verified publication; the reference under `docs/examples/` remains a template. See [validation](VALIDATION.md) for the exact successful run, served build and live-browser evidence.

## Initial verified configuration (before implementation)

Read-only GitHub API inspection returned:

```json
{
  "build_type": "workflow",
  "html_url": "https://yapweijun1996.github.io/PWA-AI-Meeting-Memo-BYOK/",
  "https_enforced": true,
  "status": null,
  "active_workflow_count": 0
}
```

The last field summarizes the separate Actions workflows API call; it is not a Pages API field. The screenshot and live result agree that Settings > Pages > Build and deployment > Source is GitHub Actions. This initial snapshot predates the runnable app. Later publication must be established independently by a successful run and served-build checks.

## Build and release contract

Use a static Vite build producing `dist/`, an npm lockfile, and the same pinned Node major locally and in CI (Node 22.23.3 is the tested runtime). The package defines these scripts:

| Script | Expected responsibility |
| --- | --- |
| `npm run lint` | Application source and test lint |
| `npm run typecheck` | Type checking without emitting |
| `npm run test:unit` | Noninteractive domain/storage-adapter tests |
| `npm run build` | Production static assets and generated PWA files |
| `npm run test:e2e` | Browser smoke and critical recovery tests against the production build at its project base path |
| `npm run test:pwa` | Two-engine lifecycle checks: request/editor protection, activation/progress/failure, saved draft, previous assets and forward recovery |
| `npm run check:artifact` | Static-only dist contents, manifest identity/scope and known credential/fixture pattern checks |

The E2E script must start a static preview server and shut it down, with Playwright configured for the same base path. Offline/update flows need dedicated tests; a dev-server run is insufficient. These scripts and Playwright tests are present; `test:pwa` additionally checks update activation and `check:artifact` checks the release boundary.

The active workflow was copied from [the example](examples/github-pages.yml) after these prerequisites passed. It checks pull requests, builds on `main`, and publishes only successful trusted-main runs. Manual dispatch from other branches never deploys. The `github-pages` environment was rechecked through the API and permits only the `main` branch.

The browser-dependency step rewrites only the Ubuntu runner's `azure.archive.ubuntu.com` entries to the official `archive.ubuntu.com` mirror before Playwright installs Chromium and WebKit system packages. It preserves the runner's signed suites, components, security source and the existing install command; it does not disable APT signature checks or bypass browser tests. This is an ephemeral CI-network workaround, not an application or deployment-host configuration.

The example uses action commit pins taken from the official Vite deployment guidance and checked for existence against their official repositories on 2026-11-04. Review pin updates and transitive dependencies normally; a resolvable commit alone is not a security audit.

## Project path and navigation

The default deployment base is:

```text
/PWA-AI-Meeting-Memo-BYOK/
```

The workflow supplies the public `VITE_BASE_PATH` setting. Vite reads it as `base`, defaulting to the repository path. Derive app asset URLs and service-worker registration from `import.meta.env.BASE_URL`. This variable contains only a public path, never a key.

Use hash routing initially, such as `/PWA-AI-Meeting-Memo-BYOK/#/meetings/<id>`, so static-host navigation and refresh do not need server rewrites. A custom 404 router workaround is unnecessary for this design.

Derive manifest `id`, `start_url`, and `scope` from that base. For the default deployment they are `/PWA-AI-Meeting-Memo-BYOK/`; resolve manifest icons under the same directory. Register the worker at `<base>sw.js` with `<base>` scope. A root `/sw.js` must not be introduced.

Build and lifecycle-test scripts derive public asset paths relative to `dist/` and convert native filesystem separators to `/`. Precache URLs never include the build directory itself. The canonical URL list participates in cache identity, so a path-only change produces a new release cache. The artifact checker parses the generated list as JSON and requires canonical, unique, in-scope URLs matching every actual artifact file except the worker, including the app index. This prevents a Windows build from silently caching fallback HTML at incorrect `dist\\...` URLs.

Test the built app with the trailing-slash project URL, direct hash links, reload, assets, manifest, installed launch, offline launch, and worker scope. If a dedicated hostname is later used at its root, change the base and plan a storage/identity migration.

## Credential and artifact rules

CI needs GitHub's scoped deployment token/OIDC permissions; it does not need an OpenAI, OpenRouter, or user key. Never inject provider credentials through `VITE_*`, other build substitutions, an HTML file, or a bundled configuration.

Upload only `dist/`. Do not upload the repository root, `.env` files, recordings, backups, logs, or real transcripts. Tests use synthetic fixtures and mocked provider responses; paid integration evaluations are separate explicit runs, never every pull request.

Keep build jobs at `contents: read`. Grant `pages: write` and `id-token: write` only to the deploy job, tied to the `github-pages` environment and the successful build artifact. Preserve the verified `main` environment restriction. Do not use `pull_request_target` to execute contributor code with deployment permissions.

The workflow does not cancel an already running deployment. Pending-run ordering is not a release chronology guarantee, so the deploy job also verifies that its commit is still the current `main` head before publishing. Use a normal revert/new commit for rollback rather than redeploying an old arbitrary run.

## Origin isolation and browser policy

`https://yapweijun1996.github.io/PWA-AI-Meeting-Memo-BYOK/` and other project paths on `https://yapweijun1996.github.io` have the same origin. Database/cache names reduce accidental collisions but do not prevent same-origin scripts from accessing storage. This follows from the default Pages project URL and browser origin rules. [GitHub URL layout](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [MDN origin storage](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy)

Use a dedicated hostname for production isolation before storing sensitive meetings, or explicitly accept the whole owner-hostname trust boundary for a personal prototype. Changing hostnames does not move existing local data; offer export/import. This is a production hosting gate, not a requirement to install a companion.

Bundle scripts locally and use a tested CSP appropriate to the selected provider hosts, workers, and media. Static Pages does not provide an application server for arbitrary response-header configuration. A CSP meta tag can enforce a useful subset but cannot supply every header directive, and cannot create COOP/COEP isolation. Do not rely on multithreaded WASM or a service-worker header shim to make the first visit work. Verify actual hosting headers and `crossOriginIsolated` before enabling optional capabilities. [MDN CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy), [MDN cross-origin isolation](https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated)

## Publication and installed-client updates

Actions deployment and an installed PWA update are separate events. A new site artifact may be live while an open client still uses the previous worker.

When an update is confirmed and pending writes have finished, resolve the registration's current waiting worker before requesting activation. A newer waiting worker can replace the one shown when the prompt first appeared; an obsolete worker must not receive the activation request. If no current worker is waiting, either reload an already-activated update or report the activation failure without discarding drafts.

The source commit appears under Settings as the public build identity; production assets are content-hashed. A waiting-worker prompt offers user-triggered activation. Active requests and open editors block activation, pending local writes must finish, and local save errors prevent reload. A rollback also needs a new build identity and a compatible storage schema; never repair an update by deleting all origin storage.

Precache requests use `cache: reload` to bypass the browser HTTP cache, and navigation uses the activated release's cached index. This prevents a new worker from caching an old HTML entry under Pages' observed ten-minute HTTP freshness window. The release cache identity includes worker source as well as static assets. The cacheable-server regression and a real two-engine Pages upgrade both passed; see the validation record.

Retain or deliberately handle assets used by old open tabs. Test missing old lazy chunks after a deployment and show a recoverable update prompt. Avoid introducing extra lazy splits in the first version before their recovery path exists.

## Release verification and rollback

Before first publication, confirm all build/check scripts work, the environment permits `main`, and the production path passes local smoke tests. After an authorized deployment, record the commit, successful run URL, artifact, deployment URL, and browser checks separately.

Verify HTTPS, JS/CSS/worker/icon responses, base path, provider CORS, no unexpected third-party requests, offline/reload behavior, and N-to-N+1 update recovery. Test with synthetic data before a real meeting and record actual browser/device versions.

For a bad release, revert its code on `main` and pass the same pipeline. Check storage backward compatibility first. A destructive migration may require a forward fix or explicit backup/restore; reverting JavaScript alone cannot undo a database migration.

## Official deployment references

- [GitHub custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Vite static deployment and pinned example](https://vite.dev/guide/static-deploy.html)
- [Vite environment variables](https://vite.dev/guide/env-and-mode.html)
- [Service-worker registration and scope](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register)

The sidebar displays the package version and build identity and can check the current registration for a waiting update. Manual checks do not activate a worker. Activation remains user-confirmed and uses the same draft/request guards as the main update notice. Development mode and unavailable registrations report that checks cannot be completed.

## Local speaker model assets

Voice matching needs a pinned WavLM model (about 101.7 MB q8 ONNX plus three small configuration files) and a single-thread ONNX WASM runtime (about 26.9 MB). The build handles them in one of three states, written to `speaker-assets/manifest.json`:

| Status | When | What ships |
| --- | --- | --- |
| `ready` | `SPEAKER_ASSET_SOURCE` points at a verified source directory | Runtime and model, all hash-verified |
| `remote_model` | No source set and `onnxruntime-web` is installed (the Pages build) | **Only the runtime** (MIT, from the installed package, hash-verified). The browser downloads the weights from Hugging Face after consent |
| `unavailable` | The runtime cannot be found or does not match the pinned hashes | Nothing; the feature reports itself unavailable |

- All of `speaker-assets/` is deferred and never precached. `public/speaker-assets/` is git-ignored; the model files are not in the repository.
- Route B (see [SPEAKER-MODEL-DOWNLOAD-DESIGN.md](SPEAKER-MODEL-DOWNLOAD-DESIGN.md)): after the user confirms, the browser fetches the four model files from `huggingface.co` at the pinned revision, verifies size and SHA-256, and stores them in an app-scoped cache that Settings can delete. The CSP `connect-src` lists `https://huggingface.co https://*.hf.co` for this. The service worker ignores cross-origin requests.
- `scripts/prepare-speaker-assets.mjs --source <verified-probe-public> --output public/speaker-assets` prepares a full local set for development. `SPEAKER_ASSETS_REQUIRED=1` makes anything other than `ready` a build error.
- **The published demo's voice matching is not yet verified end to end.** A CI-style local build produced `remote_model` and passed the artifact check; the download itself has not been run from the deployed site, and WebKit, offline reload and phone memory are untested.
- The weights' licence is undeclared by the publisher. Route B does not redistribute them but does not settle end-user use terms; see [SPEAKER-MODEL-SELECTION.md](SPEAKER-MODEL-SELECTION.md).
- The Pages artifact now carries about 27 MB of runtime files. GitHub rejects files over 100 MiB; the ONNX weights are about 97 MiB and are not committed.
