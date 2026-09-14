# Pro manual de 6 meses — ordem de publicação

Escopo: licença externa/manual (ex.: Mercado Livre) sem alterar o checkout Asaas, o login Google da aplicação clínica ou o site público da Débora.

## Ordem segura

1. Aplicar `supabase/phase-saas-manual-license.sql`.
2. Aplicar `supabase/phase-saas-manual-license-activation.sql`.
3. Criar o secret `LICENSE_ADMIN_SECRET` no projeto Supabase.
4. Publicar `saas-manual-license` com `verify_jwt: false`. A função não confia em JWT público; ela valida `x-artisys-license-secret` e usa service role somente internamente.
5. Configurar o mesmo valor como `DEBORA_LICENSE_ADMIN_SECRET` no Worker da Central Artisys.
6. Publicar a Central Artisys.

## Contratos preservados

- `saas-checkout` continua aceitando apenas `pro_monthly` e `pro_annual`.
- `pro_6m` é manual-only e não é oferecido pelo checkout Asaas.
- o superadmin da Central Artisys autoriza a operação; o e-mail informado é somente o destinatário da licença.
- a autenticação da cliente na Débora permanece independente.
- a expiração é validada no backend por `current_period_end`; não depende de cron, GitHub Actions ou serviço pago.
- usuários legados que não pertencem a `saas_accounts` permanecem fora do enforcement comercial.

## Verificação local

- `node scripts/test-manual-license.mjs`
- build/testes existentes da aplicação após as duas migrations serem materializadas no ambiente de homologação.
