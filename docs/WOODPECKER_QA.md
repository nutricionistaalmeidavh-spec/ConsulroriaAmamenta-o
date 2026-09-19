# Woodpecker + ArtiSys CI Reporter — Débora Lactação

Pipeline: `.woodpecker/debora-lactacao.yaml`.

Em push na `main` ou execução manual, o Agent Windows executa instalação limpa, `test:seo`, build e somente então deploy Cloudflare. Falhas interrompem a publicação.

O resultado é normalizado em `artifacts/woodpecker-ci-report.json` e enviado pelo módulo compartilhado `utilidades/modules/artisys-ci-reporter` com contexto `ci/woodpecker/debora-lactacao`.

O Agent deve expor `ARTISYS_UTILIDADES_PATH` (o pipeline usa o clone compartilhado atual) e `GITHUB_REPORT_TOKEN`. O token precisa de acesso a este repositório para Commit statuses (write); PR write só é necessário se comentários em PR forem habilitados.

O deploy usa Wrangler e as credenciais Cloudflare já configuradas no Agent. Nenhum segredo é versionado no repositório.

Fluxo: push main -> Woodpecker -> deps -> test:seo -> build -> deploy Cloudflare -> reporter GitHub.
