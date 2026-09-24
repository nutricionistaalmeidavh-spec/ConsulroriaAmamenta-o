# Weight UI and Encounter Consistency Design

## Goal

Finish the remaining P1 work in PR #69 by restoring the approved V5 weight-history presentation, preventing it from regressing to the older renderer, and making encounter identity display consistently across the care context, clinical note, persisted encounter, and billing defaults without collapsing intentionally separate commercial data.

## Constraints

- Keep the approved weight-history UI: current weight, birth weight, balance, measurement count, and timeline with gram/percentage deltas.
- Do not reintroduce the previous burst of `Failed to fetch` errors or duplicate network work.
- Do not change clinical persistence semantics unrelated to these two P1 items.
- Keep billing `service_label` as a distinct commercial field.
- `appointmentType` and `format` are the canonical clinical encounter identity fields.
- Billing follows `appointmentType` only until the professional explicitly edits the billing service.
- Preserve the current self-hosted / zero-recurring-cost architecture; add no paid dependency.
- Add regression coverage that asserts final rendered behavior, not merely asset presence.

## Current Problems

### Weight history

`public/weight-evolution-v5.js` currently upgrades the V4 markup by scraping `.gf-weight-change-row` nodes from `[data-weight-changes-v4]`. It then replaces the host markup with V5. The observer uses a resettable timeout, so continuous DOM changes can postpone enhancement. This means the old UI remains part of the runtime contract and can become visible again.

### Encounter identity

The wizard owns `identification.appointmentType` and `identification.format`. The care-context feature already derives its display from those live wizard selections. The clinical note reads persisted encounter identity. Billing owns an independent `service_label`, but its default is also based on the appointment type. Without an explicit dirty/override state, later remounts can make the commercial label appear unrelated to the current encounter selection.

## Design

### 1. Weight-history renderer

The V5 renderer remains the canonical presentation. Its public visual contract is:

- heading `Evolução do peso`;
- subtitle `Trajetória desde o nascimento`;
- measurement-count badge;
- summary cards `Atual`, `Nascimento`, `Saldo`;
- timeline ordered chronologically;
- birth measurement marked as `Peso ao nascer`;
- subsequent rows show delta from the previous measurement in grams and percentage;
- secondary text may show delta from birth;
- latest measurement receives latest-state styling.

The mount logic will become deterministic:

1. The V4 data-producing layer may still populate the host during this change, but V5 enhancement must not depend on an endlessly-reset debounce.
2. Schedule at most one pending enhancement pass. Repeated mutations while a pass is pending do not postpone it.
3. After a host is enhanced, its V5 structure is treated as the required final state for the same source signature.
4. When source measurement markup changes, enhancement runs again and rebuilds V5 from the new rows.
5. No new API request is introduced by V5. It transforms already-available measurement data only.

This removes the timing regression while avoiding a larger rewrite of the growth data layer in the same PR.

### 2. Weight regression contract

Tests must assert the final UI, not just file imports. A regression test will provide representative measurement rows and assert:

- V5 class is applied;
- old row markup is replaced;
- heading/subtitle render;
- count is correct;
- birth/current/saldo values are correct;
- birth chip is present;
- positive and negative delta chips are calculated correctly;
- a subsequent source update remounts the V5 view;
- repeated mutation scheduling cannot postpone rendering indefinitely.

An E2E/patient UI test will also assert that the patient detail ends in the V5 state after normal route mounting.

### 3. Canonical encounter identity

Clinical identity is defined by:

- `identification.appointmentType`;
- `identification.format`.

All clinical surfaces should derive their displayed identity from those values after persistence. This includes the care-context summary and the clinical-note header.

No new duplicate identity field will be created.

### 4. Billing service default and explicit override

Billing `service_label` remains commercially independent. The behavior is:

- on initial mount, if no persisted billing service exists and the professional has not manually selected a service, default to the current `appointmentType`;
- when `appointmentType` changes before a manual service edit, billing service follows it;
- once the professional manually changes `[data-bv-service]`, mark billing service as overridden/dirty for the current appointment draft;
- after the explicit override, further appointment-type changes do not overwrite the selected billing service;
- persisted billing rows continue to win during hydration because they represent an explicit saved commercial choice;
- the override state is scoped to the current mother/appointment draft and must not leak into a different patient or appointment.

### 5. Consistency regression contract

E2E coverage will exercise one representative flow, for example `Acompanhamento + Online`:

1. select the encounter type and format;
2. verify the care context shows those values;
3. verify billing service follows the type before manual override;
4. manually change billing service and verify later encounter-type changes do not overwrite it;
5. complete/persist enough of the encounter to reopen the clinical note;
6. verify the note header uses the persisted encounter type/format;
7. verify persisted encounter identification contains the same clinical identity;
8. navigate backward/forward and remount billing without losing the explicit commercial override.

## Files Expected to Change

- `public/weight-evolution-v5.js` — deterministic V5 scheduling/mount behavior.
- `tests/clinical-source-weight-package-regression.test.mjs` and/or `tests/patient-ui-integrity.test.mjs` — final V5 rendering regression coverage.
- `tests/e2e-mobile/mobile-critical.spec.mjs` or a focused weight E2E — route-level V5 assertion where practical.
- `public/billing-v2.js` — explicit billing-service dirty/override behavior tied to current appointment draft.
- focused billing/encounter tests — clinical identity + commercial override contract.

No schema migration is planned.

## Non-Goals

- Rewriting the entire growth/WHO curve subsystem.
- Changing how weights are stored.
- Merging billing `service_label` into clinical `appointmentType`.
- Changing appointment pricing/persistence behavior.
- Refactoring unrelated patient-record modules discovered by CI.

## Acceptance Criteria

1. The patient weight history consistently ends in the approved V5 UI and cannot remain on the old presentation because of continuous DOM mutations.
2. V5 produces no additional network request and does not reintroduce repeated fetch-error toasts.
3. The V5 regression test validates rendered values and delta math.
4. Care context and clinical note represent the same persisted `appointmentType` and `format` for an encounter.
5. Billing service follows appointment type until manual user override, then preserves the explicit commercial choice across remount/navigation.
6. Existing clinical, billing, E2E, mobile, and final-materialized gates remain green before PR #69 is considered ready.