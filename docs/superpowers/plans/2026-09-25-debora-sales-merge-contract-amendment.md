# Débora Sales Merge Contract — Implementation Plan Amendment

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. This amendment is mandatory and is executed immediately after Task 5 of `2026-09-25-debora-usage-observability.md`, before its commit is considered complete.

**Goal:** Permitir que a Central Artisys consolide vendas Asaas da Débora com vendas manuais do próprio D1 usando uma única paginação keyset determinística, sem OFFSET e sem perder/duplicar itens quando timestamps empatam.

**Architecture:** O endpoint interno de vendas continua paginado normalmente, mas aceita opcionalmente um boundary global fornecido pela Central. Vendas Asaas têm `sourceRank=1`; vendas manuais na Central têm `sourceRank=0`. O boundary usa `(createdAt DESC, sourceRank DESC, id DESC)`.

**Spec:** `docs/superpowers/specs/2026-09-25-debora-usage-observability-design.md`; contrato consumidor em `OBRANAMAOCOMERCIAL/docs/superpowers/plans/2026-09-25-debora-usage-observability-central.md`, Task 7.

## Global Constraints

- Sem boundary global, `/api/internal/observability/sales` mantém o cursor automático descrito no plano principal.
- Com boundary global, não combinar também o cursor automático na mesma requisição; combinação inválida retorna 400.
- `sourceRank` aceito no boundary: somente `0` ou `1`.
- O endpoint da Débora representa apenas fonte Asaas, portanto o rank da linha consultada é sempre `1`.
- Todos os valores continuam bindados; nunca concatenar timestamp/id na SQL.

## Review Focus

1. Cursor apontando para uma venda Asaas no mesmo timestamp deve continuar pelos IDs menores antes de chegar às manuais.
2. Cursor apontando para uma venda manual deve excluir todas as vendas Asaas do mesmo timestamp, pois rank 1 já foi emitido antes do rank 0.
3. Boundary inválido não pode cair silenciosamente para primeira página.

### Task A1: Estender o contrato da listagem de vendas

**Files:**
- Modify: `worker/usage-observability-queries.js`
- Modify: `worker/usage-observability-queries.test.mjs`
- Modify: `worker/usage-observability-runtime.js`
- Modify: `worker/usage-observability-runtime.test.mjs`

- [ ] **Step 1: Escrever os testes de empate entre fontes**

Seedar vendas Asaas:

```text
2026-09-25T12:00:00Z A2
2026-09-25T12:00:00Z A1
2026-09-25T11:00:00Z A0
```

Testar:

```js
// Global cursor ainda está em Asaas rank=1 no mesmo timestamp.
const afterA2 = await listObservedSales(env, {
  limit: 10,
  mergeCreatedAt: '2026-09-25T12:00:00.000Z',
  mergeSourceRank: '1',
  mergeId: 'A2',
});
assert.deepEqual(afterA2.items.map(x => x.checkoutId), ['A1','A0']);

// Global cursor já chegou à fonte manual rank=0 nesse timestamp.
const afterManualAtNoon = await listObservedSales(env, {
  limit: 10,
  mergeCreatedAt: '2026-09-25T12:00:00.000Z',
  mergeSourceRank: '0',
  mergeId: 'M2',
});
assert.deepEqual(afterManualAtNoon.items.map(x => x.checkoutId), ['A0']);
```

Adicionar casos 400 para boundary incompleto, rank fora de 0/1 e combinação `cursor` + `mergeCreatedAt`.

- [ ] **Step 2: Rodar e confirmar falha**

```powershell
node --test worker/usage-observability-queries.test.mjs worker/usage-observability-runtime.test.mjs
```

Expected: FAIL nos novos casos.

- [ ] **Step 3: Implementar parser do boundary global**

```js
export function mergeSalesBoundary(query) {
  const present = ['mergeCreatedAt','mergeSourceRank','mergeId'].filter(key => query[key] != null && query[key] !== '');
  if (!present.length) return null;
  if (present.length !== 3 || query.cursor) throw new Error('invalid_cursor');
  const createdAt = String(query.mergeCreatedAt);
  const sourceRank = Number(query.mergeSourceRank);
  const id = String(query.mergeId);
  if (!Number.isFinite(Date.parse(createdAt)) || ![0,1].includes(sourceRank) || !id || id.length > 200) {
    throw new Error('invalid_cursor');
  }
  return {createdAt,sourceRank,id};
}
```

- [ ] **Step 4: Aplicar a ordem global à fonte Asaas**

Como `sourceRank` da linha Asaas é sempre `1`, acrescentar à query quando há boundary:

```sql
AND (
  c.created_at < ?
  OR (
    c.created_at = ?
    AND (
      1 < ?
      OR (1 = ? AND c.id < ?)
    )
  )
)
```

Binds: `createdAt, createdAt, sourceRank, sourceRank, id`.

Com cursor manual rank 0, a condição no mesmo timestamp é falsa para Asaas; com cursor Asaas rank 1, IDs menores continuam.

- [ ] **Step 5: Propagar os três query params no runtime**

A rota `/api/internal/observability/sales` deve aceitar `mergeCreatedAt`, `mergeSourceRank`, `mergeId` e devolvê-los apenas como entrada de paginação; eles não aparecem no payload de item.

- [ ] **Step 6: Rodar testes**

```powershell
node --test worker/usage-observability-queries.test.mjs worker/usage-observability-runtime.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Incluir no mesmo commit da Task 5 ou em commit imediatamente seguinte**

```powershell
git add worker/usage-observability-queries.js worker/usage-observability-queries.test.mjs worker/usage-observability-runtime.js worker/usage-observability-runtime.test.mjs
git commit -m "feat: support cross-source sales keyset boundary"
```
