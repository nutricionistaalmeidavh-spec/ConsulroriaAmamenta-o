# Licenciamento comercial — Cloudflare D1

Escopo: mover autorização Freemium/Pro para Cloudflare Worker + D1 sem alterar a operação clínica existente da Débora.

## Regra de isolamento

- Conta sem registro comercial: `legacy_unmanaged`; não recebe limite comercial.
- Uma conta só entra no regime comercial quando já possui `saas_accounts`, inicia checkout comercial ou recebe licença manual pelo painel CEO.
- Supabase continua responsável por Auth, pacientes, prontuários, agenda, arquivos e histórico financeiro.
- D1 passa a ser a fonte de verdade para recursos comerciais e vencimento do Pro.
- O login do superadmin da Central Artisys permanece por e-mail + senha; Google não é usado nessa tela.

## Pro manual de 6 meses

O painel CEO grava diretamente no D1 da Central Artisys:

- produto `debora-lactacao`;
- plano `pro_6m`;
- origem `mercado_livre_manual`;
- validade de seis meses-calendário;
- renovação soma seis meses ao vencimento ainda ativo;
- revogação mantém a conta como comercial e ela retorna ao Freemium.

Não existe Edge Function de licença manual no Supabase.

## Ordem segura de publicação

1. Publicar a Central Artisys com a migration D1 `0008_product_license_authority.sql`.
2. Configurar `LICENSE_SERVICE_SECRET` na Central e na Débora com o mesmo valor.
3. Configurar `SUPABASE_SERVICE_ROLE_KEY` somente como secret do Worker da Débora.
4. Publicar a Central primeiro e a Débora depois, validando `/api/license/me` antes de remover o enforcement antigo.
5. Aplicar por último `supabase/phase-cloudflare-license-authority.sql`.

A última etapa remove os triggers/policies de entitlement do Supabase somente depois que o Worker já está aceitando criação de paciente e upload de foto/vídeo. Essa ordem evita janela de indisponibilidade.

## Contratos preservados

- Dados clínicos não são migrados para D1.
- Conta clínica/legada não é transformada em Freemium automaticamente.
- PDFs clínicos continuam permitidos fora do Pro; somente foto/vídeo permanece recurso comercial.
- Checkout Asaas segue oferecendo `pro_monthly` e `pro_annual`.
- Registros de billing podem continuar no Supabase como histórico, mas não concedem recursos diretamente.
- O plano manual `pro_6m` não entra no checkout Asaas.

## Verificação local

```bash
node scripts/test-cloudflare-license-authority.mjs
```

Além disso, executar build/testes locais dos dois Workers antes da publicação final.
