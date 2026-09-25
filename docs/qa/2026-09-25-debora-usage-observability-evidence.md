# Evidência — Observabilidade de uso da Débora Lactação

Data: 2026-09-25
Branch: `feat/debora-usage-observability`

## Estado verificado

- Head da branch no fechamento desta rodada: `ceab1c1b9fa3ce2f78182b0e880c01eb31551e8f`.
- `main` consultada: `1dc37e395ef2ee74812ad8ad32fff56debe4f0d7`.
- Comparação GitHub: branch `ahead` 14 commits, `behind` 0; merge-base igual à `main` consultada.
- Nenhum merge em `main` foi realizado.
- Nenhum deploy foi realizado.
- Nenhuma migration D1 remota foi executada.

## Implementação presente na branch

- schema D1 de `user_presence`, `user_sessions` e `user_usage_daily`;
- índices para presença, sessões, billing e subscriptions;
- heartbeat autenticado;
- consolidação de múltiplas abas/requisições concorrentes por claim/CAS;
- sessão nova após gap superior a 5 minutos;
- teto de 90 segundos creditados por heartbeat;
- encerramento best-effort no logout;
- summary agregado em SQL;
- usuários com cursor/keyset;
- vendas Asaas de produção com cursor/keyset e boundary cross-repo;
- sessões com cursor/keyset;
- exclusão de `asaas_sandbox` das métricas/vendas de produção;
- frontend heartbeat best-effort aproximadamente a cada 60 segundos;
- retenção detalhada de sessões por 12 meses com limpeza diária em lotes de 200;
- testes de contrato para schema, concorrência, paginação, payload administrativo, query plan e retenção.

## Contrato administrativo esperado

Os exemplos abaixo são **formas de contrato**, não capturas de produção.

### Summary

```json
{
  "accounts": {"total": 0, "createdToday": 0, "created7d": 0, "created30d": 0},
  "presence": {"onlineNow": 0, "activeToday": 0, "active7d": 0, "active30d": 0},
  "usage": {"sessionsToday": 0, "activeSecondsToday": 0, "activeSeconds7d": 0, "activeSeconds30d": 0},
  "plans": {"freemium": 0, "proMonthly": 0, "proAnnual": 0},
  "billing": {"checkoutsCreated": 0, "paid": 0, "failed": 0, "expired": 0, "realizedRevenueCents": 0},
  "subscriptions": {"active": 0, "pastDue": 0, "cancelled": 0, "expired": 0}
}
```

### Usuários

```json
{
  "items": [{
    "userId": "example-user",
    "email": "example@example.test",
    "createdAt": "2026-09-25T10:00:00.000Z",
    "lastSignInAt": "2026-09-25T11:00:00.000Z",
    "lastSeenAt": "2026-09-25T11:59:30.000Z",
    "online": true,
    "planCode": "pro_monthly",
    "subscriptionStatus": "active",
    "currentPeriodEnd": "2026-10-25T00:00:00.000Z",
    "sessionsToday": 1,
    "activeSecondsToday": 3600,
    "activeSeconds7d": 3600,
    "activeSeconds30d": 3600
  }],
  "nextCursor": null,
  "hasMore": false
}
```

### Vendas

```json
{
  "items": [{
    "checkoutId": "checkout-id",
    "source": "asaas",
    "sourceRank": 1,
    "email": "example@example.test",
    "planCode": "pro_monthly",
    "status": "paid",
    "provider": "asaas",
    "totalCents": 9990,
    "createdAt": "2026-09-25T09:00:00.000Z"
  }],
  "nextCursor": null,
  "hasMore": false
}
```

### Sessões

```json
{
  "items": [{
    "id": "session-id",
    "startedAt": "2026-09-25T10:00:00.000Z",
    "lastSeenAt": "2026-09-25T11:00:00.000Z",
    "endedAt": null,
    "durationSeconds": 3600
  }],
  "nextCursor": null,
  "hasMore": false
}
```

## Segurança

- endpoints `/api/internal/observability/*` exigem `DEBORA_OBSERVABILITY_SECRET` por header server-to-server;
- segredo não está versionado;
- heartbeat usa a identidade autenticada do request e não aceita `user_id` fornecido pelo browser;
- consultas administrativas selecionam apenas conta, billing, presença e uso;
- dados de paciente/prontuário/anamnese/diagnóstico/encaminhamento/mídia não fazem parte do contrato;
- respostas administrativas usam `cache-control: no-store`.

## Escala

- usuários/vendas: default 50, máximo 100;
- sessões: default 25, máximo 100;
- paginação por keyset/cursor, sem `OFFSET` profundo;
- cards usam agregações SQL;
- heartbeats não criam uma linha histórica por minuto;
- sessões antigas são eliminadas em lotes de 200;
- foram adicionados testes de `EXPLAIN QUERY PLAN` para os índices de presença, sessões e vendas.

## Execução de testes nesta sessão

O ambiente disponível nesta sessão não conseguiu clonar/resolver `github.com`, e os commits da feature não dispararam workflow de CI associado. Portanto os comandos abaixo estão **NOT EXECUTED nesta sessão**; nenhum deles é registrado como PASS sem execução real.

```powershell
node --test tests/usage-observability-schema.test.mjs worker/usage-presence-service.test.mjs worker/usage-observability-queries.test.mjs tests/usage-observability-runtime-contract.test.mjs worker/usage-observability-maintenance.test.mjs tests/usage-observability-security.test.mjs tests/usage-observability-query-plan.test.mjs tests/usage-presence-frontend.test.mjs
npm run test:auth-runtime
npm run test:billing
npm run test:cloudflare-regressions
npm run build
```

Esses comandos permanecem gate obrigatório antes de qualquer merge/deploy.

## Comparação com `main`

Na comparação executada pelo GitHub em 2026-09-25:

- base/main: `1dc37e395ef2ee74812ad8ad32fff56debe4f0d7`;
- feature: `ceab1c1b9fa3ce2f78182b0e880c01eb31551e8f`;
- status: `ahead`;
- ahead: 14;
- behind: 0;
- não havia avanço paralelo da `main` desde o baseline desta branch no momento da comparação.

Antes de integração futura, repetir esta comparação porque a `main` pode avançar depois deste registro.
