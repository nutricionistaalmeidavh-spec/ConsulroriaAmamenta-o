# Canonical Multi-client App Routing Design

## Status
Approved in chat on 2026-09-07. This document records the architecture before implementation.

## Objective
Turn the current product into one canonical clinical application for all professionals while preserving the existing Débora URL and all existing clinical data.

Débora is conceptually client 1. She uses the same clinical product as every other professional. Her only product-level exception is a dedicated personal landing page.

## Product identity
- The product itself must be generic. `Débora` must not be the product name in the canonical app, commercial funnel, SaaS routes, manifests, generic titles, navigation, or generic PWA identity.
- `Débora` may appear only as the authenticated professional/customer name and in her dedicated `/debora/` landing page.
- The canonical application must derive professional-facing identity from authenticated account/profile data, not from hard-coded product copy.

## Target routes

```text
/                         compatibility entry for the canonical app
/#/patient/:id            existing Débora deep links remain valid

/debora/                  dedicated personal landing for Débora

/comercial/               generic commercial landing, signup, login, plans and checkout

/app/                     canonical generic clinical app for all customers
/app/#/...                 canonical app deep links for new customers
```

### Compatibility rule for `/`
`/` remains a supported application entry because Débora already uses this URL in production. It must resolve to the same canonical clinical runtime as `/app/`; it must not fork into a separate Débora-only application.

Existing `/#/...` deep links must continue to resolve without redirect loops or route loss.

## Canonical application model
There is one clinical source/runtime and multiple entry contexts.

```text
public/clinical-source/        canonical clinical UI + behavior
            |
            +-- /              compatibility bootstrap
            +-- /app/          canonical SaaS bootstrap
            +-- demo surface   commercial product previews
```

The entry context is configuration only. It may determine base URL, generic branding, return URL and preview/demo mode, but it must not duplicate clinical business logic.

## Customer/data isolation model
The authenticated Supabase user ID is the ownership boundary already represented by `owner_id` in clinical and SaaS data.

For this migration, `client 1` is a conceptual business label only. Do not introduce a new `client_id` column or rewrite existing clinical ownership merely to rename the concept.

### Débora data invariant
Existing Débora patient, baby, appointment, encounter, weight, follow-up, financial, document, consent, library and media records must remain attached to their existing IDs and existing owner.

Implementation must not bulk-update, delete, reinsert, clone, re-key or migrate existing clinical rows as part of the routing/branding consolidation.

### New customers
New SaaS customers authenticate normally. Their clinical rows continue to be owned by their authenticated `owner_id`, with existing RLS and server-side entitlements enforcing account isolation and Freemium/Pro limits.

## Mandatory data-safety gate
Before any production routing or account-mode change:

1. Perform a read-only ownership audit of the clinical tables involved in the current app.
2. Record aggregate counts only; do not export patient clinical content into logs or repository files.
3. Verify that the existing Débora account can still read the same owned record IDs through the current canonical repositories.
4. Verify that no implementation step requires rewriting existing clinical primary keys or `owner_id` values.
5. If orphaned rows, mixed ownership, missing ownership, or an unexpected owner mapping is found, stop the migration before writes/deploy and diagnose it separately.

No destructive data migration is authorized by this design.

## Authentication and session flow

### `/` and `/app/`
Both entries use the canonical clinical authentication service and the same Supabase project.

After authentication:
1. Resolve the authenticated user.
2. Resolve the professional/account profile when one exists.
3. Load only data allowed by existing RLS for that owner.
4. Render the generic product shell.
5. Render the professional name from profile/user context.

For the existing Débora account, the result is the same clinical data and same professional identity she already uses, but without treating `Débora Lactação` as the generic product name.

### `/comercial/`
The commercial funnel remains separate from the clinical UI. It continues to own signup, onboarding, plan intent and checkout.

Successful commercial onboarding must hand the customer into `/app/`, preserving authentication and plan state according to the existing SaaS flow.

### `/debora/`
This is a public/personal marketing surface only. Its call-to-action/login must lead to the canonical app, not a private fork.

## Generic branding seam
Introduce a small application identity/configuration seam consumed by the canonical runtime. It should expose values such as:

- generic product name;
- generic product short name;
- professional display name;
- entry/base path;
- landing/login return path;
- runtime mode: `app`, `compat`, or `demo`.

Hard-coded `Débora Lactação`, `Olá, Débora`, `D` brand marks, and Débora-specific PWA/app-title strings inside the generic runtime must be removed or moved behind professional/profile configuration.

This work must not alter clinical rules, field definitions, appointment behavior, billing behavior, document generation logic, or patient workflows except where copy must become generic.

## Dedicated Débora landing
Create `/debora/` as an isolated public page.

Requirements:
- preserve the previously approved Débora-specific visual identity;
- it may use the name and branding `Débora`;
- it must not become a template/public-profile feature for other customers;
- it must not read clinical data;
- it must not share commercial SaaS plan/account state;
- its login/access CTA leads to the canonical application entry.

If the exact historical landing source is not present in this repository, recover/recreate that landing as a separate bounded surface without changing the canonical clinical app. Do not substitute the current commercial landing for it.

## Commercial previews
The commercial landing must stop maintaining an independently hand-authored imitation of the app as a long-term product surface.

