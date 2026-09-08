# Canonical Multi-client App Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Débora client 1 of one generic canonical clinical app, preserve her current `/` and `/#/...` links and all existing clinical data, add `/app/` for all customers, keep `/comercial/` generic, and restore `/debora/` as her isolated personal landing.

**Architecture:** Keep `public/clinical-source/` as the only clinical UI/runtime. Add a small runtime identity/base-path seam so both root and `/app/` load the same source. Resolve the professional display name after authentication from `professional_profiles` when available, then from auth metadata/email as fallback; never use `Débora` as generic product copy. Preserve existing `owner_id`/RLS ownership without data rewrites.

**Tech Stack:** Vite 6, vanilla JavaScript/HTML/CSS, Supabase Auth/PostgREST/RLS, Cloudflare Workers static assets, Node contract tests.

**Spec:** `docs/superpowers/specs/2026-09-07-canonical-multiclient-app-routing-design.md`

## Global Constraints

- Existing `/` and `/#/patient/:id` links must continue to work.
- Existing Débora clinical IDs and `owner_id` values must not be updated, deleted, cloned, re-keyed or migrated.
- `Débora` is a professional/customer name only; it is not the generic product name.
- `/debora/` is the only dedicated Débora marketing surface.
- `/comercial/` remains the generic sales/signup/checkout funnel.
- `/app/` is the canonical application entry for new customers.
- Existing RLS and `owner_id` remain the authoritative data isolation boundary.
- Freemium remains capped at 3 mothers/patients and blocks photo/video upload; Pro keeps current unlimited/media entitlements.
- Existing plan codes, prices, Asaas checkout semantics and deferred Pro email-confirmation order must remain unchanged.
- No destructive production database migration is authorized.

---

### Task 1: Data-safety preflight and routing contract

**Files:**
- Create: `scripts/test-canonical-app-routing.mjs`
- Modify: `.github/workflows/validate-clinical-source-consolidation.yml`

**Interfaces:**
- Consumes: current `index.html`, `src/bootstrap.js`, `public/clinical-source/*`, `public/comercial/*`.
- Produces: a static regression contract that protects root deep links, generic product identity, `/app/`, `/debora/`, and the absence of destructive ownership migration code.

- [ ] **Step 1: Perform the production read-only ownership audit**

Use Supabase read-only queries only. Record aggregate counts by `owner_id` for `mothers`, `babies`, `appointments`, `clinical_encounters`, `weights`, `followups`, `financial_entries`, `consents`, `library_items`, and `clinical_media` where those tables exist. Do not write, delete, update, or export clinical content. Stop if ownership is mixed/missing in a way that contradicts existing RLS assumptions.

- [ ] **Step 2: Write the failing contract test**

Create `scripts/test-canonical-app-routing.mjs` with assertions equivalent to:

```js
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const root = readFileSync('index.html', 'utf8');
const bootstrap = readFileSync('src/bootstrap.js', 'utf8');
const shell = readFileSync('public/clinical-source/core/app-shell.js', 'utf8');
const config = readFileSync('public/clinical-source/config.js', 'utf8');

assert.ok(existsSync('app/index.html'), 'canonical /app entry must exist');
assert.ok(existsSync('public/debora/index.html'), 'dedicated /debora landing must exist');
assert.match(root, /src\/bootstrap\.js/);
assert.match(bootstrap, /CANONICAL_PRODUCT_NAME/);
assert.doesNotMatch(config, /APP_NAME:\s*['\"]Débora Lactação/);
assert.doesNotMatch(shell, /title:\s*['\"]Débora Lactação|<h1>Débora Lactação|Olá, Débora/);
assert.match(shell, /professional_profiles/);
assert.match(shell, /owner_id=eq\./);

for (const file of ['supabase/phase-saas-foundation.sql','supabase/phase-saas-enforcement.sql']) {
  const sql = readFileSync(file, 'utf8');
  assert.doesNotMatch(sql, /update\s+(mothers|babies|appointments|clinical_encounters)\s+set\s+owner_id/i);
  assert.doesNotMatch(sql, /delete\s+from\s+(mothers|babies|appointments|clinical_encounters)/i);
}
```

- [ ] **Step 3: Run the test and confirm RED**

Run:

```bash
node scripts/test-canonical-app-routing.mjs
```

