# SaaS Foundation Fases 0–2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar a fundação SaaS e registrar a Débora como tenant inicial sem alterar o comportamento clínico existente.

**Architecture:** A implementação é aditiva: cinco novas tabelas protegidas por RLS usam o `owner_id` já existente como fronteira inicial. Um backfill defensivo promove somente o owner legado com evidência clínica e financeira real.

**Tech Stack:** PostgreSQL/Supabase, GitHub Actions, Node.js.

**Spec:** `docs/superpowers/specs/2026-09-06-saas-foundation-design.md`

## Global Constraints
- Não alterar tabelas clínicas existentes.
- Não alterar `src/bootstrap.js` nem o frontend clínico.
- Não expor e-mail/UUID pessoal no repositório.
- Não aplicar migration no banco de produção nem fazer deploy nesta entrega.

---

### Task 1: Contract test da fundação

**Files:**
- Create: `scripts/test-saas-foundation.mjs`
- Create: `.github/workflows/validate-saas-foundation.yml`

**Interfaces:**
- Consumes: spec SaaS.
- Produces: validação estática da migration e do backfill.

- [ ] Criar workflow que execute `node scripts/test-saas-foundation.mjs` na branch SaaS.
- [ ] Criar teste que falhe enquanto `supabase/phase-saas-foundation.sql` não existir.
- [ ] Confirmar o RED no CI.

### Task 2: Migration SaaS aditiva

**Files:**
- Create: `supabase/phase-saas-foundation.sql`

**Interfaces:**
- Produces: `saas_accounts`, `professional_profiles`, `public_profiles`, `subscriptions`, `entitlements`.

- [ ] Criar somente tabelas novas e constraints SaaS.
- [ ] Habilitar RLS nas cinco tabelas.
- [ ] Definir grants explícitos para `anon`, `authenticated` e `service_role`.
- [ ] Definir policies por `owner_id`.
- [ ] Reexecutar o teste até GREEN.

### Task 3: Backfill seguro da Débora

**Files:**
- Modify: `supabase/phase-saas-foundation.sql`
- Modify: `scripts/test-saas-foundation.mjs`

**Interfaces:**
- Consumes: owners existentes em `clinical_encounters` e `financial_entries`.
- Produces: conta SaaS e perfil público `debora-lactacao` somente quando houver um candidato legado inequívoco.

- [ ] Testar ausência de e-mail/UUID hardcoded e presença de guarda de candidato único.
- [ ] Implementar backfill idempotente derivado de dados clínicos reais.
- [ ] Garantir que conta demo sem prontuário/financeiro não seja promovida.
- [ ] Executar teste final e build existente.

### Task 4: Verificação de entrega

- [ ] Comparar branch SaaS com `main` e confirmar que apenas arquivos novos/documentação foram alterados.
- [ ] Confirmar `main` e snapshot no commit clínico de referência.
- [ ] Confirmar que o banco de produção não recebeu DDL/DML nesta entrega.