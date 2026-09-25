# Design — Observabilidade de uso da Débora Lactação

Data: 2026-09-25
Branch: `feat/debora-usage-observability`
Repo: `ConsulroriaAmamenta-o`

## Objetivo

Adicionar telemetria operacional administrativa para permitir à Central Artisys visualizar contas, atividade, presença online, sessões, tempo aproximado de uso, checkouts, pagamentos, assinaturas e planos da Débora Lactação sem alterar o fluxo clínico, sem expor dados de pacientes e sem transferir a autoridade de licenciamento manual para este repositório.

O sistema deve continuar funcionando normalmente mesmo se a camada de observabilidade estiver indisponível.

## Escopo

Este repositório será a fonte de verdade para:

- contas cadastradas e `created_at`;
- `last_sign_in_at`;
- presença atual (`last_seen_at`);
- sessões e duração aproximada;
- uso agregado por dia;
- checkout e pagamento via Asaas;
- assinatura e plano comercial adquirido;
- status do billing;
- endpoint administrativo interno, somente leitura, consumido pela Central Artisys.

Ficam fora de escopo:

- prontuários;
- pacientes;
- anamnese;
- diagnósticos;
- encaminhamentos;
- fotos, vídeos e documentos clínicos;
- rastreamento de conteúdo clínico acessado;
- mudança da lógica de licença manual de 6 meses da Central.

## Arquitetura

A Débora mantém os dados operacionais em seu D1 e expõe contratos internos somente leitura para a Central Artisys. A Central não acessa diretamente as tabelas internas.

Fluxo:

```text
Frontend Débora autenticado
        |
        +--> POST /api/presence/heartbeat
        |        |
        |        +--> user_presence
        |        +--> user_sessions
        |        +--> user_usage_daily
        |
        +--> auth / billing existentes
                 |
                 v
              D1 Débora
                 |
                 v
API interna de observabilidade read-only
                 |
                 v
Service Binding + segredo dedicado
                 |
                 v
Central Artisys
```

A API interna deve ser tolerante a crescimento de dados e não pode montar dashboards carregando tabelas inteiras em memória.

## Presença e sessões

### Heartbeat

- Usuário autenticado envia heartbeat aproximadamente a cada 60 segundos enquanto o app estiver ativo.
- O backend extrai o `user_id` da sessão autenticada; o cliente não pode escolher outro usuário.
- Online significa `now - last_seen_at <= 2 minutos`.
- Múltiplas abas do mesmo usuário devem convergir para a mesma janela de sessão.
- Heartbeats excessivamente frequentes não podem inflar o tempo de uso.

### Continuidade de sessão

- Se houver atividade com intervalo menor que 5 minutos, continua a mesma sessão.
- Após mais de 5 minutos sem atividade, um novo heartbeat cria nova sessão.
- Logout normal pode encerrar a sessão antecipadamente, mas o desenho não depende de evento de fechamento de navegador.

### Modelo D1

`user_presence`

- `user_id` PK;
- `first_seen_at`;
- `last_seen_at`;
- `current_session_id`;
- `updated_at`.

`user_sessions`

- `id` PK;
- `user_id`;
- `started_at`;
- `last_seen_at`;
- `ended_at`;
- `duration_seconds`;
- `created_at`.

`user_usage_daily`

- `user_id`;
- `usage_date`;
- `session_count`;
- `active_seconds`;
- `first_seen_at`;
- `last_seen_at`;
- chave única `(user_id, usage_date)`.

Não haverá armazenamento permanente de um evento bruto por heartbeat.

## Retenção

- `user_presence`: estado atual, sem histórico bruto.
- `user_sessions`: histórico detalhado por até 12 meses.
- `user_usage_daily`: agregado histórico.
- limpeza de sessões antigas em lotes pequenos, evitando delete massivo bloqueante.

## Escala e paginação

Nenhum endpoint de lista pode retornar o conjunto inteiro por padrão.

### Regras

- paginação por cursor/keyset;
- default de 50 usuários por página;
- default de 25 sessões por página;
- máximo de 100 registros por requisição;
- filtros aplicados no backend antes da paginação;
- ordenação determinística;
- índices alinhados às consultas reais;
- sem `OFFSET` profundo como estratégia principal;
- sem `SELECT *` amplo para dashboards;
- métricas agregadas separadas das listas.

### Índices previstos

Avaliar e criar somente os índices necessários para as consultas efetivas, incluindo combinações equivalentes a:

- `auth_users(created_at)`;
- `auth_users(last_sign_in_at)`;
- `user_presence(last_seen_at)`;
- `user_sessions(user_id, started_at)`;
- `user_sessions(started_at)`;
- `billing_checkout_requests(status, created_at)`;
- `billing_checkout_requests(plan_code, status, created_at)`;
- `subscriptions(status, updated_at)`;
- `subscriptions(plan_code, status)`.