Target direction:
- render previews from the canonical UI in a deterministic demo mode with synthetic data; or
- generate static screenshots from that canonical demo mode.

The demo mode must never authenticate to production clinical data and must never expose real patient information.

The preview cleanup can be delivered after the canonical route/runtime seam exists; it must not block preservation of Débora production access.

## SaaS entitlement compatibility
Existing SaaS rules remain in force:
- Freemium: up to 3 mothers/patients;
- Freemium: photo/video upload disabled;
- Pro: unlimited patient use according to the current entitlement contract;
- Pro: photo/video upload enabled;
- legacy owners not represented as commercial SaaS accounts remain unaffected by SaaS enforcement until explicitly migrated.

Making Débora conceptually `client 1` does not authorize retroactively applying a Freemium/Pro limit to her existing legacy account.

## Migration sequence

### Phase 0 — Snapshot and read-only safety audit
- Record current source commit.
- Verify current root deep-link behavior.
- Read-only audit ownership/count invariants.
- No database writes.

### Phase 1 — Canonical identity seam
- Remove hard-coded customer identity from canonical clinical runtime.
- Resolve professional display name from authenticated context.
- Preserve all clinical behavior and current root route.

### Phase 2 — Canonical `/app/` entry
- Add `/app/` bootstrap that loads the same clinical source/runtime.
- Make path-sensitive assets, service-worker registration and auth redirects work from both `/` and `/app/`.
- Keep existing `/#/...` deep links working.

### Phase 3 — Commercial handoff
- After onboarding/payment requirements are satisfied, route commercial customers to `/app/`.
- Preserve current checkout and email-confirmation ordering.

### Phase 4 — Débora landing
- Restore/create `/debora/` as a dedicated personal landing.
- Point its login/access CTA to the canonical app.

### Phase 5 — Preview consolidation
- Replace independent commercial mock UI with canonical demo-mode UI or generated canonical screenshots.

## Rollback strategy
Every phase must be reversible without database restoration.

- Phase 1 rollback: restore prior branding/configuration layer; no clinical data changes.
- Phase 2 rollback: remove `/app/` entry while `/` continues to serve the current app.
- Phase 3 rollback: return commercial post-onboarding destination to the current completion surface.
- Phase 4 rollback: remove only `/debora/`; app remains unaffected.
- Phase 5 rollback: retain prior preview assets until canonical previews are verified.

A database rollback must not be required because this architecture intentionally avoids rewriting existing clinical data.

## High-risk failure modes and required protections

### 1. Existing Débora data appears missing
Protection: no ownership migration; read-only preflight counts; existing root compatibility route; RLS verification.

### 2. Cross-customer data leakage
Protection: keep `owner_id` + RLS as the authoritative boundary; add negative isolation tests using two distinct test owners; never filter ownership only in frontend code.

### 3. Existing deep links break
Protection: contract tests for `/#/patient/:id` and equivalent `/app/#/patient/:id` routing.

### 4. Commercial users enter the Débora-branded shell
Protection: generic application identity contract test forbidding hard-coded Débora product strings in canonical app surfaces.

### 5. Service worker/assets break under `/app/`
Protection: base-path-aware asset/service-worker tests and production-like Vite build verification.

### 6. Checkout flow regresses
Protection: existing SaaS/Asaas contract tests must remain green; route work must not modify plan codes, prices, checkout semantics or Pro email-confirmation ordering.

## Test strategy

### Characterization before change
- existing root bootstrap loads clinical app;
- current deep-link parser resolves patient route;
- clinical source consolidation tests remain green;
- SaaS foundation/checkout tests remain green.

### New focused contracts
- `/` and `/app/` use one canonical clinical source contract;
- generic runtime contains no customer-specific product branding;
- authenticated professional name is a profile/user value, not product identity;
- root `/#/...` and `/app/#/...` map to the same clinical route semantics;
- no data migration SQL updates/deletes existing clinical owner/primary-key columns;
- commercial completion targets `/app/` only at the appropriate successful state;
- `/debora/` exists and remains isolated from SaaS/public-profile generation;
- demo previews contain synthetic-only content and no production data dependency.

### Broad verification
Run the repository's existing clinical-source, SaaS foundation, commercial/checkout and build checks plus the new routing/identity tests.

## Acceptance criteria
1. The existing Débora URL `/` and existing `/#/...` deep links continue working.
2. `/app/` opens the same canonical clinical application for any authenticated customer.
3. There is only one maintained clinical UI/runtime implementation.
4. `Débora` is not the generic product name anywhere outside the dedicated personal landing or authenticated professional identity.
5. Débora's existing clinical row IDs and ownership are untouched.
6. Two different customer accounts cannot read each other's clinical data.
7. Freemium/Pro restrictions remain enforced for commercial SaaS accounts.
8. `/debora/` is a dedicated personal landing and is not a template for other users.
9. `/comercial/` remains the generic sales/signup/checkout funnel.
10. Existing checkout prices, plan codes and deferred Pro email-confirmation behavior remain unchanged.
11. Production build and relevant CI checks pass after integration.

## Explicit non-goals
- No new public landing generator for customers.
- No new `client_id` migration merely to rename `owner_id`.
- No destructive patient-data cleanup or re-keying.
- No redesign of clinical workflows in this architecture change.
- No change to Asaas pricing or plan definitions.
- No migration of Débora into a paid SaaS plan as part of this work.
