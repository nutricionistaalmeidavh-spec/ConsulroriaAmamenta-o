# Weight UI and Encounter Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the remaining P1 work in PR #69 by making the approved V5 weight-history UI deterministic and by keeping clinical encounter identity consistent while preserving an explicitly overridden commercial billing service.

**Architecture:** Keep the existing growth data producer and V5 presentation, but replace the endlessly-reset V5 debounce with a single-flight-style scheduled render so DOM churn cannot leave the old UI visible. Keep `identification.appointmentType` and `identification.format` as the clinical identity; add an explicit per-draft billing-service override flag so billing follows appointment type only until the professional manually changes the service.

**Tech Stack:** Vanilla JavaScript, DOM APIs, Node `node:test`, `vm`, Playwright, Vite/Cloudflare materialized frontend.

**Spec:** `docs/superpowers/specs/2026-09-24-weight-and-encounter-consistency-design.md`

## Global Constraints

- Keep the approved weight-history UI: current weight, birth weight, balance, measurement count, and timeline with gram/percentage deltas.
- Do not reintroduce the previous burst of `Failed to fetch` errors or duplicate network work.
- Do not change clinical persistence semantics unrelated to these two P1 items.
- Keep billing `service_label` as a distinct commercial field.
- `appointmentType` and `format` are the canonical clinical encounter identity fields.
- Billing follows `appointmentType` only until the professional explicitly edits the billing service.
- Preserve the current self-hosted / zero-recurring-cost architecture; add no paid dependency.
- Add regression coverage that asserts final rendered behavior, not merely asset presence.
- Do not add a database/schema migration.

## Review Focus

- Continuous DOM mutations must not postpone V5 rendering indefinitely; the first pending pass must still execute.
- A weight-source remount/update must rebuild V5 with the new measurements rather than preserve stale rendered values.
- Manual billing-service override must survive wizard back/forward navigation and billing remount for the same draft.
- Billing-service override must not leak to another mother/appointment draft.
- A persisted billing row remains authoritative on hydration, while clinical note/context continue to use persisted clinical `appointmentType` + `format`.

---

### Task 1: Lock the approved V5 weight-history presentation with failing regression tests

**Files:**
- Modify: `tests/clinical-source-weight-package-regression.test.mjs`
- Read/verify: `public/weight-evolution-v5.js`

**Interfaces:**
- Consumes: V4 host `[data-weight-changes-v4]` containing `.gf-weight-change-row` source rows.
- Produces: regression contract that requires `.gf-weight-changes-v5`, `Evolução do peso`, `Trajetória desde o nascimento`, summary values, delta chips, and a non-postponing scheduler.

- [ ] **Step 1: Add a small DOM harness for the V5 script**

Add a focused harness to `tests/clinical-source-weight-package-regression.test.mjs` that can execute `weightSource` in `vm`, expose one `[data-weight-changes-v4]` host, model source rows with `querySelector(':scope > div')` / `querySelector('p')`, capture `innerHTML`, track `classList.add`, capture the installed `MutationObserver`, and queue timeout callbacks instead of running them immediately.

The harness must expose helpers equivalent to:

```js
function weightRow(date, weight, primary='') {
  return {
    querySelector(selector) {
      if (selector === ':scope > div') return {
        querySelector(child) {
          if (child === 'span') return { textContent: date };
          if (child === 'strong') return { textContent: `${weight} g` };
          return null;
        },
      };
      if (selector === 'p') return { textContent: primary };
      return null;
    },
  };
}
```

and return `{host, observer, runNextTimer, runAllTimers}` so scheduler behavior can be asserted directly.

- [ ] **Step 2: Add a failing final-render test**

Add a test using representative rows:

```js
[
  weightRow('01/09/2026', 1944, 'Peso ao nascer'),
  weightRow('04/09/2026', 1860, 'Perda'),
  weightRow('10/09/2026', 2100, 'Ganho'),
  weightRow('23/09/2026', 2290, 'Ganho'),
]
```

Assert after the scheduled render:

```js
assert.equal(host.classList.contains('gf-weight-changes-v5'), true);
assert.match(host.innerHTML, /Evolução do peso/);
assert.match(host.innerHTML, /Trajetória desde o nascimento/);
assert.match(host.innerHTML, /4 medições/);
assert.match(host.innerHTML, /1\.944 g/);
assert.match(host.innerHTML, /2\.290 g/);
assert.match(host.innerHTML, /\+346 g/);
assert.match(host.innerHTML, /Peso ao nascer/);
assert.match(host.innerHTML, /84 g/); // first loss magnitude
assert.match(host.innerHTML, /240 g/); // subsequent gain magnitude
```

Also assert the original V4 row markup is no longer the final visible markup by ensuring the final `innerHTML` is V5-generated.

