# SaaS Foundation Fases 0–2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar a fundação SaaS comercial sem integrar, promover ou transformar a landing/sistema atual da Débora em parte do produto comercial.

**Architecture:** A implementação é aditiva: quatro novas tabelas protegidas por RLS usam `owner_id` como fronteira dos futuros usuários comerciais. O legado da Débora permanece isolado e a migration comercial não lê nem altera tabelas clínicas.

**Tech Stack:** PostgreSQL/Supabase, GitHub Actions, Node.js.

**Spec:** `docs/superpowers/specs/2026-09-06-saas-foundation-design.md`

## Global Constraints
- Não alterar nem consultar tabelas clínicas existentes na migration SaaS.
- Não alterar `src/bootstrap.js`, a landing atual ou o frontend clínico.
- Não criar `public_profiles` nem landing por usuário.
- Não vincular a conta atual da Débora a `saas_accounts` nesta fase.
- Não aplicar migration no banco de produção nem fazer deploy nesta entrega.

---

### Task 1: Contract test de isolamento

**Files:**
- Modify: `scripts/test-saas-foundation.mjs`
- Keep: `.github/workflows/validate-saas-foundation.yml`

**Interfaces:**
- Consumes: spec SaaS revisada.
- Produces: validação estática da migration comercial.

- [x] Exigir as quatro tabelas comerciais e RLS.
- [x] Falhar se `public_profiles` existir.
- [x] Falhar se houver slug, branding ou bootstrap da Débora.
- [x] Falhar se a migration referenciar tabelas clínicas.
- [x] Confirmar RED contra a migration anterior.

### Task 2: Migration SaaS comercial isolada

**Files:**
- Modify: `supabase/phase-saas-foundation.sql`

**Interfaces:**
- Produces: `saas_accounts`, `professional_profiles`, `subscriptions`, `entitlements`.

- [x] Remover `public_profiles` e toda policy/grant anônima relacionada.
- [x] Remover backfill do owner legado.
- [x] Remover leituras de `clinical_encounters` e `financial_entries`.
- [x] Manter somente tabelas novas, constraints, grants e RLS comerciais.
- [ ] Confirmar GREEN no CI final.

### Task 3: Contrato do legado isolado

**Files:**
- Modify: `docs/superpowers/specs/2026-09-06-saas-foundation-design.md`

**Interfaces:**
- Produces: regra explícita de que a landing/sistema atual da Débora não participa do SaaS comercial.

- [x] Registrar que a landing atual não é template nem `public_profile`.
- [x] Registrar que novos clientes entrarão futuramente por outra landing comercial.
- [x] Registrar que a conta da Débora não será promovida a tenant comercial nesta fase.

### Task 4: Verificação de entrega

- [ ] Confirmar CI final GREEN.
- [ ] Comparar branch SaaS com `main` e confirmar ausência de mudanças no frontend clínico/landing atual.
- [ ] Confirmar `main` e snapshot no commit clínico de referência.
- [ ] Confirmar que o banco de produção não recebeu DDL/DML nesta entrega.
