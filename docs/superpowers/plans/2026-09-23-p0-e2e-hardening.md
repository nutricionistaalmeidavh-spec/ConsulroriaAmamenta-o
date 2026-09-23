# P0 E2E Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make browser-level regression coverage a mandatory gate for the highest-risk authentication, patient, clinical, resilience, isolation, and smoke flows.

**Architecture:** Extend the existing Playwright + Miniflare test harness rather than adding a new test framework. Keep test-only utilities under `tests/e2e`, use the existing synthetic D1/R2 runtime, and add a dedicated GitHub Actions workflow that runs Chromium E2E independently from Node contract checks.

**Tech Stack:** Node 22, Playwright 1.58.2, Chromium, Miniflare 4, Cloudflare Worker runtime, D1/R2 synthetic local state, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-23-p0-e2e-hardening-design.md`

## Global Constraints

- Branch: `test/p0-e2e-hardening`; no merge.
- No paid service is required.
- No real patient data.
- Chromium is the mandatory P0 browser.
- Production smoke is explicit/opt-in only.

## Review Focus

- Temporary 503/429/offline responses must not erase a valid session.
- Lost create response after persistence must not duplicate a patient.
- A late edit failure must roll back all patient-related writes.
- User B must never read or mutate user A clinical records.
- Post-deploy smoke must remain synthetic/read-only unless safe cleanup exists.

---

### Task 1: Shared browser test helpers

**Files:**
- Create: `tests/e2e/helpers.mjs`
- Test: consumed by all new specs.

**Interfaces:**
- Produces: `login(page, email?)`, `session(page)`, `authHeaders(page)`, `uniqueLabel(prefix)`.

- [ ] **Step 1: Add helper module**

```js
import { credentials } from '../helpers/cloudflare-local.mjs';
export async function login(page, email = credentials.email) {
  await page.goto('/app/');
  await page.locator('[data-login-form] [name=email]').fill(email);
  await page.locator('[data-login-form] [name=password]').fill(credentials.password);
  await page.locator('[data-login-form] button[type=submit]').click();
  await page.locator('[data-app-root]').waitFor({ state: 'visible' });
}
export async function session(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('debora-lactacao-session')));
}
export async function authHeaders(page) {
  const value = await session(page);
  return { authorization: `Bearer ${value.access_token}` };
}
export function uniqueLabel(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
```

- [ ] **Step 2: Run existing E2E suite**

Run: `npm run test:e2e`
Expected: existing four E2E tests still pass.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/helpers.mjs
git commit -m "test: add shared Playwright helpers"
```

### Task 2: Mandatory E2E CI workflow

**Files:**
- Create: `.github/workflows/validate-e2e.yml`

**Interfaces:**
- Consumes: `npm run test:e2e`.
- Produces: independent required-style CI status `Validate E2E`.

- [ ] **Step 1: Add workflow**

```yaml
name: Validate E2E
on:
  push:
    branches: [main, test/p0-e2e-hardening]
  pull_request:
    paths:
      - 'app/**'
      - 'public/**'
      - 'worker/**'
      - 'cloudflare/**'
      - 'src/**'
      - 'tests/e2e/**'
      - 'tests/helpers/**'
      - 'package.json'
      - 'package-lock.json'
      - 'playwright.config.mjs'
      - '.github/workflows/validate-e2e.yml'
jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
      - run: npm ci --no-audit --no-fund
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
      - if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-failure
          path: |
            artifacts/e2e-results
            artifacts/playwright-report
          if-no-files-found: ignore
```

- [ ] **Step 2: Commit and observe workflow on branch**

Expected: workflow starts for `test/p0-e2e-hardening` and existing E2E suite passes.

### Task 3: Authentication/session resilience E2E

**Files:**
- Create: `tests/e2e/auth-session.spec.mjs`

**Interfaces:**
- Consumes: shared `login`, `session` helpers.

- [ ] **Step 1: Add failing browser tests**

Cover reload persistence, one-shot 503, one-shot 429, offline/online, and obsolete alias session not overriding the canonical session. Each test asserts `[data-app-root]` remains visible and the canonical access token is unchanged after temporary transport errors.

- [ ] **Step 2: Run only the spec**

Run: `npx playwright test tests/e2e/auth-session.spec.mjs`
Expected before any production fix: failures identify any remaining session regression.

- [ ] **Step 3: If needed, make the smallest production correction and rerun**

Run: `npx playwright test tests/e2e/auth-session.spec.mjs`
Expected: PASS.

### Task 4: Patient idempotency and atomic edit E2E

**Files:**
- Create: `tests/e2e/patient-critical.spec.mjs`

**Interfaces:**
- Consumes: existing `/api/clinical/patients` route and record APIs.

- [ ] **Step 1: Preserve and extend lost-response scenario**

Create a unique mother/baby, abort the first successful response, retry from UI, assert both requests share one idempotency key and D1 returns exactly one mother.

- [ ] **Step 2: Add successful edit/reload scenario**

Edit mother and baby, reload, assert both persisted.

- [ ] **Step 3: Add late-failure rollback scenario**

Inject a controlled backend failure for the edit request and assert the UI reports failure; after reload, query the mother/baby records and verify neither partial value survived.

- [ ] **Step 4: Run spec**

Run: `npx playwright test tests/e2e/patient-critical.spec.mjs`
Expected: PASS.

### Task 5: Clinical persistence E2E

**Files:**
- Create: `tests/e2e/clinical-persistence.spec.mjs`

**Interfaces:**
- Consumes: authenticated clinical records API and current encounter UI/route.

- [ ] **Step 1: Create synthetic patient**

Use UI creation so the patient exists exactly as a user creates it.

- [ ] **Step 2: Start/create encounter through the supported path**

Assert the encounter is linked to the patient's mother/baby IDs.

- [ ] **Step 3: Reload and verify persistence**

Reload application, reopen the same patient/encounter, and assert the persisted clinical state remains attached to that patient only.

- [ ] **Step 4: Run spec**

Run: `npx playwright test tests/e2e/clinical-persistence.spec.mjs`
Expected: PASS.

### Task 6: Network failure matrix

**Files:**
- Create: `tests/e2e/network-resilience.spec.mjs`

**Interfaces:**
- Uses Playwright `page.route` to inject failures without changing production code.

- [ ] **Step 1: Test read failures**

Inject one 503 and one 429 on clinical reads; assert session is preserved and retry/reload recovers.

- [ ] **Step 2: Test aborted write response**

Allow the backend write to complete, abort the browser response, retry, and assert idempotency prevents duplication.

- [ ] **Step 3: Test delayed response and offline/online**

Delay a clinical read, ensure editable UI is not exposed prematurely, then toggle context offline/online and verify recovery without session loss.

- [ ] **Step 4: Run spec**

Run: `npx playwright test tests/e2e/network-resilience.spec.mjs`
Expected: PASS.

### Task 7: Cross-user isolation E2E

**Files:**
- Create: `tests/e2e/isolation.spec.mjs`

**Interfaces:**
- Uses the two synthetic users already seeded by `tests/helpers/cloudflare-local.mjs`.

- [ ] **Step 1: User A creates patient**

Capture the created mother ID.

- [ ] **Step 2: User B logs in**

Use `other@example.test` with the same local synthetic password.

- [ ] **Step 3: Assert list/read/edit isolation**

User B list query must not contain A's mother. Direct read/edit attempts using A's ID must return an authorization-safe not-found/forbidden response and must not mutate A's record.

- [ ] **Step 4: Re-login as A and verify unchanged data**

Run: `npx playwright test tests/e2e/isolation.spec.mjs`
Expected: PASS.

### Task 8: Opt-in post-deploy smoke

**Files:**
- Create: `tests/e2e/smoke-production.spec.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `E2E_SMOKE_BASE_URL`, `E2E_SMOKE_EMAIL`, `E2E_SMOKE_PASSWORD`, `E2E_SMOKE_ENABLED=1`.
- Produces: `npm run test:e2e:smoke`.

- [ ] **Step 1: Add guarded smoke spec**

Skip unless `E2E_SMOKE_ENABLED === '1'`. Open the supplied base URL, verify landing/app availability, authenticate the dedicated synthetic account, load the app root, list patients, and logout. Do not create or mutate clinical data in P0 smoke.

- [ ] **Step 2: Add package script**

```json
"test:e2e:smoke": "playwright test tests/e2e/smoke-production.spec.mjs"
```

- [ ] **Step 3: Verify default safety**

Run: `npm run test:e2e:smoke`
Expected: skipped, zero production writes.

### Task 9: Whole-branch verification

**Files:** no new files.

- [ ] **Step 1: Run Node stability suite**

Run: `npm run test:stability`
Expected: PASS.

- [ ] **Step 2: Run complete E2E suite**

Run: `npm run test:e2e`
Expected: all local Chromium E2E tests pass; production smoke skips by default.

- [ ] **Step 3: Run build and syntax checks**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Inspect GitHub Actions status on branch**

Expected: `Validate E2E`, `Validate SaaS foundation`, `Validate clinical source consolidation`, and relevant existing workflows are green.

- [ ] **Step 5: Stop without merging**

Report branch name, commits, test counts, workflow status, and any uncovered residual risk. Do not merge.