Expected: failure because `/app/`, `/debora/`, the generic identity seam and profile-driven shell do not exist yet.

- [ ] **Step 4: Add the test to the existing clinical-source workflow**

Add one CI step:

```yaml
- name: Validate canonical multi-client routing
  run: node scripts/test-canonical-app-routing.mjs
```

Keep all existing workflow steps unchanged.

- [ ] **Step 5: Commit the RED contract**

```bash
git add scripts/test-canonical-app-routing.mjs .github/workflows/validate-clinical-source-consolidation.yml
git commit -m "test: define canonical multi-client app contract"
```

---

### Task 2: Generic application identity seam

**Files:**
- Create: `src/app-identity.js`
- Modify: `index.html`
- Modify: `src/bootstrap.js`
- Modify: `public/clinical-source/config.js`
- Modify: `public/clinical-source/index.html`
- Modify: `public/clinical-source/core/lib/auth-service.js`
- Modify: `public/clinical-source/core/app-shell.js`

**Interfaces:**
- Produces: `resolveAppIdentity(locationLike)` returning `{ productName, productShortName, entryMode, basePath }` and a canonical global `window.CANONICAL_APP_CONTEXT` injected before the clinical shell boots.
- Consumes later: `/app/` entry and profile-driven UI.

- [ ] **Step 1: Add unit-level assertions for identity resolution**

Extend `scripts/test-canonical-app-routing.mjs` to import `resolveAppIdentity` and verify:

```js
assert.deepEqual(resolveAppIdentity({ pathname: '/' }), {
  productName: 'Gestão de Amamentação',
  productShortName: 'Amamentação',
  entryMode: 'compat',
  basePath: '/',
});
assert.equal(resolveAppIdentity({ pathname: '/app/' }).entryMode, 'app');
assert.equal(resolveAppIdentity({ pathname: '/app/' }).basePath, '/app/');
```

- [ ] **Step 2: Run and confirm RED**

```bash
node scripts/test-canonical-app-routing.mjs
```

Expected: import/module missing.

- [ ] **Step 3: Implement `src/app-identity.js`**

Use one pure resolver:

```js
export const CANONICAL_PRODUCT_NAME = 'Gestão de Amamentação';
export const CANONICAL_PRODUCT_SHORT_NAME = 'Amamentação';

export function resolveAppIdentity(locationLike = window.location) {
  const path = String(locationLike?.pathname || '/');
  const appEntry = path === '/app' || path.startsWith('/app/');
  return Object.freeze({
    productName: CANONICAL_PRODUCT_NAME,
    productShortName: CANONICAL_PRODUCT_SHORT_NAME,
    entryMode: appEntry ? 'app' : 'compat',
    basePath: appEntry ? '/app/' : '/',
  });
}
```

- [ ] **Step 4: Make root HTML generic without changing the route**

Change `index.html` to use generic title/loading copy and keep the same root scripts. The root remains an app entry, not a marketing page.

- [ ] **Step 5: Inject canonical context from bootstrap**

At the top of `src/bootstrap.js`, import `resolveAppIdentity`, set:

```js
const APP_CONTEXT = resolveAppIdentity(window.location);
window.CANONICAL_APP_CONTEXT = APP_CONTEXT;
const APP_URL = `${window.location.origin}${APP_CONTEXT.basePath}`;
const CLINICAL_SOURCE_ROOT = '/clinical-source';
```

Convert root-relative runtime feature assets in generated HTML to absolute `/...` URLs so the same bootstrap works under `/` and `/app/`.

- [ ] **Step 6: Genericize clinical config and shell copy**

Change `public/clinical-source/config.js` to keep Supabase config but replace `APP_NAME: 'Débora Lactação'` with `APP_NAME: 'Gestão de Amamentação'`.

In `public/clinical-source/index.html`, replace fixed product/customer branding with generic hooks such as:

```html
<strong data-product-name>Gestão de Amamentação</strong>
<strong data-professional-name>Profissional</strong>
```

Do not alter screen structure or clinical fields.

- [ ] **Step 7: Remove hard-coded Débora metadata from signup**

Change `createAuthService.signUp` to accept optional metadata:

```js
signUp: (email, password, metadata = {}) =>
  client.signUp(String(email || '').trim(), String(password || ''), metadata),
```

The generic app must not create users with `{ display_name: 'Débora' }`.

- [ ] **Step 8: Replace customer-specific runtime strings**

