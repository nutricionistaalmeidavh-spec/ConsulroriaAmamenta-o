# SaaS Foundation Design — Fases 0–2

## Objetivo
Adicionar uma camada SaaS ao redor do aplicativo clínico existente, preservando integralmente os fluxos de pacientes, agenda, prontuário, financeiro clínico, biblioteca e mídia.

## Invariantes
- `main` não recebe mudanças durante as fases 0–2.
- IDs clínicos persistidos (`mother_id`, `baby_id`, `appointment_id`, `encounter_id`) não mudam.
- Nenhuma tabela clínica existente é alterada nesta fase.
- `owner_id` permanece a fronteira inicial entre profissionais.
- A mensalidade SaaS permanece separada do financeiro clínico.
- A conta demo não pode ser promovida a tenant real.

## Arquitetura
Criar cinco tabelas aditivas: `saas_accounts`, `professional_profiles`, `public_profiles`, `subscriptions` e `entitlements`. Todas usam `owner_id` como chave de isolamento e RLS explícito.

A landing pública passa a ser modelada por `public_profiles`, vinculada a `owner_id`. A Débora é o primeiro perfil público, com slug `debora-lactacao`; a futura página de vendas do SaaS ficará fora deste escopo.

## Fase 0 — Proteção
- Snapshot de `main` antes da fundação SaaS.
- Desenvolvimento apenas em `feature/saas-foundation-phase-0-2`.
- CI específico para validar que a fundação é aditiva e não altera tabelas clínicas.

## Fase 1 — Fundação SaaS
- Criar as cinco tabelas novas.
- Habilitar RLS em todas.
- Conceder apenas os acessos necessários à Data API.
- Escritas em `subscriptions` e `entitlements` ficam fora do cliente nesta fase.

## Fase 2 — Débora como tenant inicial
- Identificar o owner clínico legado por evidência de uso real, sem e-mail ou UUID hardcoded no repositório.
- Exigir exatamente um candidato com prontuário e financeiro reais; caso contrário, abortar a promoção.
- Criar `saas_account`, `professional_profile` e `public_profile` idempotentes.
- Publicar o slug lógico `debora-lactacao` apenas nos novos dados SaaS.
- Não tocar nos registros clínicos existentes.

## Critérios de aceitação
1. `main` e o snapshot continuam no mesmo commit clínico de referência.
2. A migration é aditiva e não contém `alter table` para tabelas clínicas existentes.
3. RLS existe nas cinco tabelas SaaS.
4. O backfill da Débora não usa e-mail ou UUID pessoal hardcoded.
5. A conta demo não satisfaz o critério de promoção.
6. A migration pode ser aplicada de forma idempotente.
7. Nenhum deploy ou alteração no banco de produção ocorre sem autorização separada.