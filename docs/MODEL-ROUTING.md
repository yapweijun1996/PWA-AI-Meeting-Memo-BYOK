# Explicit Pi routes — QF03 implementation slice

Date: 2026-11-17. Status: manual browser adapters and persisted execution parameters implemented; verification evidence belongs to [VALIDATION.md](VALIDATION.md). **QF03 remains open** until real provider access/CORS/capability and human-reference quality evidence support promoted routes. No benchmark ranking, distinct-model independent reviewer, automatic role router or paid acceptance is claimed here.

## Source of truth

- `src/domain/memo-agent-route.ts`: versioned route identities, strict parameter schema and legacy resolution.
- `src/providers/memo-agent-transport.ts`: selected Pi subpath imports, model descriptions and final outbound policy checks.
- `src/providers/memo-agent-plan.ts` / `src/jobs/memo-agent.ts`: freeze the route, run read-only transcript tools, persist receipts before network submission and save decoded responses before continuation.
- `src/providers/agent-record.ts`: validate the response's provider/model/API against the saved route; preserve reasoning replay signatures and provider-reported token usage without treating SDK catalogue prices as actual charges.
- Existing Settings selects the memo provider/model. `MemoGenerationConfirmation.tsx` exposes reasoning/output parameters only when Pi review is explicitly enabled.

| Profile | Exact requested model | Transport | Upstream constraint |
| --- | --- | --- | --- |
| `openai-luna-v1` | `gpt-6-luna` | OpenAI Responses | Direct `api.openai.com` |
| `openrouter-luna-v1` | `openai/gpt-6-luna` | OpenRouter Chat Completions | `only: ["openai"]`, `order: ["openai"]`, `allow_fallbacks: false`, `require_parameters: true` |

These are two routes to the **same model family**. They do not satisfy the multi-model or independent-verification goals. Requested model IDs may be provider aliases; saving an ID does not pin the provider's underlying weights. Unknown benchmark, real context/output envelope, account access, retention and browser CORS remain unknown. A missing provider-reported upstream is not filled in as if it had been reported. Explicitly different reported OpenRouter model/upstream stops processing; actual reported upstream is retained in the job when available.

The OpenRouter constraints follow its [provider-routing documentation](https://openrouter.ai/docs/guides/routing/provider-selection). Its [reasoning documentation](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens) describes nested reasoning effort and replay details. The pinned SDK implementation was inspected and its serialization exercised with synthetic SSE, including both retry layers. Documentation and synthetic acceptance are not real account validation.

## Parameters and recovery

New plans default to `high` reasoning and `32768` maximum output tokens. Before the first submission, the owner may choose `low`, `medium` or `high` and `4096`, `16384` or `32768`. These are explicit application choices, not evidence that a setting is optimal or accepted by a particular account. Larger settings do not guarantee higher quality. The output limit includes whatever reasoning accounting the provider applies. Changing a setting clears the current cost acknowledgment.

The strict plan stores version, profile and parameters. Once saved, the confirmation displays those parameters read-only. A caller cannot change a saved plan's route or parameters to resume it. Old OpenAI plans lacking `route` retain their original low/4096 behavior; they are not silently upgraded. New profile IDs must be added when transport semantics change; do not reinterpret a persisted v1 profile. New route fields and OpenRouter records require this application version; old builds are not forward-compatible readers. Export first and use a forward fix if rollback would strand new records.

The SDK descriptions carry declared metadata, not a measured usable context envelope. No context truncation or automatic model downgrade is added. The existing 256 KiB serialized request, 4 MiB response, 8 KiB tool result, aggregate storage and job-ledger boundaries remain explicit pending QF04/QF05.

## Request boundary

1. Resolve only a registered exact provider/model pair, display recipient and parameters, require the existing cost/data acknowledgment.
2. Reject route/schema/record mismatch, stale source or changed saved plan before another request.
3. Inspect the SDK-generated destination, POST body, model, tools, reasoning, output and provider-routing controls. Reject remote/server tools, model lists and fallback directives.
4. Persist a durable in-flight receipt; submit one HTTPS request with omitted credentials, no redirects, no cache and explicit zero retries. The foreground abort/total-time boundary is nine minutes per request.
5. Bound and redact the received bytes, validate the selected adapter record, and persist it before executing read-only tools or sending another turn.
6. Failures and uncertain outcomes stop. Reload never resubmits. Local save/export recovery and new paid attempts remain separate actions.

No API key is included in plans, responses, backups or artifacts. Provider keys remain in the existing browser settings store. Shared-origin risks and initial consent are unchanged. Ordinary memo and speech routes are unchanged by this Pi-only adapter work.

## Remaining work and order

| Priority | Deliverable | Next evidence or implementation |
| --- | --- | --- |
| Parallel prerequisite | QF02 | Consented recordings, independent human reference annotations and a frozen scoring baseline |
| P1 | QF03 remainder | Authorized real-provider tool/reasoning/JSON/CORS/account tests; measured profiles for distinct models; eligibility and promotion gates |
| P1 | QF04 | Paginated durable artifacts/task graph and recovery-complete chunk/checkpoint backup; migration, crash, quota and multi-tab tests |
| P1 | QF05 | Whole-source coverage ledger, evidence/topic index and hierarchical synthesis without silent omission |
| P1 | QF06–07 | Typed analytical roles, independent fresh-context reviewer and controlled repair protecting confirmed facts |
| P2 | QF08–09 | Benchmark-based role routing; visible stage/coverage/issues and evidence-packet export |
| Release gate | QF10 | Real recordings/providers, physical iOS/Android, accessibility, storage and final human acceptance |

The ten top-level quality deliverables remain **1/10 complete** (QF01). This implementation is partial QF03 progress, not another completed deliverable or a quality percentage. The earlier acoustic and physical-device acceptance tasks remain separate unresolved dependencies; no accuracy claim follows from these mock tests.

## Reproduction and release handling

Use the pinned Node version in `.node-version` and the existing lockfile. Run `npm run build`, `npm run test:unit`, and `npx playwright test tests/browser/memo-agent.spec.ts`. The browser tests intercept external provider calls with synthetic SSE and synthetic keys; they do not validate paid provider access. Run `npm run lint`, `npm run check:ssot`, `npm run check:artifact` and the existing `npm run test:pwa` before an authorized release.

In an isolated browser profile, choose the memo provider/model in Settings, open a synthetic meeting's notes confirmation and enable Pi review. Verify the displayed recipient/model and the reasoning/output controls. Changing either control must uncheck cost consent. Canceling must send nothing. After a mocked interrupted submission and reload, the saved controls must remain disabled and another attempt must require the existing outcome review. The browser suite executes these steps in Chromium and WebKit.

An authorized main push uses the existing verify/publish workflow; inspect its actual result, then assert the full application SHA from `.pwa-version[data-tooltip]` in a fresh hosted profile before a synthetic smoke test. No live provider request is part of deployment verification. If an adapter defect is discovered, disable the affected new route through a forward fix while retaining schema readers, saved receipts and export. An older build cannot read new strict route fields; do not silently deploy an old reader over new data. Preserve/export records before any separately authorized rollback. Existing worker activation/draft protections remain mandatory.