In `app-shell.js`, replace generic product references in page titles, PDF title, backup filename, and fallback copy with values from:

```js
const appContext = globalThis.CANONICAL_APP_CONTEXT || {};
const productName = appContext.productName || config.APP_NAME || 'Gestão de Amamentação';
```

Professional-specific copy must come from the authenticated identity task below, not `productName`.

- [ ] **Step 9: Run focused tests and build**

```bash
node scripts/test-canonical-app-routing.mjs
node scripts/test-clinical-source-consolidation.mjs
npm run build
```

Expected: identity portions pass; profile and `/app/` assertions may still fail until the next task if split exactly at this checkpoint. Clinical source equivalence/build must remain green except for intentional generic branding deltas covered by updated contract.

- [ ] **Step 10: Commit**

```bash
git add src/app-identity.js index.html src/bootstrap.js public/clinical-source/config.js public/clinical-source/index.html public/clinical-source/core/lib/auth-service.js public/clinical-source/core/app-shell.js scripts/test-canonical-app-routing.mjs
git commit -m "refactor: make clinical runtime customer-neutral"
```

---

### Task 3: Resolve authenticated professional identity without touching clinical ownership

**Files:**
- Modify: `public/clinical-source/core/app-shell.js`
- Modify: `scripts/test-canonical-app-routing.mjs`

**Interfaces:**
- Produces: `loadProfessionalIdentity(session)` behavior inside the shell; reads `professional_profiles` only for the authenticated `owner_id`.
- Does not write clinical rows or ownership.

- [ ] **Step 1: Add failing profile-resolution contract**

Require the shell to contain a read equivalent to:

```js
const rows = await repositories.client.rest('professional_profiles', {
  query: `select=professional_name,business_name&owner_id=eq.${encodeURIComponent(userId)}&limit=1`,
});
```

and forbid any client-side cross-owner list query.

- [ ] **Step 2: Run RED**

```bash
node scripts/test-canonical-app-routing.mjs
```

Expected: profile identity assertion fails.

- [ ] **Step 3: Implement professional identity resolution**

Add a focused helper in `app-shell.js`:

```js
async function loadProfessionalIdentity(session) {
  const user = session?.user || session;
  const userId = user?.id;
  const fallback = String(user?.user_metadata?.display_name || user?.email || 'Profissional').split('@')[0];
  if (!userId) return fallback;
  try {
    const rows = await repositories.client.rest('professional_profiles', {
      query: `select=professional_name,business_name&owner_id=eq.${encodeURIComponent(userId)}&limit=1`,
    });
    return rows?.[0]?.professional_name || rows?.[0]?.business_name || fallback;
  } catch {
    return fallback;
  }
}
```

Apply the result only to `[data-professional-name]`, greeting text and other professional identity labels. Do not use it to alter product name or data filtering.

- [ ] **Step 4: Start the app from the existing authenticated session**

Change `startApp()` to accept the session and call identity resolution before rendering data:

```js
async function startApp(session = authService.getSession()) {
  const professionalName = await loadProfessionalIdentity(session);
  document.querySelectorAll('[data-professional-name]').forEach((el) => { el.textContent = professionalName; });
  // existing refreshData / renderRoute continues unchanged
}
```

Use the result of `signIn`, signup session, and `getSession()` when available; do not change session storage or clinical repositories.

- [ ] **Step 5: Verify**

```bash
node scripts/test-canonical-app-routing.mjs
node scripts/test-clinical-source-consolidation.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/clinical-source/core/app-shell.js scripts/test-canonical-app-routing.mjs
git commit -m "feat: personalize canonical app by authenticated professional"
```

---

### Task 4: Add `/app/` as a second Vite HTML entry using the same bootstrap

**Files:**
- Create: `app/index.html`
- Create: `vite.config.js`
- Modify: `src/bootstrap.js`
- Modify: `scripts/test-canonical-app-routing.mjs`

**Interfaces:**
- Produces: build output `dist/app/index.html` pointing to the same compiled `src/bootstrap.js` module as root.
- Preserves: root `/` and `/#/...` behavior.

- [ ] **Step 1: Extend the contract**

Assert `app/index.html` imports `/src/bootstrap.js`, and `vite.config.js` has both HTML inputs:

```js
input: {
  main: resolve(__dirname, 'index.html'),
  app: resolve(__dirname, 'app/index.html'),
}
```