- [ ] **Step 3: Add a failing scheduler regression test**

Simulate a burst of mutations by calling the captured observer callback repeatedly before executing timers. Assert only one pending timer is created and that repeated calls do not cancel/postpone it.

The test should pin behavior like:

```js
observer.callback();
observer.callback();
observer.callback();
assert.equal(pendingTimerCount(), 1);
runNextTimer();
assert.equal(host.classList.contains('gf-weight-changes-v5'), true);
```

This test should fail against the current `clearTimeout(timer); timer=setTimeout(...)` implementation.

- [ ] **Step 4: Add a failing source-update/remount test**

After the first V5 render, replace the source rows in the harness with a new fifth measurement, reset the host to source markup as the V4 producer would, trigger the observer, run the timer, and assert the V5 output updates to `5 medições` and the new current/saldo value.

- [ ] **Step 5: Run the focused test and confirm RED**

Run:

```bash
node --test tests/clinical-source-weight-package-regression.test.mjs
```

Expected: at least the scheduler regression fails because current V5 reschedules via `clearTimeout`.

- [ ] **Step 6: Commit only the failing tests**

```bash
git add tests/clinical-source-weight-package-regression.test.mjs
git commit -m "test: lock weight history v5 rendering"
```

---

### Task 2: Make V5 mounting deterministic without adding network work

**Files:**
- Modify: `public/weight-evolution-v5.js`
- Test: `tests/clinical-source-weight-package-regression.test.mjs`

**Interfaces:**
- Consumes: existing V4 source rows in `[data-weight-changes-v4]`.
- Produces: `schedule()` with at most one pending pass; `enhanceAll()` still renders from already-available DOM data and performs no fetch.

- [ ] **Step 1: Replace resettable debounce with one-pending-pass scheduling**

Change the scheduler from:

```js
let timer;
function schedule(){clearTimeout(timer);timer=setTimeout(enhanceAll,60)}
```

to a non-postponing pattern:

```js
let timer=null;
function schedule(){
  if(timer!==null)return;
  timer=setTimeout(()=>{
    timer=null;
    enhanceAll();
  },60);
}
```

Keep the existing `MutationObserver`, `hashchange` hook, and immediate `enhanceAll()` call. Do not add `fetch`, `DeboraRuntimeClient`, or any other request path to `weight-evolution-v5.js`.

- [ ] **Step 2: Preserve source-signature idempotency**

Keep `data-v5-signature` / `data-v5-enhanced` semantics so the same source data does not cause unnecessary rewrites. Ensure a changed source signature still rebuilds the V5 markup.

- [ ] **Step 3: Run the focused weight regression suite**

Run:

```bash
node --test tests/clinical-source-weight-package-regression.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Run patient UI integrity tests**

Run:

```bash
node --test tests/patient-ui-integrity.test.mjs
```

Expected: PASS, including route-guard/cache-reset expectations.

- [ ] **Step 5: Commit the runtime fix**

```bash
git add public/weight-evolution-v5.js tests/clinical-source-weight-package-regression.test.mjs
git commit -m "fix: make weight v5 mounting deterministic"
```

---

### Task 3: Add failing billing-service override tests

**Files:**
- Modify: `tests/clinical-source-weight-package-regression.test.mjs`
- Read/verify: `public/billing-v2.js`

**Interfaces:**
- Consumes: `data-encounter-choice[data-field="appointmentType"]`, `[data-bv-service]`, session draft key `debora-billing-v2-draft`, mother ID, appointment ID.
- Produces: test contract for auto-follow before manual override and preservation after explicit override.

- [ ] **Step 1: Extend the billing DOM harness**

Add enough DOM modeling to instantiate the billing card and expose:

```js
appointmentTypeButton.dataset.value
serviceSelect.value
serviceSelect.dispatchEvent(new Event('change'))
```

The harness must allow changing which appointment-type button has `aria-pressed="true"` and calling the feature's normal mutation/remount path rather than reaching into private functions.

- [ ] **Step 2: Add a failing auto-follow test**

Test this sequence for a new unsaved billing draft:

1. appointment type is `Retorno`;
2. billing mounts and service is `Retorno`;
3. appointment type becomes `Acompanhamento` before any manual billing-service edit;
4. normal observer/remount/update path runs;
5. billing service becomes `Acompanhamento`.

Assert the draft also stores the followed service so remounting the same draft remains coherent.

- [ ] **Step 3: Add a failing manual-override preservation test**

Test:

1. type = `Acompanhamento`;
2. billing service initially = `Acompanhamento`;
3. professional manually selects `Consulta inicial` in `[data-bv-service]`;
4. type later changes to `Retorno`;
5. billing service remains `Consulta inicial`;
6. force a billing remount for the same mother/appointment;
7. service remains `Consulta inicial`.

- [ ] **Step 4: Add a failing override-scope test**

After the previous override, switch to a different mother/appointment draft and assert its service defaults from its own current appointment type rather than inheriting `Consulta inicial`.

- [ ] **Step 5: Add a persisted-row authority test**

Seed `bvAppointmentRow()` with `service_label: 'Consulta inicial'`, while live appointment type is `Retorno`. Assert hydration keeps the persisted service. This distinguishes an explicit saved commercial choice from an untouched draft.

- [ ] **Step 6: Run focused suite and confirm RED**

Run:

```bash
node --test tests/clinical-source-weight-package-regression.test.mjs
```

Expected: auto-follow/override tests fail against current billing behavior because no explicit manual-override state exists.

- [ ] **Step 7: Commit failing billing tests**

```bash
git add tests/clinical-source-weight-package-regression.test.mjs
git commit -m "test: define billing service override contract"
```

---

### Task 4: Implement per-draft billing-service override semantics

**Files:**
- Modify: `public/billing-v2.js`
- Test: `tests/clinical-source-weight-package-regression.test.mjs`

**Interfaces:**
- Consumes: `bvMotherId()`, `bvAppointmentId()`, `bvAppointmentType()`, `[data-bv-service]`, persisted appointment billing row.
- Produces: billing draft metadata `serviceOverridden: boolean` scoped by mother/appointment; untouched service follows appointment type, explicit service does not.

- [ ] **Step 1: Add draft-scope helpers**

Introduce small helpers in `billing-v2.js`:

```js
function bvDraftMatchesContext(draft,mid=bvMotherId(),appointmentId=bvAppointmentId()||''){
  if(!draft||draft.motherId!==mid)return false;
  return String(draft.appointmentId||'')===String(appointmentId||'');
}
function bvServiceOverridden(){
  const draft=bvReadDraft();
  return bvDraftMatchesContext(draft)&&draft.serviceOverridden===true;
}
```

Do not use a global boolean that can leak between patients.

- [ ] **Step 2: Preserve override metadata in `bvSelection()` / draft writes**

Ensure draft writes include `serviceOverridden`. Programmatic synchronization must keep it `false`; user-originated service `change` must set it `true` before writing the draft.

A service-specific change handler should use the current selection and write:

```js
bvWriteDraft({
  motherId:bvMotherId(),
  appointmentId:bvAppointmentId()||null,
  ...bvSelection(),
  serviceOverridden:true,
  at:Date.now(),
});
```

Then update dependent billing UI without resetting that flag.

- [ ] **Step 3: Make untouched billing service follow `appointmentType`**

When an appointment-type DOM change/remount occurs and the current draft matches context with `serviceOverridden !== true`, update the billing service selection to `bvAppointmentType()` if that option exists, and persist the followed value back into the draft.

Do not synthesize a billing option that does not exist. If the clinical type is not one of the billing service options, leave the current valid service unchanged.

- [ ] **Step 4: Preserve persisted appointment rows as explicit authority**

When `bvInitial()` receives a persisted `row`, return the row's `service_label` and mark the resulting draft/selection as explicitly authoritative so later appointment-type changes do not silently overwrite the saved commercial service.

- [ ] **Step 5: Reset scope naturally on mother/appointment change**

Use `bvDraftMatchesContext` so another mother/appointment does not inherit the previous override. Do not clear unrelated session storage globally.

- [ ] **Step 6: Run focused billing/weight regression tests**

Run:

```bash
node --test tests/clinical-source-weight-package-regression.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Run package lifecycle / billing safety tests**

Run:

