# Acesso de demonstração — Débora Lactação

Este fluxo cria uma conta de apresentação com dados totalmente fictícios no D1 clínico e sincroniza uma licença Pro na autoridade central Artisys já existente.

## Identidade

- E-mail: `demonstracao@deboralactacao.com`
- UUID reservado: `3e1a72f7-0c6e-4f47-b4d8-3b931fc8d001`
- A senha **não é armazenada neste repositório**.
- O usuário é marcado internamente com `demo: true` e `purpose: commercial-presentation`.

## Pré-requisitos

1. Node.js/npm disponíveis.
2. Wrangler autenticado na conta Cloudflare que possui o D1 `debora-lactacao-clinical`.
3. `LICENSE_SERVICE_SECRET` disponível somente no ambiente local e igual ao secret usado pela autoridade central Artisys.
4. Uma senha de demonstração com pelo menos 12 caracteres.

Verifique a autenticação Cloudflare antes de executar:

```powershell
npx --yes wrangler@4 whoami
```

## Criar ou atualizar o cenário demo

Defina os valores somente na sessão atual do PowerShell:

```powershell
$env:DEMO_PASSWORD="<senha escolhida para a apresentação>"
$env:LICENSE_SERVICE_SECRET="<secret interno da autoridade Artisys>"
npm run demo:seed
```

O comando:

1. valida senha e secret antes de qualquer operação remota;
2. verifica se o UUID/e-mail reservado não colidem com outra conta;
3. sincroniza uma licença `pro_6m` ativa pela autoridade central existente;
4. grava apenas o hash PBKDF2 da senha no D1;
5. cria/atualiza de forma idempotente 6 mães, 7 bebês, agenda, atendimentos, crescimento, follow-ups e financeiro fictícios.

Depois, acesse a tela normal de login com o e-mail acima e a mesma senha fornecida em `DEMO_PASSWORD`.

## Restaurar antes de uma apresentação

```powershell
$env:DEMO_PASSWORD="<senha escolhida para a apresentação>"
$env:LICENSE_SERVICE_SECRET="<secret interno da autoridade Artisys>"
npm run demo:reset
```

O reset valida primeiro que a conta encontrada possui simultaneamente:

- o UUID reservado;
- o e-mail reservado;
- `demo: true` nos metadados.

Somente depois dessa validação ele remove:

- sessões de refresh daquele `user_id`;
- `supabase_records` cujo `owner_id` é exatamente o UUID demo.

O reset **não apaga `auth_users`, `auth_credentials` ou registros de outros proprietários**. A limpeza e o reseed são enviados no mesmo arquivo para `wrangler d1 execute --remote --file`; os scripts não emitem `BEGIN`/`COMMIT` explícitos, pois arquivos importados pelo D1 devem omitir esses comandos e a operação remota é revertida se a execução do arquivo falhar.

## Testes

```powershell
npm run test:demo
npm run test:auth-runtime
npm run test:deploy-safety
npm run build
```

## Segurança

Nunca grave `DEMO_PASSWORD` ou `LICENSE_SERVICE_SECRET` em `.env` versionado, `package.json`, documentação, issue, commit ou log de CI. Os scripts não imprimem a senha nem o secret.

O fluxo usa somente infraestrutura e código já existentes no projeto; nenhuma dependência ou serviço pago novo é necessário.
