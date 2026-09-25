# Observabilidade de uso da Débora Lactação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar presença, sessões e tempo aproximado de uso no D1 da Débora e expor contas, billing e atividade por uma API administrativa interna, paginada e somente leitura, sem tocar em dados clínicos nem alterar a autoridade atual de licenciamento.

**Architecture:** O Worker da Débora recebe heartbeats autenticados, consolida presença/sessões/agregados no D1 e disponibiliza endpoints internos protegidos por segredo para a Central Artisys. As listas usam cursor/keyset, os cards usam SQL agregado e o frontend envia heartbeat de forma best-effort. A observabilidade é isolada: falhas nela não bloqueiam auth, clínica ou billing.

**Tech Stack:** Cloudflare Workers, D1/SQLite, JavaScript ESM, Miniflare, Node test runner, Vite, Wrangler 4.

**Spec:** `docs/superpowers/specs/2026-09-25-debora-usage-observability-design.md`

## Global Constraints

- `online` significa `now - last_seen_at <= 2 minutos`.
- Heartbeat do frontend: aproximadamente a cada 60 segundos.
- Intervalo de até 5 minutos continua a mesma sessão; acima disso inicia nova sessão.
- Um heartbeat pode somar no máximo 90 segundos de atividade.
- Intervalos acima de 5 minutos nunca são somados retroativamente.
- Múltiplas abas/requisições concorrentes não podem duplicar tempo.
- `user_sessions` detalhado retido por 12 meses; exclusão sempre em lotes pequenos.
- Listas: cursor/keyset; usuários/vendas default 50, sessões default 25, máximo absoluto 100.
- Filtros são aplicados no backend antes da paginação.
- Summary usa agregações SQL; nunca carregar toda a tabela para contar em JavaScript.
- Nenhum payload administrativo pode conter paciente, prontuário, anamnese, diagnóstico, encaminhamento, foto, vídeo ou documento clínico.
- Produção Asaas (`provider='asaas'`) deve ser separada de sandbox (`provider='asaas_sandbox'`).
- O segredo `DEBORA_OBSERVABILITY_SECRET` nunca entra no Git.
- Falha da telemetria não pode bloquear login, clínica, billing ou checkout.
- Não fazer deploy de produção nem merge em `main` durante a execução deste plano sem nova aprovação explícita.

## Review Focus

1. **Dois heartbeats concorrentes para o mesmo usuário:** apenas um deles pode reivindicar o intervalo e incrementar `duration_seconds`/`active_seconds`.
2. **Heartbeat atrasado, duplicado ou fora de ordem:** não pode reduzir `last_seen_at`, abrir sessão falsa nem adicionar tempo negativo/duplicado.
3. **Cursor inválido ou adulterado:** deve retornar 400 controlado; nunca cair para SQL inválido nem ignorar silenciosamente filtros.
4. **Usuário legado com datas nulas:** deve aparecer de forma estável na paginação e sem quebrar os agregados.
5. **Dados sandbox:** nunca entram em vendas/receita/assinaturas de produção por padrão.

---

### Task 1: Criar o schema de presença, sessões e agregados com índices de escala

**Files:**
- Create: `cloudflare/migrations/0008-usage-observability.sql`
- Modify: `cloudflare/runtime-schema.sql`
- Modify: `tests/helpers/cloudflare-local.mjs`
- Create: `tests/usage-observability-schema.test.mjs`

**Interfaces:**
- Produces tables `user_presence`, `user_sessions`, `user_usage_daily`.
- Produces indexes usados pelas Tasks 2–5.
- `tests/helpers/cloudflare-local.mjs` passa a aplicar a migration 0008 em runtimes locais.

- [ ] **Step 1: Escrever o teste de schema antes da migration**

Criar `tests/usage-observability-schema.test.mjs` verificando os contratos estruturais e os índices:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('cloudflare/migrations/0008-usage-observability.sql', 'utf8');
const runtime = readFileSync('cloudflare/runtime-schema.sql', 'utf8');

