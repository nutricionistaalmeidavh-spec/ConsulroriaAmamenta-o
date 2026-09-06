# Commercial Funnel + Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Entregar as fases 3 e 4 como uma aplicação comercial separada da landing/sistema da Débora.

**Architecture:** A rota estática `/comercial/` vive em `public/comercial/` e não importa o bootstrap clínico. Cadastro/login usam Supabase Auth com chave publishable. O onboarding cria somente `saas_accounts` e `professional_profiles` do usuário autenticado, protegido por RLS `owner_id = auth.uid()`.

**Tech Stack:** HTML/CSS/JS estático, Supabase Auth/Data API, PostgreSQL RLS, GitHub Actions.

## Global Constraints
- Não modificar `index.html` nem `src/bootstrap.js`.
- Não referenciar marca, slug ou landing da Débora no app comercial.
- Não aplicar migration no Supabase de produção nesta entrega.
- Não implementar cobrança/checkout real nesta fase.
- Nunca usar `service_role` no browser.

### Task 1 — Contract test
- Criar `scripts/test-commercial-funnel.mjs`.
- Estender CI para executar os testes SaaS e comercial.
- Confirmar RED antes dos arquivos comerciais existirem.

### Task 2 — Landing comercial
- Criar `public/comercial/index.html`, `styles.css`, `app.js`, `config.js`.
- Incluir hero, benefícios, módulos, planos sem preço definitivo e CTAs para cadastro/login.
- Garantir responsividade e acessibilidade básica.

### Task 3 — Auth + onboarding
- Implementar signup/login via Supabase Auth REST.
- Implementar criação idempotente de `saas_accounts` + `professional_profiles`.
- Ajustar migration com INSERT próprio em `saas_accounts` via RLS.
- Após onboarding, mostrar estado de conta preparada sem redirecionar para o app clínico da Débora.

### Task 4 — Verification
- CI GREEN.
- Comparar branch com `main` e confirmar que entradas clínicas existentes não mudaram.
- Não fazer deploy nem aplicar DDL/DML em produção.
