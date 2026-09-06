# Clinical Source Consolidation Design

## Goal
Replace the runtime archive/patch reconstruction of the clinical app with normal source files without changing user-visible behavior, data contracts, Supabase rules, billing, or the isolated Deborah landing.

## Constraints
- Do not rewrite the product.
- Preserve the current clinical behavior and UI.
- Preserve Deborah's isolated access and commercial SaaS separation.
- Keep Supabase schema/RLS, Cloudflare Worker and Asaas flow unchanged.
- Migration must be reversible at every step.
- Legacy `.bin` and release patch artifacts may be removed only after the canonical source path has equivalent coverage and regression checks.

## Architecture
Introduce `public/clinical-source/` as the canonical browser source during migration. Promote already-extracted final runtime files from `patch-source/` byte-for-byte. `src/bootstrap.js` will prefer canonical files when present and fall back to the current archive/patch loaders for modules not yet promoted.

The first migration slice promotes the final Agenda-resolved `app-shell.js` and `app-data.js`, plus explicitly extracted patient fixes. The legacy archives remain available as rollback/fallback. Subsequent slices promote remaining core libraries and features until no runtime archive dependency remains.

## Migration phases
1. Add source manifest and contract tests.
2. Promote already-extracted final source files without modifying their bytes.
3. Update bootstrap resolution to prefer canonical files with archive fallback.
4. Extract and promote remaining core libraries one by one.
5. Validate build/runtime contracts after each module.
6. Remove `.bin`/patch loading only when canonical coverage is complete.

## Success criteria
- Existing clinical routes, Agenda, patient flows, portal da mãe, media, documents and billing continue to load.
- SaaS commercial funnel and billing code are untouched.
- Build passes.
- Contract tests prove canonical source precedence and fallback behavior.
- No legacy artifact is deleted in the first slice.
