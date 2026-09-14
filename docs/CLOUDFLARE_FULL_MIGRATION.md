# Migração Supabase → Cloudflare — Débora Lactação

## Objetivo

Copiar o estado atual da Débora para infraestrutura própria no Cloudflare **sem depender da senha do Postgres do Supabase** e sem apagar a origem durante a transição.

O migrador usa apenas:

- Supabase CLI autenticado para obter uma chave server-side do projeto;
- REST/PostgREST para exportar tabelas públicas;
- Auth Admin API para copiar identidade/metadados dos usuários;
- Storage API para baixar todos os buckets/objetos;
- Cloudflare D1 para os registros;
- Cloudflare R2 privado para os arquivos.

## Garantias de segurança

1. O snapshot local é criado **antes** de qualquer gravação no Cloudflare.
2. O script não executa `supabase link`, `db push`, migrations nem SQL destrutivo no Supabase.
3. O Supabase não é apagado nem desativado automaticamente.
4. O D1 usa `CREATE TABLE IF NOT EXISTS` e upserts idempotentes.
5. A migração falha fechada se as contagens D1 não baterem com a origem.
6. Os objetos do Storage são copiados para um bucket R2 privado.
7. Senhas não são migradas: o Supabase não expõe os hashes originais. Cada identidade é marcada no D1 com `password_reset_required = 1`.

## Recursos alvo

- D1: `debora-lactacao-clinical`
- R2: `debora-lactacao-clinical`
- Backup local: `Documentos/DeboraCloudflareBackup/<timestamp>-<run-id>`

O D1 mantém uma cópia lossless dos registros em JSON na tabela `supabase_records`. Isso evita descartar campos clínicos durante a migração e permite evoluir o modelo Cloudflare posteriormente sem reexportar a origem.

## 1. Dry-run / snapshot

O dry-run autentica no Supabase, descobre todas as tabelas expostas, exporta usuários e baixa todos os arquivos para backup local. Ele **não cria nem altera D1/R2**.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\migrate-supabase-to-cloudflare.ps1
```

Saída esperada:

```text
DRY-RUN CONCLUÍDO: nada foi gravado no Cloudflare.
```

## 2. Copiar para Cloudflare

Somente depois de revisar o resumo do dry-run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\migrate-supabase-to-cloudflare.ps1 -Apply
```

O modo `-Apply`:

1. repete o snapshot para garantir dados atuais;
2. autentica no Cloudflare;
3. cria o D1/R2 se ainda não existirem;
4. aplica `cloudflare/full-migration-schema.sql`;
5. importa todas as tabelas públicas de forma idempotente;
6. copia usuários como identidade/metadados;
7. copia os bytes de todos os buckets para R2;
8. valida contagens por tabela, usuários e objetos;
9. grava `migration-report.json` no diretório de backup.

Saída de sucesso:

```text
MIGRAÇÃO DE DADOS VALIDADA
```

## O que este script propositalmente NÃO faz

Ele não desliga o Supabase e não troca automaticamente o frontend em produção. O motivo é evitar um corte irreversível antes de o runtime D1/R2 e a autenticação Cloudflare estarem validados com o usuário real.

A identidade dos usuários é copiada, porém as senhas precisam ser redefinidas no futuro cutover de autenticação. Até esse corte, o Supabase Auth pode continuar funcionando como ponte temporária.

## Rollback

Não há rollback destrutivo porque o processo é copy-first:

- o Supabase continua intacto;
- o backup local permanece disponível;
- D1/R2 podem ser ignorados se a validação falhar;
- nenhuma regra clínica do Supabase é removida por este migrador.

## Validação estática do migrador

```powershell
node .\scripts\test-full-cloudflare-migration-contract.mjs
```

O teste garante que o script continua sem `supabase link`, sem `db push`, sem exclusões destrutivas e com `-Apply` explícito para qualquer gravação remota.
