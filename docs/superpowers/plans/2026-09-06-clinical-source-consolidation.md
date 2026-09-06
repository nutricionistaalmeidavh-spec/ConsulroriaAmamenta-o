# Clinical Source Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace runtime archive/patch reconstruction incrementally with canonical source files while preserving behavior and rollback.

**Architecture:** Add `public/clinical-source/` as the canonical migration target. Promote the resolved runtime byte-for-byte and modify the bootstrap resolver so canonical files are the normal startup path while the current archive path remains a rollback fallback until browser smoke validation.

**Tech Stack:** Vite 6, browser ES modules, fflate, Supabase, Cloudflare Workers.

**Spec:** `docs/superpowers/specs/2026-09-06-clinical-source-consolidation-design.md`

## Global Constraints
- No user-visible behavior changes.
- No Supabase, Asaas, Cloudflare Worker or commercial SaaS changes.
- No deletion of legacy archive/patch files during the first migration slice.
- Every promoted module must retain legacy fallback until its contract test passes.

## Current status — 2026-09-06

The canonical clinical runtime is materialized and verified against the legacy archive resolution. Normal startup now loads `public/clinical-source/` first and only invokes the legacy `.bin`/release loaders if canonical source is incomplete or unavailable. The legacy artifacts are intentionally retained as rollback insurance until a browser smoke check is performed on a staging/merged deployment.

---

### Task 1: Add migration contract test

**Files:**
- Create: `tests/clinical-source-consolidation.test.mjs`
- Create: `tests/clinical-source-bootstrap-canonical.test.mjs`
- Create: `tests/clinical-source-materializer.test.mjs`

**Interfaces:**
- Consumes: current `src/bootstrap.js` and canonical source manifest.
- Produces: repeatable assertions for canonical precedence, fallback preservation, materialized-byte equivalence and isolation from commercial/billing code.

- [x] Write a Node test that fails because canonical source paths and resolver markers do not yet exist.
- [x] Run the test and confirm the expected failure.
- [x] Keep the tests dependency-light using Node test/assert/fs APIs.

### Task 2: Promote the final resolved source

**Files:**
- Create: `public/clinical-source/manifest.json`
- Create: `public/clinical-source/core/app-shell.js`
- Create: `public/clinical-source/core/lib/*`
- Create: `public/clinical-source/features/*`
- Create: `public/clinical-source/index.html`
- Create: `public/clinical-source/styles.css`
- Create: `public/clinical-source/config.js`
- Create: `scripts/materialize-clinical-source.mjs`

**Interfaces:**
- Consumes: current base `.bin`, release 1.11 and Agenda 1.12 artifacts.
- Produces: deterministic canonical HTTP paths and a manifest with SHA-256 for every resolved runtime file.

- [x] Reuse already-extracted Git blobs without editing their contents where available.
- [x] Materialize remaining runtime files deterministically from the current legacy precedence.
- [x] Verify every canonical runtime file byte-for-byte against legacy resolution.
- [x] Add a manifest declaring source provenance and SHA-256 values.

### Task 3: Prefer complete canonical runtime with lazy fallback

**Files:**
- Modify: `src/bootstrap.js`

**Interfaces:**
- Consumes: `/clinical-source/*`.
- Produces: canonical normal startup with lazy rollback fallback.

- [x] Add a loader for canonical text files that returns null on 404/network failure.
- [x] Resolve the complete clinical runtime through canonical source first.
- [x] Stop downloading `.bin`/release archives during normal canonical startup.
- [x] Keep the legacy loaders available only behind `loadLegacyRuntime()` fallback.
- [x] Preserve the existing member portal route, auth request guard, module import rewriting and service worker behavior.

### Task 4: Verify migration slice

**Files:**
- Test: `tests/clinical-source-*.test.mjs`
- CI: `.github/workflows/validate-clinical-source-consolidation.yml`

- [x] Confirm the regression contract fails before the canonical-first bootstrap change.
- [x] Confirm all clinical source contracts pass after the change.
- [x] Run `npm run build` successfully.
- [x] Verify canonical files are copied into the final `dist` output.
- [x] Verify the branch has no diff in `worker`, `supabase` or `public/comercial`.

### Task 5: Retire rollback artifacts

- [x] Materialize all runtime modules into canonical source.
- [x] Keep deterministic verification available through `scripts/materialize-clinical-source.mjs --verify`.
- [x] Move archive/patch reconstruction out of the normal startup path.
- [ ] After browser smoke validation on a staging/merged deployment, remove `.bin`/release artifact fallback code and files in a separate reversible commit.