for (const source of [migration, runtime]) {
  test(`usage schema is present in ${source === migration ? 'migration' : 'runtime schema'}`, () => {
    assert.match(source, /CREATE TABLE IF NOT EXISTS user_presence/i);
    assert.match(source, /last_heartbeat_id TEXT/i);
    assert.match(source, /CREATE TABLE IF NOT EXISTS user_sessions/i);
    assert.match(source, /duration_seconds INTEGER NOT NULL DEFAULT 0/i);
    assert.match(source, /CREATE TABLE IF NOT EXISTS user_usage_daily/i);
    assert.match(source, /PRIMARY KEY\s*\(user_id,\s*usage_date\)/i);
  });
}

for (const index of [
  'user_presence_last_seen_idx',
  'user_sessions_user_started_idx',
  'user_sessions_started_idx',
  'user_usage_daily_date_idx',
  'auth_users_created_at_observability_idx',
  'auth_users_last_sign_in_observability_idx',
  'billing_checkout_observability_idx',
  'subscriptions_observability_idx',
]) {
  test(`schema declares ${index}`, () => assert.match(runtime, new RegExp(index)));
}
```

- [ ] **Step 2: Rodar o teste e confirmar falha**

Run:

```powershell
node --test tests/usage-observability-schema.test.mjs
```

Expected: FAIL porque `0008-usage-observability.sql` ainda não existe e os novos objetos ainda não estão no runtime schema.

- [ ] **Step 3: Criar migration idempotente e espelhar no runtime schema**

A migration deve conter exatamente a semântica abaixo:

```sql
CREATE TABLE IF NOT EXISTS user_presence (
  user_id TEXT PRIMARY KEY,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  current_session_id TEXT,
  last_heartbeat_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ended_at TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_usage_daily (
  user_id TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  session_count INTEGER NOT NULL DEFAULT 0 CHECK (session_count >= 0),
  active_seconds INTEGER NOT NULL DEFAULT 0 CHECK (active_seconds >= 0),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (user_id, usage_date)
);

CREATE INDEX IF NOT EXISTS user_presence_last_seen_idx
  ON user_presence(last_seen_at DESC, user_id);
CREATE INDEX IF NOT EXISTS user_sessions_user_started_idx
  ON user_sessions(user_id, started_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS user_sessions_started_idx
  ON user_sessions(started_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS user_usage_daily_date_idx
  ON user_usage_daily(usage_date DESC, user_id);
CREATE INDEX IF NOT EXISTS auth_users_created_at_observability_idx
  ON auth_users(created_at DESC, user_id);
CREATE INDEX IF NOT EXISTS auth_users_last_sign_in_observability_idx
  ON auth_users(last_sign_in_at DESC, user_id);
CREATE INDEX IF NOT EXISTS billing_checkout_observability_idx
  ON billing_checkout_requests(provider, status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS subscriptions_observability_idx
  ON subscriptions(provider, status, plan_code, updated_at DESC, owner_id);
```

Copiar o mesmo bloco idempotente para `cloudflare/runtime-schema.sql`, pois o cutover de produção aplica esse arquivo diretamente.

- [ ] **Step 4: Atualizar o helper Miniflare para aplicar 0008**

No array de schemas de `tests/helpers/cloudflare-local.mjs`, acrescentar:

```js
'cloudflare/migrations/0008-usage-observability.sql',
```

após `0007-clinical-query-performance.sql`.

- [ ] **Step 5: Rodar os testes de schema e regressão D1**

Run:

```powershell
node --test tests/usage-observability-schema.test.mjs tests/block-9-d1-hardening.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add cloudflare/migrations/0008-usage-observability.sql cloudflare/runtime-schema.sql tests/helpers/cloudflare-local.mjs tests/usage-observability-schema.test.mjs
git commit -m "feat: add usage observability d1 schema"
```

---

### Task 2: Implementar o serviço atômico de presença e sessões

**Files:**
- Create: `worker/usage-presence-service.js`
- Create: `worker/usage-presence-service.test.mjs`

**Interfaces:**
- Produces `recordUsageHeartbeat(env, userId, now = new Date())` → `{online:true, sessionId, lastSeenAt, addedSeconds, newSession}`.
- Produces `closeUsageSession(env, userId, now = new Date())` → `{closed:boolean}`.
- Produces `cleanupExpiredUsageSessions(env, {beforeIso, limit=200})` → `{deleted:number}`.
- Task 3 consumes `recordUsageHeartbeat` and `closeUsageSession`.
- Task 6 consumes `cleanupExpiredUsageSessions`.

- [ ] **Step 1: Escrever testes de primeira sessão, continuidade, nova sessão e gap**

Use o runtime D1 real de `tests/helpers/cloudflare-local.mjs`. Os testes devem fixar relógios, por exemplo:

```js
const t0 = new Date('2026-09-25T12:00:00.000Z');
const first = await recordUsageHeartbeat(env, userId, t0);
assert.equal(first.newSession, true);
assert.equal(first.addedSeconds, 0);

const second = await recordUsageHeartbeat(env, userId, new Date('2026-09-25T12:01:00.000Z'));
assert.equal(second.newSession, false);
assert.equal(second.addedSeconds, 60);

const afterGap = await recordUsageHeartbeat(env, userId, new Date('2026-09-25T12:20:00.000Z'));
assert.equal(afterGap.newSession, true);
assert.equal(afterGap.addedSeconds, 0);
```

Também consultar `user_sessions` e `user_usage_daily` e confirmar que o gap de 19 minutos não foi somado.

- [ ] **Step 2: Escrever os casos de Review Focus de concorrência e heartbeat atrasado**

Adicionar teste com `Promise.all` para dois heartbeats no mesmo instante/intervalo. Depois de ambos retornarem, a soma em `duration_seconds` e `active_seconds` deve ter crescido apenas uma vez.

Adicionar heartbeat com timestamp anterior ao `last_seen_at` e confirmar:

```js
assert.equal(row.last_seen_at, '2026-09-25T12:01:00.000Z');
assert.equal(row.duration_seconds, 60);
```

- [ ] **Step 3: Rodar os testes e confirmar falha**

Run:

```powershell
node --test worker/usage-presence-service.test.mjs
```

Expected: FAIL por módulo/funções ausentes.

- [ ] **Step 4: Implementar o algoritmo de claim por heartbeat**

Em `worker/usage-presence-service.js`, usar `crypto.randomUUID()` como token de claim (`last_heartbeat_id`). A lógica deve ser:

```js
const SESSION_GAP_MS = 5 * 60 * 1000;
const MAX_INCREMENT_SECONDS = 90;

function safeDeltaSeconds(previousIso, nowIso) {
  const delta = Math.floor((Date.parse(nowIso) - Date.parse(previousIso)) / 1000);
  if (!Number.isFinite(delta) || delta <= 0 || delta > 5 * 60) return 0;
  return Math.min(MAX_INCREMENT_SECONDS, delta);
}
```

Para presença existente na mesma sessão, a primeira statement do `db.batch()` deve reivindicar a versão conhecida:

```sql
UPDATE user_presence
SET last_seen_at=?, last_heartbeat_id=?, updated_at=?
WHERE user_id=? AND last_seen_at=? AND current_session_id=?
```

As statements de incremento da sessão e do agregado diário devem conter uma guarda equivalente a:

```sql
... WHERE EXISTS (
  SELECT 1 FROM user_presence
  WHERE user_id=? AND last_heartbeat_id=?
)
```

Assim um heartbeat concorrente que perder o claim não soma o mesmo intervalo.

Para gap >5 minutos, o claim deve trocar `current_session_id`, encerrar a sessão anterior em seu `last_seen_at`, inserir uma nova sessão e incrementar `session_count` em 1, sem somar o período ocioso.

Para ausência de `user_presence`, usar `INSERT ... ON CONFLICT DO NOTHING` e condicionar a criação da primeira sessão ao `last_heartbeat_id` recém-inserido, evitando duas primeiras sessões concorrentes.

- [ ] **Step 5: Implementar logout e limpeza em lotes**

`closeUsageSession` deve fechar somente a sessão corrente e limpar `current_session_id` sem apagar presença histórica:

```sql
UPDATE user_sessions
SET ended_at=COALESCE(ended_at, ?), last_seen_at=CASE WHEN last_seen_at>? THEN last_seen_at ELSE ? END
WHERE id=? AND user_id=?;
```

`cleanupExpiredUsageSessions` deve executar no máximo `limit`, limitado em 500:

```sql
DELETE FROM user_sessions
WHERE id IN (
  SELECT id FROM user_sessions
  WHERE COALESCE(ended_at,last_seen_at) < ?
  ORDER BY COALESCE(ended_at,last_seen_at) ASC
  LIMIT ?
);
```

- [ ] **Step 6: Rodar testes**

```powershell
node --test worker/usage-presence-service.test.mjs
```

Expected: PASS, incluindo concorrência, teto de 90 s, gap, logout e cleanup.

- [ ] **Step 7: Commit**

```powershell
git add worker/usage-presence-service.js worker/usage-presence-service.test.mjs
git commit -m "feat: track presence and usage sessions atomically"
```

---

### Task 3: Expor heartbeat autenticado e encerrar sessão no logout

**Files:**
- Create: `worker/usage-observability-runtime.js`
- Create: `worker/usage-observability-runtime.test.mjs`
- Modify: `worker/domain-entry.js`
- Modify: `worker/cloudflare-auth-runtime.js`

**Interfaces:**
- Produces `handleUsageObservabilityRuntime(request, env, url)`.
- Public route: `POST /api/presence/heartbeat` → `{ok:true, online:true, lastSeenAt, sessionId}`.
- Internal admin routes serão adicionadas na Task 4/5 ao mesmo handler.

- [ ] **Step 1: Escrever teste 401 e heartbeat autenticado**

Com Miniflare:

```js
const unauth = await mf.dispatchFetch('http://localhost/api/presence/heartbeat', {method:'POST'});
assert.equal(unauth.status, 401);

const session = await runtime.login();
const ok = await mf.dispatchFetch('http://localhost/api/presence/heartbeat', {
  method: 'POST',
  headers: {Authorization: `Bearer ${session.access_token}`},
});
assert.equal(ok.status, 200);
assert.equal((await ok.json()).online, true);
```

- [ ] **Step 2: Escrever teste de logout encerrando sessão**

Após heartbeat, fazer `POST /api/auth/logout` com o mesmo bearer token e confirmar que `user_sessions.ended_at` deixou de ser nulo e `user_presence.current_session_id` ficou nulo.

- [ ] **Step 3: Rodar testes e confirmar falha**

```powershell
node --test worker/usage-observability-runtime.test.mjs
```

Expected: heartbeat 404 antes da implementação e logout sem efeito na sessão de uso.

- [ ] **Step 4: Implementar somente a rota pública no novo runtime**

Estrutura mínima:

```js
import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import { recordUsageHeartbeat } from './usage-presence-service.js';

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: {'content-type':'application/json; charset=utf-8','cache-control':'no-store'},
});

export async function handleUsageObservabilityRuntime(request, env, url = new URL(request.url)) {
  if (url.pathname !== '/api/presence/heartbeat') return null;
  if (request.method !== 'POST') return json(405, {error:'method_not_allowed'});
  const user = await authenticateClinicalRequest(request, env);
  if (!user?.id) return json(401, {error:'unauthorized'});
  const state = await recordUsageHeartbeat(env, user.id);
  return json(200, {ok:true, online:true, lastSeenAt:state.lastSeenAt, sessionId:state.sessionId});
}
```

- [ ] **Step 5: Conectar o handler no `domain-entry.js` antes do terminal de API**

Importar o novo handler e chamá-lo logo após o auth runtime, antes das rotas genéricas:

```js
const usageResponse = await handleUsageObservabilityRuntime(request, env, url);
if (usageResponse) return withNoIndex(usageResponse);
```

- [ ] **Step 6: Fechar sessão de uso no logout sem tornar logout dependente da telemetria**

Em `handleLogout`, após autenticar o usuário, chamar `closeUsageSession` dentro de `try/catch` próprio:

```js
try { await closeUsageSession(env, user.id); }
catch (error) { console.error('usage session close failed', error); }
```

Depois continuar revogando refresh sessions normalmente. Uma falha de telemetria nunca pode transformar logout em erro.

- [ ] **Step 7: Rodar testes de observabilidade + auth**

```powershell
node --test worker/usage-observability-runtime.test.mjs worker/cloudflare-auth-runtime.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add worker/usage-observability-runtime.js worker/usage-observability-runtime.test.mjs worker/domain-entry.js worker/cloudflare-auth-runtime.js
git commit -m "feat: expose authenticated usage heartbeat"
```

---

### Task 4: Implementar summary e usuários paginados da API interna

**Files:**
- Create: `worker/usage-observability-queries.js`
- Create: `worker/usage-observability-queries.test.mjs`
- Modify: `worker/usage-observability-runtime.js`
- Modify: `worker/usage-observability-runtime.test.mjs`

**Interfaces:**
- Produces `encodeCursor(value)` / `decodeCursor(value)`; cursor opaco base64url de `{sort,id}`.
- Produces `observabilitySummary(env, now)`.
- Produces `listObservedUsers(env, query, now)` → `{items,nextCursor,hasMore}`.
- Internal auth header: `x-debora-observability-secret` deve casar com `env.DEBORA_OBSERVABILITY_SECRET`.

- [ ] **Step 1: Escrever testes de cursor e filtros antes do código**

Casos obrigatórios:

```js
assert.deepEqual(decodeCursor(encodeCursor({sort:'2026-09-25T12:00:00.000Z',id:'u1'})), {
  sort:'2026-09-25T12:00:00.000Z', id:'u1'
});
assert.throws(() => decodeCursor('%%%'), /invalid_cursor/);
```

Seedar usuários com datas iguais e IDs diferentes; paginar 2 por vez e garantir ausência de duplicação. Incluir um usuário legado com `created_at` nulo e confirmar ordem estável usando `COALESCE(created_at,'1970-01-01T00:00:00.000Z')`.

- [ ] **Step 2: Escrever teste de summary agregado**

Seedar:
- um usuário online;
- um usuário offline;
- um checkout production pago mensal;
- um checkout sandbox pago;
- uma subscription production anual ativa.

Confirmar que sandbox não entra nos totais de produção.

- [ ] **Step 3: Rodar testes e confirmar falha**

```powershell
node --test worker/usage-observability-queries.test.mjs
```

Expected: FAIL por módulo ausente.

- [ ] **Step 4: Implementar cursor e normalização de limites**

```js
export function pageLimit(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(1, Math.min(100, Math.floor(n))) : fallback;
}
```

O cursor deve ser `btoa(JSON.stringify(...))` em base64url e rejeitar objeto sem `sort`/`id` strings.

- [ ] **Step 5: Implementar `observabilitySummary` com SQL agregado**

Executar consultas `COUNT`, `SUM` e `CASE` diretamente no D1. Não usar `SELECT *`. O objeto retornado deve seguir:

```js
{
  accounts: {total, createdToday, created7d, created30d},
  presence: {onlineNow, activeToday, active7d, active30d},
  usage: {sessionsToday, activeSecondsToday, activeSeconds7d, activeSeconds30d},
  plans: {freemium, proMonthly, proAnnual},
  billing: {checkoutsCreated, paid, failed, expired, realizedRevenueCents},
  subscriptions: {active, pastDue, cancelled, expired}
}
```

`onlineNow` usa `last_seen_at >= now - 2min`. `realizedRevenueCents` soma somente `billing_checkout_requests.total_cents` com `provider='asaas' AND status='paid'`.

- [ ] **Step 6: Implementar `listObservedUsers` com keyset**

Ordenação base:

```sql
ORDER BY COALESCE(u.created_at,'1970-01-01T00:00:00.000Z') DESC, u.user_id DESC
```

Cursor:

```sql
AND (
  COALESCE(u.created_at,'1970-01-01T00:00:00.000Z') < ? OR
  (COALESCE(u.created_at,'1970-01-01T00:00:00.000Z') = ? AND u.user_id < ?)
)
```

Buscar `limit + 1`; remover o excedente para derivar `hasMore` e `nextCursor`.

Campos permitidos por item:

```js
{
  userId, email, createdAt, lastSignInAt, lastSeenAt, online,
  planCode, subscriptionStatus, currentPeriodEnd,
  sessionsToday, activeSecondsToday, activeSeconds7d, activeSeconds30d
}
```

Filtros `search`, `plan`, `status`, `online`, `createdFrom`, `createdTo`, `lastSeenFrom`, `lastSeenTo` entram como binds; jamais concatenar valor bruto do usuário em SQL.

- [ ] **Step 7: Adicionar segredo e duas rotas internas ao runtime**

Criar `sameSecret` por SHA-256/timing-safe lógico, seguindo o padrão existente do ecossistema. Antes de qualquer query interna:

```js
if (!await sameSecret(
  request.headers.get('x-debora-observability-secret') || '',
  String(env.DEBORA_OBSERVABILITY_SECRET || '')
)) return json(401, {error:'unauthorized'});
```

Adicionar:

```text
GET /api/internal/observability/summary
GET /api/internal/observability/users
```

Erros de cursor devem virar 400 `{error:'invalid_cursor'}`.

- [ ] **Step 8: Rodar testes**

```powershell
node --test worker/usage-observability-queries.test.mjs worker/usage-observability-runtime.test.mjs
```

Expected: PASS, incluindo segredo incorreto = 401.

- [ ] **Step 9: Commit**

```powershell
git add worker/usage-observability-queries.js worker/usage-observability-queries.test.mjs worker/usage-observability-runtime.js worker/usage-observability-runtime.test.mjs
git commit -m "feat: expose paginated observability users and summary"
```

---

### Task 5: Implementar vendas e sessões paginadas da API interna

**Files:**
- Modify: `worker/usage-observability-queries.js`
- Modify: `worker/usage-observability-queries.test.mjs`
- Modify: `worker/usage-observability-runtime.js`
- Modify: `worker/usage-observability-runtime.test.mjs`

**Interfaces:**
- Produces `listObservedSales(env, query)` → `{items,nextCursor,hasMore}`.
- Produces `listUserSessions(env, userId, query)` → `{items,nextCursor,hasMore}`.
- Routes:
  - `GET /api/internal/observability/sales`
  - `GET /api/internal/observability/users/:id/sessions`

- [ ] **Step 1: Escrever teste de vendas production vs sandbox**

Seedar dois checkouts pagos idênticos, um `asaas`, outro `asaas_sandbox`. Chamar `listObservedSales` sem filtro de provider e confirmar retorno apenas do production.

Resposta por item:

```js
{
  checkoutId, ownerId, email, planCode, status, provider,
  subtotalCents, discountCents, totalCents,
  createdAt, updatedAt, externalCheckoutId
}
```

- [ ] **Step 2: Escrever teste de keyset de sessões**

Criar três sessões com o mesmo `started_at` e IDs diferentes; buscar 2 + próxima página e confirmar todos os três exatamente uma vez.

- [ ] **Step 3: Rodar e confirmar falha**

```powershell
node --test worker/usage-observability-queries.test.mjs
```

Expected: FAIL por funções ausentes.

- [ ] **Step 4: Implementar vendas paginadas**

Ordenação:

```sql
ORDER BY c.created_at DESC, c.id DESC
```

Default `provider='asaas'`. Aceitar filtros de `plan`, `status`, `createdFrom`, `createdTo`; não oferecer sandbox no contrato usado pela Central nessa primeira versão.

Para e-mail, fazer `LEFT JOIN auth_users u ON u.user_id=c.owner_id` e fallback para `billing_pending_signups` somente quando necessário, selecionando apenas `email`.

- [ ] **Step 5: Implementar sessões paginadas por usuário**

Validar `userId` como string não vazia e limitar o tamanho. Query:

```sql
SELECT id,user_id,started_at,last_seen_at,ended_at,duration_seconds
FROM user_sessions
WHERE user_id=?
  AND (started_at < ? OR (started_at=? AND id < ?))
ORDER BY started_at DESC,id DESC
LIMIT ?
```

Sem cursor, omitir a cláusula keyset. Buscar `limit + 1`.

- [ ] **Step 6: Conectar as duas rotas internas**

Preservar o mesmo guard de segredo das outras rotas. Extrair `:id` somente para o padrão exato `/api/internal/observability/users/<id>/sessions`.

- [ ] **Step 7: Rodar testes**

```powershell
node --test worker/usage-observability-queries.test.mjs worker/usage-observability-runtime.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add worker/usage-observability-queries.js worker/usage-observability-queries.test.mjs worker/usage-observability-runtime.js worker/usage-observability-runtime.test.mjs
git commit -m "feat: add paginated observability sales and sessions"
```

---

### Task 6: Adicionar heartbeat best-effort ao frontend canônico

**Files:**
- Create: `public/usage-presence-runtime.js`
- Modify: `src/bootstrap.js`
- Create: `tests/usage-presence-frontend.test.mjs`
- Modify: `scripts/materialize-cloudflare-frontend.mjs` only if its audited asset allowlist/contract requires the new runtime file after the failing test proves it.

**Interfaces:**
- Frontend reads the same compatible session keys already used by `canonical-identity-runtime.js`.
- Calls `POST /api/presence/heartbeat` with bearer token.
- Never blocks app startup and never surfaces telemetry failures to the clinical user.

- [ ] **Step 1: Escrever teste estático do contrato frontend**

`tests/usage-presence-frontend.test.mjs` deve exigir:

```js
assert.match(runtime, /\/api\/presence\/heartbeat/);
assert.match(runtime, /60000/);
assert.match(runtime, /Authorization/);
assert.match(bootstrap, /usage-presence-runtime\.js/);
```

Também assegurar que a chamada é `catch`/best-effort e que não há payload clínico:

```js
assert.doesNotMatch(runtime, /patient|mother|baby|prontu/i);
```

- [ ] **Step 2: Rodar e confirmar falha**

```powershell
node --test tests/usage-presence-frontend.test.mjs
```

Expected: FAIL por arquivo ausente/injeção ausente.

- [ ] **Step 3: Implementar runtime de presença**

O módulo deve:
- ler `access_token` de `amamentacao-session`, `debora-lactacao-session` e `commercial.saas.session.v1` em `localStorage`/`sessionStorage`;
- fazer heartbeat imediato após sessão disponível;
- repetir em `setInterval(..., 60000)`;
- ouvir `canonical-auth-session` para trocar token sem reload;
- pausar envio quando `document.visibilityState === 'hidden'` e enviar novamente em `visibilitychange` ao voltar visível;
- usar `fetch('/api/presence/heartbeat', {method:'POST', headers:{Authorization:`Bearer ${token}`}})` sem body;
- capturar erros e não alterar a UI.

- [ ] **Step 4: Injetar o módulo no bootstrap**

Adicionar ao HTML canônico gerado por `src/bootstrap.js`:

```html
<script type="module" src="/usage-presence-runtime.js"></script>
```

logo após `canonical-identity-runtime.js`, mantendo a ordem dos módulos existentes.

- [ ] **Step 5: Rodar teste frontend e materialização**

```powershell
node --test tests/usage-presence-frontend.test.mjs tests/frontend-cloudflare-cutover.test.mjs
node scripts/materialize-cloudflare-frontend.mjs
```

Se `materialize-cloudflare-frontend.mjs` falhar porque mantém uma lista explícita de assets runtime, adicionar `public/usage-presence-runtime.js` nessa lista e repetir. Não fazer alterações adicionais nesse script se ele já passar.

- [ ] **Step 6: Commit**

```powershell
git add public/usage-presence-runtime.js src/bootstrap.js tests/usage-presence-frontend.test.mjs scripts/materialize-cloudflare-frontend.mjs
git commit -m "feat: send best effort usage heartbeats"
```

Se `scripts/materialize-cloudflare-frontend.mjs` não tiver sido modificado, removê-lo do `git add`.

---

### Task 7: Adicionar limpeza programada e validar performance/segurança

**Files:**
- Modify: `worker/domain-entry.js`
- Modify: `wrangler.jsonc`
- Create: `worker/usage-observability-maintenance.test.mjs`
- Create: `tests/usage-observability-security.test.mjs`

**Interfaces:**
- Worker passa a exportar `scheduled(controller, env, ctx)` além de `fetch`.
- Cron diário chama `cleanupExpiredUsageSessions` com cutoff de 12 meses e lotes de 200.

- [ ] **Step 1: Escrever teste de manutenção em lote**

Seedar 250 sessões com mais de 12 meses e 10 recentes. Uma execução deve remover exatamente 200 antigas; segunda execução remove as 50 restantes; recentes ficam.

- [ ] **Step 2: Escrever teste de segurança de payload**

Chamar summary/users/sales/sessions e serializar respostas. Falhar se chaves proibidas aparecerem:

```js
for (const forbidden of ['patient','mother','baby','clinical','diagnosis','referral','media']) {
  assert.equal(JSON.stringify(payload).toLowerCase().includes(forbidden), false);
}
```

- [ ] **Step 3: Implementar `scheduled` no Worker**

No export default de `worker/domain-entry.js`:

```js
async scheduled(_controller, env, ctx) {
  const before = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  ctx.waitUntil(cleanupExpiredUsageSessions(env, {beforeIso: before, limit: 200}));
}
```

Uma falha deve ser logada dentro da promise e nunca afetar `fetch`.

- [ ] **Step 4: Adicionar cron ao Wrangler**

Em `wrangler.jsonc`:

```json
"triggers": { "crons": ["17 4 * * *"] }
```

Sem alterar routes/services existentes.

- [ ] **Step 5: Validar `EXPLAIN QUERY PLAN` das queries críticas**

Adicionar ao teste de queries uma verificação usando D1/SQLite local de que os planos de:
- online por `last_seen_at`;
- sessões por `(user_id,started_at,id)`;
- vendas por `(provider,status,created_at,id)`;

não fazem full scan das tabelas de crescimento principal quando o filtro indexado está presente. O teste deve aceitar o texto exato do SQLite usado localmente, mas exigir o nome do índice correspondente em `detail`.

- [ ] **Step 6: Rodar suíte da feature**

```powershell
node --test tests/usage-observability-schema.test.mjs worker/usage-presence-service.test.mjs worker/usage-observability-queries.test.mjs worker/usage-observability-runtime.test.mjs worker/usage-observability-maintenance.test.mjs tests/usage-observability-security.test.mjs tests/usage-presence-frontend.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Rodar regressões existentes relevantes**

```powershell
npm run test:auth-runtime
npm run test:billing
npm run test:cloudflare-regressions
npm run build
```

Expected: todos PASS. Nenhum deploy é feito.

- [ ] **Step 8: Commit**

```powershell
git add worker/domain-entry.js wrangler.jsonc worker/usage-observability-maintenance.test.mjs tests/usage-observability-security.test.mjs worker/usage-observability-queries.test.mjs
git commit -m "test: harden usage observability maintenance and scale"
```

---

### Task 8: Fechar contrato para a Central e produzir evidência de branch sem integrar a main

**Files:**
- Create: `docs/qa/2026-09-25-debora-usage-observability-evidence.md`

**Interfaces:**
- Produces a contract/evidence document consumed during implementation of `OBRANAMAOCOMERCIAL`.
- Does not merge/rebase automatically.

- [ ] **Step 1: Registrar exemplos reais do contrato local**

Subir o runtime local e registrar no documento exemplos sanitizados de respostas para:
- `/summary`;
- primeira/segunda página de `/users`;
- `/sales`;
- `/users/:id/sessions`;
- heartbeat 401 e 200.

Não incluir secrets ou dados reais de clientes.

- [ ] **Step 2: Registrar os comandos de validação executados e resultados**

O documento deve listar os comandos da Task 7 e `PASS`/`FAIL` observado, sem afirmar PASS sem execução real.

- [ ] **Step 3: Comparar a branch com a `main` mais recente sem mesclar**

```powershell
git fetch origin main
git log --oneline HEAD..origin/main
git diff --name-status origin/main...HEAD
```

Se `origin/main` avançou, registrar no documento os arquivos que também foram alterados na main. Não rebasear nem mergear nesta task.

- [ ] **Step 4: Commit da evidência**

```powershell
git add docs/qa/2026-09-25-debora-usage-observability-evidence.md
git commit -m "docs: record usage observability qa evidence"
```

- [ ] **Step 5: Gate final desta branch**

Executar:

```powershell
git status --short
git log --oneline --decorate -8
```

Expected: working tree limpa e todos os commits da feature apenas na branch `feat/debora-usage-observability`.