- [ ] **Step 2: Run RED**

```bash
node scripts/test-canonical-app-routing.mjs
```

- [ ] **Step 3: Create `app/index.html`**

Use the same generic shell as root with absolute app assets:

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Gestão de Amamentação</title>
  <meta name="theme-color" content="#fbf7f4">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="icon" type="image/png" href="/icon-192.png?v=1.12.1">
</head>
<body>
  <div id="app" style="font-family:system-ui;padding:24px">Carregando Gestão de Amamentação…</div>
  <script type="module" src="/src/bootstrap.js"></script>
  <script type="module" src="/phase02-loader.js"></script>
  <script type="module" src="/phase35-loader.js"></script>
  <script type="module" src="/phase68-loader.js"></script>
</body>
</html>
```

- [ ] **Step 4: Add Vite multi-page configuration**

Create `vite.config.js` with `build.rollupOptions.input` containing root and `/app/`. Keep defaults otherwise.

- [ ] **Step 5: Verify build artifacts**

```bash
npm run build
test -f dist/index.html
test -f dist/app/index.html
```

Expected: both HTML entries exist and reference built assets.

- [ ] **Step 6: Verify deep-link semantics remain hash-based**

The clinical router must continue mapping `#/patient/:id` independent of `pathname`; no route parser changes are needed beyond preserving hash handling.

- [ ] **Step 7: Commit**

```bash
git add app/index.html vite.config.js src/bootstrap.js scripts/test-canonical-app-routing.mjs
git commit -m "feat: add canonical app route without forking runtime"
```

---

### Task 5: Commercial handoff to `/app/` without changing checkout semantics

**Files:**
- Modify: `public/comercial/app.js`
- Modify: `public/comercial/purchase-status.js` and/or `public/comercial/compra-concluida.html` only where the current successful completion CTA/redirect is defined
- Modify: `scripts/test-commercial-funnel.mjs`
- Modify: `scripts/test-deferred-email-flow.mjs`
- Modify: `scripts/test-canonical-app-routing.mjs`

**Interfaces:**
- Consumes: existing commercial session, onboarding and payment verification.
- Produces: successful ready-to-use commercial account destination `/app/`.
- Must not alter plan codes `freemium`, `pro_monthly`, `pro_annual`, prices, Asaas payloads, or deferred confirmation ordering.

- [ ] **Step 1: Add failing destination assertions**

Require successful Freemium completion and verified Pro post-purchase completion to expose `/app/` as the application destination, while cancellation/expired/error paths remain in `/comercial/`.

- [ ] **Step 2: Run commercial tests RED**

```bash
node scripts/test-commercial-funnel.mjs
node scripts/test-deferred-email-flow.mjs
node scripts/test-canonical-app-routing.mjs
```

- [ ] **Step 3: Change only successful app-entry destinations**

Use:

```js
const CANONICAL_APP_URL = '/app/';
```

Do not change checkout creation, payment verification, email confirmation, session creation, or plan selection.

- [ ] **Step 4: Re-run commercial/Asaas regression checks**

```bash
node scripts/test-commercial-funnel.mjs
node scripts/test-commercial-checkout-return.mjs
node scripts/test-deferred-email-flow.mjs
node scripts/test-cloudflare-asaas.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/comercial/app.js public/comercial/purchase-status.js public/comercial/compra-concluida.html scripts/test-commercial-funnel.mjs scripts/test-deferred-email-flow.mjs scripts/test-canonical-app-routing.mjs
git commit -m "feat: hand commercial customers into canonical app"
```

---

### Task 6: Restore isolated `/debora/` landing

**Files:**
- Create: `public/debora/index.html`
- Create: `public/debora/styles.css`
- Create only if needed: `public/debora/landing.js`
- Modify: `scripts/test-canonical-app-routing.mjs`

**Interfaces:**
- Public marketing-only surface.
- CTA destination: canonical root app `/` for backwards compatibility with Débora's existing workflow.
- No Supabase clinical reads and no SaaS plan/account state.

- [ ] **Step 1: Add isolation assertions**

Require:

```js
const landing = readFileSync('public/debora/index.html', 'utf8');
assert.match(landing, /Débora/);
assert.match(landing, /href=["']\/["']/);
assert.doesNotMatch(landing, /saas_accounts|subscriptions|entitlements|clinical_encounters|mothers\?/);
```

