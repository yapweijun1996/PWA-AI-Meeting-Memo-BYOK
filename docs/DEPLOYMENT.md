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

The example uses action commit pins taken from the official Vite deployment guidance and checked for existence against their official repositories on 2026-11-04. Review pin updates and transitive dependencies normally; a resolvable commit alone is not a security audit.

## Project path and navigation

The default deployment base is:

```text
/PWA-AI-Meeting-Memo-BYOK/
```

The workflow supplies the public `VITE_BASE_PATH` setting. Vite reads it as `base`, defaulting to the repository path. Derive app asset URLs and service-worker registration from `import.meta.env.BASE_URL`. This variable contains only a public path, never a key.

Use hash routing initially, such as `/PWA-AI-Meeting-Memo-BYOK/#/meetings/<id>`, so static-host navigation and refresh do not need server rewrites. A custom 404 router workaround is unnecessary for this design.

Derive manifest `id`, `start_url`, and `scope` from that base. For the default deployment they are `/PWA-AI-Meeting-Memo-BYOK/`; resolve manifest icons under the same directory. Register the worker at `<base>sw.js` with `<base>` scope. A root `/sw.js` must not be introduced.

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
