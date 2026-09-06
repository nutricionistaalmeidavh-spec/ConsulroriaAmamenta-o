# SaaS Foundation Design — Fases 0–2

## Objetivo
Adicionar uma fundação SaaS comercial separada do aplicativo e da landing existentes da Débora. Os fluxos atuais de pacientes, agenda, prontuário, financeiro clínico, biblioteca, mídia e acesso da Débora permanecem fora do contrato comercial.

## Invariantes
- `main` não recebe mudanças durante as fases 0–2.
- IDs clínicos persistidos (`mother_id`, `baby_id`, `appointment_id`, `encounter_id`) não mudam.
- Nenhuma tabela clínica existente é lida ou alterada pela migration SaaS comercial.
- `owner_id` será a fronteira inicial dos novos usuários comerciais.
- A mensalidade SaaS permanece separada do financeiro clínico.
- A landing atual da Débora não é template, não é `public_profile` e não participa do funil comercial.
- Nenhum usuário comercial recebe página pública individual nesta fase.

## Arquitetura
Criar quatro tabelas aditivas para o produto comercial: `saas_accounts`, `professional_profiles`, `subscriptions` e `entitlements`. Todas usam `owner_id` como chave de isolamento e RLS explícito.

A landing existente da Débora permanece isolada e continua apontando apenas para o sistema atual dela. A futura landing comercial terá outro link e será a entrada dos novos clientes para vendas, cadastro, planos, pagamento e onboarding.

## Fase 0 — Proteção
- Snapshot de `main` antes da fundação SaaS.
- Desenvolvimento apenas em `feature/saas-foundation-phase-0-2`.
- CI específico para validar que a fundação é aditiva e não referencia tabelas clínicas.

## Fase 1 — Fundação SaaS comercial
- Criar as quatro tabelas novas.
- Habilitar RLS em todas.
- Conceder apenas os acessos necessários à Data API.
- Escritas em `saas_accounts`, `subscriptions` e `entitlements` ficam reservadas ao backend/service role nesta fase.
- `professional_profiles` pertence somente aos novos usuários autenticados do SaaS.

## Fase 2 — Isolamento do legado
- Não promover a conta atual da Débora para tenant SaaS comercial.
- Não criar `public_profiles`, slug, landing dinâmica ou entitlement legado.
- Não consultar `clinical_encounters`, `financial_entries` ou qualquer outra tabela clínica para bootstrap comercial.
- Manter o sistema e a landing existentes da Débora sem dependência de `saas_accounts`, assinatura ou plano.

## Critérios de aceitação
1. `main` e o snapshot continuam no mesmo commit clínico de referência.
2. A migration é aditiva e não referencia nem altera tabelas clínicas existentes.
3. RLS existe nas quatro tabelas SaaS comerciais.
4. `public_profiles` não existe na fundação comercial.
5. Não existe slug `debora-lactacao`, backfill ou identificação da conta atual da Débora na migration.
6. Nenhum acesso `anon` é criado para landing individual de profissionais.
7. Nenhum deploy ou alteração no banco de produção ocorre sem autorização separada.