- [ ] **Step 2: Run RED**

```bash
node scripts/test-canonical-app-routing.mjs
```

- [ ] **Step 3: Restore/recreate the personal landing as a standalone surface**

Use the previously approved Débora visual direction if recoverable from repository/history. Keep all content static/public and place the access CTA at `/`. Do not reuse the commercial plan cards or commercial signup modal.

- [ ] **Step 4: Verify isolation**

```bash
node scripts/test-canonical-app-routing.mjs
npm run build
test -f dist/debora/index.html
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/debora scripts/test-canonical-app-routing.mjs
git commit -m "feat: restore isolated Debora personal landing"
```

---

### Task 7: Consolidate commercial previews onto canonical demo UI

**Files:**
- Modify: `public/comercial/product-preview.html`
- Modify: `public/comercial/landing.js`
- Modify: `public/comercial/real-preview.css`
- Modify: `scripts/test-commercial-landing.mjs`
- Modify: `scripts/test-canonical-app-routing.mjs`

**Interfaces:**
- Produces: deterministic synthetic preview state derived from canonical clinical styles/components.
- Must never authenticate or read production clinical data.

- [ ] **Step 1: Add no-production-data preview assertions**

Require previews to carry an explicit demo marker such as:

```html
<body data-canonical-demo="true">
```

and assert the preview source contains no Supabase URL, publishable key, auth fetch or production REST table access.

- [ ] **Step 2: Run RED if current preview does not meet the canonical demo contract**

```bash
node scripts/test-commercial-landing.mjs
node scripts/test-canonical-app-routing.mjs
```

- [ ] **Step 3: Reuse canonical product identity and styles**

Keep synthetic fixture data, but derive product shell labels/styles from canonical generic assets. Remove any remaining second-product naming or Débora-specific identity.

- [ ] **Step 4: Preserve the corrected mobile carousel/card framing**

Do not regress the existing card rotation, crop fixes, stacked plan comparison, footer logo, or responsive sizing.

- [ ] **Step 5: Verify landing contracts**

```bash
node scripts/test-commercial-landing.mjs
node scripts/test-canonical-app-routing.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/comercial/product-preview.html public/comercial/landing.js public/comercial/real-preview.css scripts/test-commercial-landing.mjs scripts/test-canonical-app-routing.mjs
git commit -m "refactor: align commercial previews with canonical app"
```

---

### Task 8: Integrated verification and data-preservation gate

**Files:**
- No production-code changes unless a failing check identifies a scoped defect.

**Interfaces:**
- Verifies all acceptance criteria across routing, clinical runtime, SaaS billing and data ownership.

- [ ] **Step 1: Run focused routing/identity checks**

```bash
node scripts/test-canonical-app-routing.mjs
node scripts/test-clinical-source-consolidation.mjs
```

- [ ] **Step 2: Run commercial/SaaS regressions**

```bash
node scripts/test-commercial-funnel.mjs
node scripts/test-commercial-landing.mjs
node scripts/test-commercial-checkout-return.mjs
node scripts/test-deferred-email-flow.mjs
node scripts/test-billing-scaffold.mjs
node scripts/test-cloudflare-asaas.mjs
```

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: exit 0 with `dist/index.html`, `dist/app/index.html`, `dist/comercial/index.html`, and `dist/debora/index.html` present.

- [ ] **Step 4: Repeat read-only production ownership audit**

Compare the same aggregate `owner_id` counts captured before implementation. Expected: no clinical table row-count/owner redistribution caused by this routing/branding work.

- [ ] **Step 5: Verify Débora compatibility URLs**

Confirm production-like routing for:

```text
/
/#/patient/<existing-id>
/app/
/app/#/patient/<synthetic-or-authorized-test-id>
/debora/
/comercial/
```

Never use or log patient content while checking routes.

- [ ] **Step 6: Review integrated diff**

Confirm:
- no clinical migration SQL was added;
- no `owner_id` update/delete exists;
- no plan price/code changed;
- no Asaas payment/email order changed;
- no hard-coded `Débora` remains in generic product surfaces;
- `/debora/` remains marketing-only;
- root remains an app entry.

- [ ] **Step 7: Final commit if verification-only test adjustments were needed**

```bash
git add -A
git commit -m "test: verify canonical multi-client integration"
```
