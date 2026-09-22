# Demo Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar uma conta de demonstração Pro, isolada por `owner_id`, com dados clínicos fictícios coerentes e reset seguro, usando o D1 clínico e a autoridade central de licenças já existentes.

**Architecture:** A implementação separa fixture puro, geração SQL segura, sincronização da licença central e orquestração CLI. O seed usa UUIDs estáveis e datas relativas, grava apenas `auth_users`, `auth_credentials` e `supabase_records` no D1 clínico, e sincroniza uma licença Pro pelo endpoint interno já existente da autoridade Artisys. O reset primeiro valida identidade + marcador `demo:true`, depois remove somente registros do `owner_id` demo e recria o cenário.

**Tech Stack:** Node.js ESM, `node:test`, `node:crypto`, Cloudflare Wrangler/D1, fetch nativo, runtime Cloudflare existente.

**Spec:** `docs/superpowers/specs/2026-09-22-demo-account-design.md`

## Global Constraints

- Core R$ 0 / self-hosted / open source; nenhum serviço pago novo.
- Não usar AppDeploy.
- Não versionar senha, token ou segredo.
- Login: `demonstracao@deboralactacao.com`.
- Senha recebida somente por `DEMO_PASSWORD`.
- Todo dado clínico/comercial demo usa o mesmo UUID reservado como `owner_id`.
- Reset nunca executa limpeza global por tabela.
- Plano Pro deve passar pela autoridade central Artisys existente, sem `if demo => unlock` na UI.
- Datas de agenda/evolução são relativas ao dia da geração.

## Review Focus

1. Colisão do UUID/e-mail demo com uma conta não marcada como demo deve abortar antes de qualquer escrita.
2. Senha ausente/fraca deve abortar antes de licenciamento ou D1.
3. Falha na sincronização da licença deve impedir o seed clínico para não deixar uma conta comercial parcialmente configurada.
4. Reset deve recusar identidade com e-mail divergente ou sem `demo:true`.
5. SQL de reset não pode conter `DELETE FROM supabase_records` sem filtro `owner_id = ?`/UUID demo explícito.

---

### Task 1: Fixture e credencial determinísticos

**Files:**
- Create: `scripts/demo-account-fixture.mjs`
- Test: `tests/demo-account-fixture.test.mjs`

**Interfaces:**
- Produces: `DEMO_USER_ID`, `DEMO_EMAIL`, `buildDemoFixture(now)`, `deriveDemoCredential(password, options)`.

- [ ] **Step 1: Write failing tests** para senha mínima, hash PBKDF2 compatível, 6 mães/7 bebês, IDs estáveis, relacionamentos válidos e datas relativas.
- [ ] **Step 2: Run** `node --test tests/demo-account-fixture.test.mjs` e confirmar falha por módulo/funções ausentes.
- [ ] **Step 3: Implement** fixture com dados sintéticos e `deriveDemoCredential()` usando PBKDF2-SHA256, salt de 18 bytes e 210000 iterações.
- [ ] **Step 4: Run** o teste novamente e confirmar PASS.
- [ ] **Step 5: Commit** fixture + testes.

### Task 2: SQL seguro e validação de identidade

**Files:**
- Create: `scripts/demo-account-sql.mjs`
- Test: `tests/demo-account-sql.test.mjs`

**Interfaces:**
- Consumes: fixture e credencial da Task 1.
- Produces: `buildSeedSql(input)`, `buildResetSql()`, `validateDemoIdentityRows(rows)`.

- [ ] **Step 1: Write failing tests** para escaping SQL, upsert idempotente, owner único, reset escopado, colisão de UUID/e-mail e marcador demo.
- [ ] **Step 2: Run** `node --test tests/demo-account-sql.test.mjs` e confirmar RED.
- [ ] **Step 3: Implement** geração de SQL usando literais escapados, `ON CONFLICT`, e deletes exclusivamente escopados ao UUID demo.
- [ ] **Step 4: Run** testes e confirmar GREEN.
- [ ] **Step 5: Commit** SQL + testes.

### Task 3: Sincronização Pro pela autoridade central

**Files:**
- Create: `scripts/demo-account-license.mjs`
- Test: `tests/demo-account-license.test.mjs`

**Interfaces:**
- Produces: `syncDemoProLicense({ secret, now, fetchImpl, endpoint })`.

- [ ] **Step 1: Write failing tests** para secret obrigatório, payload `action: sync`, `productCode: debora-lactacao`, e-mail demo, `planCode: pro_6m`, status ativo, source/externalRef demo e expiração futura.
- [ ] **Step 2: Run** `node --test tests/demo-account-license.test.mjs` e confirmar RED.
- [ ] **Step 3: Implement** chamada HTTP ao endpoint interno existente `https://obra-na-mao-comercial.nutricionistaalmeidavh.workers.dev/api/internal/product-license`, usando `x-artisys-license-secret` e sem logar o secret.
- [ ] **Step 4: Run** testes e confirmar GREEN.
- [ ] **Step 5: Commit** helper de licença + testes.

### Task 4: CLI de seed/reset e comandos npm

**Files:**
- Create: `scripts/demo-account-d1.mjs`
- Create: `scripts/seed-demo-account.mjs`
- Create: `scripts/reset-demo-account.mjs`
- Modify: `package.json`
- Test: `tests/demo-account-cli.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: comandos `npm run demo:seed` e `npm run demo:reset`.

- [ ] **Step 1: Write failing tests** para preflight de identidade, ordem `licença -> D1`, ausência de segredo/senha, comando Wrangler remoto, e reset que valida antes de deletar.
- [ ] **Step 2: Run** `node --test tests/demo-account-cli.test.mjs` e confirmar RED.
- [ ] **Step 3: Implement** wrapper `wrangler d1 execute debora-lactacao-clinical --remote --json`, arquivo SQL temporário e limpeza em `finally`.
- [ ] **Step 4: Implement** seed: validar senha, consultar colisões, sincronizar licença Pro, gravar SQL.
- [ ] **Step 5: Implement** reset: consultar identidade demo, validar marcador, aplicar SQL de reset e reseed.
- [ ] **Step 6: Add package scripts** `demo:seed` e `demo:reset`.
- [ ] **Step 7: Run** teste CLI e confirmar GREEN.
- [ ] **Step 8: Commit** CLI + package.json + testes.

### Task 5: Documentação operacional e regressão

**Files:**
- Create: `docs/DEMO_ACCESS.md`
- Modify: `package.json` apenas se necessário para agregador de testes.

**Interfaces:**
- Documents: e-mail, senha via variável de ambiente, seed/reset, pré-requisitos Cloudflare e licença.

- [ ] **Step 1: Document** comandos PowerShell sem escrever a senha real no repositório.
- [ ] **Step 2: Run** `node --test tests/demo-account-*.test.mjs`.
- [ ] **Step 3: Run** `npm run test:auth-runtime`.
- [ ] **Step 4: Run** `npm run test:deploy-safety`.
- [ ] **Step 5: Run** `npm run build`.
- [ ] **Step 6: Review** diff para senha/secret acidental e deletes sem escopo.
- [ ] **Step 7: Commit** documentação/ajustes finais.
