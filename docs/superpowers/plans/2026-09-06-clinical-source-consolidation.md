# Clinical Source Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace runtime archive/patch reconstruction incrementally with canonical source files while preserving behavior and rollback.

**Architecture:** Add `public/clinical-source/` as the canonical migration target. Promote already-extracted final files byte-for-byte and modify only the bootstrap resolver so canonical files are preferred and the current archive path remains fallback until all modules are migrated.

**Tech Stack:** Vite 6, browser ES modules, fflate, Supabase, Cloudflare Workers.

**Spec:** `docs/superpowers/specs/2026-09-06-clinical-source-consolidation-design.md`

## Global Constraints
- No user-visible behavior changes.
- No Supabase, Asaas, Cloudflare Worker or commercial SaaS changes.
- No deletion of legacy archive/patch files during the first migration slice.
- Every promoted module must retain legacy fallback until its contract test passes.

---

### Task 1: Add migration contract test

**Files:**
- Create: `tests/clinical-source-consolidation.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: current `src/bootstrap.js` and canonical source manifest.
- Produces: repeatable assertions for canonical precedence, fallback preservation and isolation from commercial/billing code.

- [ ] Write a Node test that fails because canonical source paths and resolver markers do not yet exist.
- [ ] Run the test and confirm the expected failure.
- [ ] Keep the test dependency-free using `node:assert`, `node:fs` and `node:test`.

### Task 2: Promote already extracted final source

**Files:**
- Create: `public/clinical-source/manifest.json`
- Create: `public/clinical-source/core/app-shell.js`
- Create: `public/clinical-source/core/lib/app-data.js`
- Create: `public/clinical-source/features/patient-fixes.js`
- Create: `public/clinical-source/features/patient-fixes.css`

**Interfaces:**
- Consumes: byte-identical blobs from `patch-source/agenda/` and `patch-source/release/features/`.
- Produces: canonical HTTP paths for the first migrated modules.

- [ ] Reuse the existing Git blobs without editing their contents.
- [ ] Add a manifest declaring promoted files and their legacy source locations.

### Task 3: Prefer canonical source with fallback

**Files:**
- Modify: `src/bootstrap.js`

**Interfaces:**
- Consumes: `/clinical-source/manifest.json` and canonical file URLs.
- Produces: resolver that chooses canonical text first and legacy archive text second.

- [ ] Add a small loader for canonical text files that returns null on 404/network failure.
- [ ] Resolve `app-shell.js` and `app-data.js` through canonical source first.
- [ ] Leave every other module on the existing archive/patch path.
- [ ] Preserve the existing member portal route and service worker behavior.

### Task 4: Verify migration slice

**Files:**
- Test: `tests/clinical-source-consolidation.test.mjs`
- Test: existing contract scripts/tests.

- [ ] Run the new contract test and confirm PASS.
- [ ] Run existing Node contract tests and build.
- [ ] Verify no diff in Worker, Supabase or `public/comercial/`.
- [ ] Stop before deleting any legacy artifact.

### Task 5: Continue module-by-module extraction

**Files:**
- Future: remaining `public/clinical-source/core/lib/*` and feature modules.

- [ ] Promote one legacy module per cycle.
- [ ] Add/extend the contract test first.
- [ ] Preserve fallback until that module passes build and regression checks.
- [ ] Remove archive/patch loading only after the manifest covers every runtime module.