A implementação deve validar o plano de consulta das queries críticas antes de considerar a feature concluída.

## API interna de observabilidade

Contratos previstos:

```text
GET /api/internal/observability/summary
GET /api/internal/observability/users?limit=50&cursor=...
GET /api/internal/observability/sales?limit=50&cursor=...
GET /api/internal/observability/users/:id/sessions?limit=25&cursor=...
```

Filtros de usuários podem incluir:

- `plan`;
- `status`;
- `online`;
- `createdFrom` / `createdTo`;
- `lastSeenFrom` / `lastSeenTo`;
- `search` por e-mail.

Filtros de vendas podem incluir:

- plano;
- status do checkout;
- status do pagamento;
- período;
- provedor.

Resposta paginada deve usar cursor opaco e informar `hasMore` / `nextCursor`.

## Summary

O endpoint de resumo deve usar consultas agregadas, não carregar usuários para contar em JavaScript.

Métricas previstas:

- contas totais;
- contas criadas hoje / 7 dias / 30 dias;
- online agora;
- ativos hoje / 7 dias / 30 dias;
- sessões hoje;
- tempo agregado hoje / 7 dias / 30 dias;
- Freemium;
- Pro mensal;
- Pro anual;
- checkouts criados;
- pagamentos confirmados;
- assinaturas ativas / vencidas / past_due / canceladas;
- receita realizada via Asaas, quando suportada pelos dados existentes.

A licença manual de 6 meses será enriquecida e contabilizada na Central, não inferida neste endpoint como compra Asaas.

## Segurança

A comunicação administrativa será server-to-server:

```text
Central backend -> Service Binding -> Worker Débora
```

Requisitos:

- segredo dedicado, por exemplo `DEBORA_OBSERVABILITY_SECRET`;
- não reutilizar `ASAAS_SECRET` nem outro segredo de finalidade diferente;
- segredo nunca exposto ao navegador;
- endpoint interno somente leitura;
- comparação segura de segredo;
- `cache-control: no-store`;
- sem dados clínicos no payload;
- seleção explícita de campos.

## Compatibilidade com billing existente

Não alterar a autoridade nem a semântica atual de:

- checkout Asaas;
- webhook;
- ativação automática pós-pagamento;
- `billing_checkout_requests`;
- `subscriptions`;
- fluxo de cadastro Pro.

A observabilidade apenas consulta e agrega esses dados.

## Tolerância a falhas

- Falha da API interna não pode quebrar login, clínica, billing ou licenciamento.
- Heartbeat deve falhar de forma silenciosa/recuperável para o usuário final.
- Se a telemetria estiver indisponível, a aplicação clínica continua operacional.

## Testes obrigatórios

### Presença e sessão

- heartbeat autenticado;
- 401 sem autenticação;
- online dentro de 2 min;
- offline após janela aprovada;
- mesma sessão com intervalos abaixo de 5 min;
- nova sessão acima de 5 min;
- múltiplas abas sem multiplicar tempo;
- logout;
- virada de dia;
- agregação diária correta;
- limpeza em lotes.

### Escala

- cursor pagination sem duplicação;
- estabilidade com inserções entre páginas;
- `limit` máximo;
- filtros server-side;
- summary sem carregar listas completas;
- sessões paginadas;
- queries críticas suportadas pelos índices previstos.

### Billing e contas

- Freemium;
- Pro mensal;
- Pro anual;
- checkout criado;
- pago;
- failed;
- expired;
- subscription active;
- past_due;
- cancelled;
- valores e datas corretos.

### Segurança

- segredo ausente/incorreto = 401;
- nenhum endpoint administrativo exposto diretamente ao browser sem proteção;
- payload sem campos clínicos.

## Critérios de aceite

A feature neste repositório estará pronta quando:

1. uma conta criada aparecer no endpoint administrativo paginado;
2. login atualizar `last_sign_in_at` normalmente;
3. heartbeat tornar a conta online na janela de 2 minutos;
4. ausência de heartbeat retirar o status online sem exigir logout;
5. sessões e agregados de uso refletirem atividade sem duplicação por aba;
6. billing e planos puderem ser consultados paginadamente;
7. summary usar agregações server-side;
8. nenhuma consulta administrativa exigir carregamento integral das tabelas;
9. nenhum dado clínico aparecer no contrato;
10. indisponibilidade da observabilidade não impactar os fluxos existentes.

## Integração com o repositório da Central

A Central Artisys consumirá estes contratos a partir da branch irmã `feat/debora-usage-observability-central` no repo `OBRANAMAOCOMERCIAL`.

Antes do merge final, ambas as branches deverão ser comparadas com as respectivas `main` atualizadas. Alterações paralelas serão incorporadas antes da integração; arquivos novos ou modificados em `main` não serão sobrescritos por versões antigas da branch.
