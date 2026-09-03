# Endurecimento financeiro — 2026-09-03

Aplicado ao projeto Supabase `zxowxdfhtksevhnjmeyu` e validado antes da publicação do frontend.

## Migrations registradas no Supabase

- `20260903233757_financial_integrity_hardening`
- `20260903234003_package_billing_idempotency_hardening`
- `20260903234643_financial_mother_fk_index`

## Contratos preservados

- `set_appointment_billing(...)`
- `finalize_encounter_billing(...)`
- `set_financial_payment_state(...)`
- `ensure_financial_entry_for_encounter(...)`
- `add_care_package_item(...)` (compatibilidade)
- `consume_care_package_item(...)` (compatibilidade)

Novos endpoints idempotentes usados pelo frontend:

- `add_care_package_item_v2(..., p_request_key uuid)`
- `consume_care_package_item_v2(..., p_request_key uuid)`

## Proteções introduzidas

- vínculo financeiro validado contra `owner_id`, mãe, agendamento, prontuário, plano e item de plano;
- escrita sensível do financeiro somente pelos fluxos protegidos do backend;
- exclusão direta de lançamentos financeiros revogada para `anon`/`authenticated`;
- `Pago` exige `paid_at` e forma de pagamento;
- lançamento `Cancelado` não pode ser transformado em `Pago`;
- RPCs de cobrança e pacote não são executáveis por `anon`;
- alterações de planos, sessões, itens e usos passam por guardas de integridade;
- inclusão e consumo de serviços possuem chave de idempotência;
- refinalizar o atendimento de origem não remove adicionais já incluídos no plano;
- auditoria financeira registra também valor, descrição e vínculos antigos/novos;
- índices adicionados aos principais vínculos financeiros/pacotes.

## Reconciliação de dados

O lançamento demonstrativo de R$ 150,00 (`Consulta demo`) foi removido após snapshot em `private.data_reconciliation_audit`. O total pendente real ficou em R$ 600,00, correspondente ao plano ativo da paciente real.

## Rollback do frontend

Snapshot anterior ao endurecimento:

`snapshot/cloudflare-pre-financial-hardening-2026-09-03`

O AppDeploy permanece independente e não participa desta publicação.
