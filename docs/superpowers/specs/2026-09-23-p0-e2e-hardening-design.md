# P0 E2E Hardening Design

## Goal

Turn the current Playwright suite into a release gate that catches the classes of regressions seen during the Cloudflare migration before code can be merged or deployed.

## Constraints

- Work only on branch `test/p0-e2e-hardening`.
- Do not merge this branch.
- Core tooling must remain R$0/self-hosted/open-source; no paid service is required.
- Tests use the existing local Miniflare runtime with synthetic D1/R2 data and must never depend on real patient data.
- Keep existing production behavior unless a failing E2E proves a production defect.
- Chromium is the mandatory P0 browser; mobile and additional engines remain outside P0.

## P0 coverage

1. **Mandatory E2E CI gate** — build the app, install Chromium, run Playwright on relevant pull requests and branch pushes, and retain Playwright artifacts on failure.
2. **Authentication/session resilience** — login/logout/reload, temporary 503/429/offline behavior, session preservation, and no resurrection of an obsolete alias session.
3. **Patient create/idempotency** — double submit, lost response after persistence, retry with the same idempotency key, and exactly one patient in D1.
4. **Atomic patient editing** — successful mother/baby/consent edit plus injected late D1 failure proving no partial update survives.
5. **Clinical record persistence** — create/start a clinical encounter through the supported API/UI path, persist it in D1, reload, and verify it remains attached to the correct patient.
6. **Network failure matrix** — representative 503, 429, aborted request, delayed response, and offline/online transition on critical read/write paths without deleting a valid session or duplicating a write.
7. **Cross-user isolation** — two authenticated professionals; user B must not list, read, edit, or attach data owned by user A.
8. **Post-deploy smoke contract** — a separate Playwright smoke project/spec capable of targeting a supplied base URL and using a dedicated synthetic test account; it must be opt-in and must not touch real patient data.

## Architecture

The existing `tests/helpers/cloudflare-local.mjs` remains the source of the local Worker/D1/R2 runtime. P0 adds small test helpers for browser login/session inspection and synthetic API records instead of duplicating setup in every spec. Playwright keeps the local Chromium project for PR gating and gains an explicit smoke configuration path for post-deploy validation.

The CI gate is a dedicated workflow. It runs `npm ci`, installs only Chromium, runs `npm run test:e2e`, and uploads `artifacts/e2e-results` plus `artifacts/playwright-report` when the suite fails. This workflow is independent from the Node contract workflows so a green contract suite cannot mask a broken browser flow.

## Error handling and determinism

Network-failure tests use Playwright routing to inject one controlled failure at a time. Assertions verify both browser state and backend state. Every test uses unique synthetic names/IDs so tests are deterministic and do not depend on ordering. Runtime data is ephemeral Miniflare state.

The production smoke test is guarded by environment variables and skips unless explicitly enabled. It may create only records clearly prefixed as E2E synthetic data and must clean them when the production API supports a safe cleanup path; otherwise P0 smoke remains read-only.

## Acceptance criteria

- A deliberate break in login or patient creation makes the E2E workflow fail.
- The workflow is present on PRs touching runtime/UI/test files and on this hardening branch.
- Session survives temporary transport/server failures but is removed on actual authentication rejection.
- Lost patient-create responses cannot produce duplicate mothers.
- Injected late edit failure cannot leave a partially edited patient.
- A second professional cannot access the first professional's clinical data.
- All local E2E scenarios pass on Chromium against Miniflare + synthetic D1/R2.
- Post-deploy smoke remains explicit/opt-in and contains no dependency on paid infrastructure.