```bash
node --test tests/package-lifecycle-cloudflare.test.mjs tests/package-card-singleton.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit billing behavior**

```bash
git add public/billing-v2.js tests/clinical-source-weight-package-regression.test.mjs
git commit -m "fix: preserve explicit billing service overrides"
```

---

### Task 5: Add an end-to-end clinical identity consistency gate

**Files:**
- Modify: `tests/e2e/final-materialized-clinical-flow.spec.mjs`
- Optionally modify if mobile-only interaction needs coverage: `tests/e2e-mobile/mobile-critical.spec.mjs`

**Interfaces:**
- Consumes: live wizard choices for `appointmentType`/`format`, care-context card, billing service, persisted `clinical_encounters.identification`, clinical-note overlay.
- Produces: E2E proof that clinical identity is coherent and manual commercial override remains independent.

- [ ] **Step 1: Extend the final-materialized flow before starting the encounter**

Before clicking the first `Continuar`, select:

```js
await page.locator('[data-encounter-choice][data-field="appointmentType"][data-value="Acompanhamento"]').click();
await page.locator('[data-encounter-choice][data-field="format"][data-value="Online"]').click();
```

Assert:

```js
await expect(page.locator('[data-ccf-context-meta]')).toContainText('Acompanhamento · Online');
await expect(page.locator('[data-bv-service]')).toHaveValue('Acompanhamento');
```

- [ ] **Step 2: Exercise manual billing override before persistence**

Set billing service to `Consulta inicial`, then toggle the clinical type to `Retorno` and back to `Acompanhamento`. Assert billing stays `Consulta inicial` while context returns to `Acompanhamento · Online`.

- [ ] **Step 3: Complete the existing clinical flow without weakening its persistence assertions**

Keep the existing note, media, package/financial, and finalization assertions. Do not remove any current product-state assertion to make the new test pass.

- [ ] **Step 4: Assert persisted clinical identity**

After reading the finalized encounter, add:

```js
expect(encounter?.identification?.appointmentType).toBe('Acompanhamento');
expect(encounter?.identification?.format).toBe('Online');
```

Keep billing as a separate persisted assertion:

```js
expect(appointment?.service_label).toBe('Consulta inicial');
```

If the selected package mode in this specific test intentionally derives service differently, use an individual-billing focused E2E case instead of changing product semantics; the clinical identity assertions must remain in the final-materialized flow.

- [ ] **Step 5: Assert the reopened clinical note header**

After opening `#cn-overlay`, assert it contains both `Acompanhamento` and `Online`, in addition to the existing mother name and clinical-note value assertions.

- [ ] **Step 6: Run the focused final-materialized E2E test**

Run:

```bash
npm run build
npx playwright test tests/e2e/final-materialized-clinical-flow.spec.mjs
```

Expected: PASS.

- [ ] **Step 7: Run mobile critical path**

Run:

```bash
npm run test:e2e:mobile -- tests/e2e-mobile/mobile-critical.spec.mjs
```

If the npm script does not forward the path cleanly in the current shell, run:

```bash
npm run build
npx playwright test --config=playwright.mobile.config.mjs tests/e2e-mobile/mobile-critical.spec.mjs
```

Expected: PASS with the existing layout-integrity checks and no new clipping/overflow failures.

- [ ] **Step 8: Commit the E2E consistency gate**

```bash
git add tests/e2e/final-materialized-clinical-flow.spec.mjs tests/e2e-mobile/mobile-critical.spec.mjs
git commit -m "test: gate clinical identity consistency"
```

Only include the mobile file in the commit if it actually changed.

---

### Task 6: Full PR verification and readiness check

**Files:**
- Verify all PR #69 changed files.
- Do not add unrelated fixes unless a failing gate is proven to be caused by this PR.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: evidence that P0 + mobile P1 + weight-history P1 + encounter-consistency P1 are safe together.

- [ ] **Step 1: Run focused Node regressions**

```bash
node --test tests/clinical-source-weight-package-regression.test.mjs tests/patient-ui-integrity.test.mjs tests/package-card-singleton.test.mjs tests/package-lifecycle-cloudflare.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run the complete build**

```bash
npm run build
```

Expected: exit code 0 and no materialization/hardening drift error.

- [ ] **Step 3: Run final-materialized E2E**

```bash
npx playwright test tests/e2e/final-materialized-clinical-flow.spec.mjs
```

Expected: PASS.

- [ ] **Step 4: Run mobile E2E**

```bash
npx playwright test --config=playwright.mobile.config.mjs
```

Expected: PASS, including the PR #69 generic clipping/footer/value-field assertions.

- [ ] **Step 5: Run the full E2E suite**

```bash
npx playwright test
```

Expected: PASS. A Playwright/browser lifecycle failure must be investigated from logs/artifacts; do not weaken product assertions or swallow arbitrary errors.

- [ ] **Step 6: Inspect the final PR diff**

Confirm the final diff contains only:

- mobile layout integrity work already in PR #69;
- deterministic V5 weight scheduling + its tests;
- billing service override state + its tests;
- clinical identity E2E assertions;
- the approved design/plan docs;
- narrowly justified CI-test stabilization already proven necessary on this branch.

No database migration, paid dependency, broad growth rewrite, or unrelated UI redesign should appear.

- [ ] **Step 7: Confirm GitHub Actions on the final head SHA**

Require these PR workflows to conclude successfully on the final commit:

- Validate E2E;
- Validate final materialized gate;
- Validate clinical source consolidation;
- Validate cache release hardening;
- Validate SaaS foundation.

- [ ] **Step 8: Update PR #69 description and leave it draft until all final-head checks are green**

The PR description should summarize all four delivered areas: field width, mobile footer/layout integrity, V5 weight regression protection, and encounter/billing consistency. Mark ready for review only after the final head SHA has green required workflows.
