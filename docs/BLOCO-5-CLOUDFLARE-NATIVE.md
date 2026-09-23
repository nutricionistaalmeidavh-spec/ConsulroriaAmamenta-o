# Bloco 5: bootstrap e recuperação Cloudflare-native

## Auditoria dos Blocos 1–4

Base conferida: main `d1c9a773e52fe90ea24c7c5292729e177f2f2b7f`, merge da PR #56, título confirmado pela API GitHub. Worktree separado preservou a auditoria local anterior. Histórico inspecionado: `446698c` (D1 auth), `a722860` (persistência/growth), `018659b` (single-flight), `9f0b448` (higiene), `d1c9a77` (frontend). Não foram encontradas alterações posteriores na consulta inicial.

O roadmap completo de dez blocos não está nos documentos versionados consultados; a busca GitHub por roadmap não retornou resultados. Este trabalho segue o escopo explícito do Bloco 5 fornecido pelo usuário. Não se afirma ter validado o documento completo ausente.

Baseline antes das alterações: 156 testes Node passaram; auth-runtime, cloudflare-regressions, recuperação comercial, SaaS foundation e build passaram. A recuperação comercial anterior tinha apenas contrato estático que exigia as rotas antigas, sem backend D1 implementado.

Confirmados no código/testes: login/refresh/identificação D1; bloqueios fail-closed; criação atômica de pacientes e IDs novos; colisão de ownership protegida; merge de upsert preservando valores recebidos; growth em runtime D1 dedicado; single-flight/replay único; overlays e source materializado Cloudflare. A nomenclatura antiga persistia em recovery/sandbox comercial e o bootstrap ainda tinha fallback para arquivos compactados antigos.

Regressão reproduzida adicional: promises retornadas sem await escapavam do catch dos dispatchers auth/clínico. Corrigido com await e teste de indisponibilidade D1, sem alterar as regras clínicas.

## Recovery

- `POST /api/auth/recovery` recebe `{email}`.
- `POST /api/auth/reset-password` recebe `{token,password}`.
- 32 bytes aleatórios no backend; D1 guarda somente SHA-256 do token; validade 30 minutos; no máximo uma emissão por conta por minuto; novo token substitui o anterior.
- Link usa origem administrativamente configurada, nunca redirect enviado pelo cliente. Token no fragmento, removido do endereço pelo frontend.
- Redefinição e consumo são atômicos em D1 batch. Uma segunda tentativa não troca a senha. PBKDF2-SHA256 com os mesmos 100000 ciclos do auth existente. Revoga refresh tokens; exige novo login.
- Resposta 202 uniforme para endereço existente/desconhecido. Não afirma que e-mail foi enviado. Sem transporte configurado, 503 uniforme. Falha de entrega descarta o token e emite log sem destinatário/token.
- Nenhum provider pago ou fallback de rede adicionado.

### Configuração pendente, sem execução em produção

1. Aplicar **apenas** `cloudflare/migrations/0005-auth-recovery.sql`, após revisão/autorização. É aditiva, cria uma tabela; não usar full-migration-schema ou reimportar pacientes.
2. Definir `AUTH_RECOVERY_ORIGIN` como origem HTTPS pública autorizada.
3. Configurar service binding privado `AUTH_RECOVERY_DELIVERY` para um transporte gratuito/self-hosted escolhido pelo operador. Contrato: POST interno `/send`, JSON `{to,recoveryUrl,expiresInSeconds}`, resposta 2xx somente se a entrega foi aceita; caso contrário erro não-2xx. Não registrar links/tokens. Não há endpoint público de leitura de tokens.

Busca de infraestrutura: wrangler, worker e scripts não declaram SMTP/provider/Cloudflare Email para recovery. A documentação histórica remete ao SMTP do Supabase; isso não constitui transporte independente reutilizável. O binding é uma interface, não um serviço implantado. A caixa de mensagens dos E2E existe apenas no servidor local de testes.

## Bootstrap e cache

Bridge de fetch apagado dos dois entrypoints e do código. Removidos rewrite, origem antiga e fallback para ZIPs de runtime clínico: source canônico indisponível interrompe inicialização. Transferência comercial/clínica de sessão preservada, incluindo persistência usada pelo cliente. Primeira instalação do SW não dispara reload automático; atualização de controlador existente continua recarregando.

Revisão SW `1.14.0-cloudflare-native`; remove caches antigos da própria aplicação, revalida assets na rede e só usa o cache atual no offline. Respostas privadas não são armazenadas. Remove precache dos arquivos clínicos legados e bypass Supabase. Materialização não restaura config antiga.

## Compatibilidade e riscos restantes

`/auth/v1`, `/rest/v1`, `/storage/v1`, nome supabase-client.js e tabelas históricas continuam por compatibilidade local. Worker/core e runtime clínico legado ainda contêm código histórico; não foram reescritos nem declarados completamente eliminados. Os guardrails de autenticação cobrem os caminhos ativos migrados, não uma certificação universal de todas as rotas do core.

Tokens de acesso já emitidos conservam TTL de uma hora; reset revoga refresh tokens, mas não muda o modelo atual de JWT stateless. Há cooldown por conta para delivery; limitação global/IP de abuso não foi adicionada. Produção, transporte real e entrega de e-mail não foram testados.

Próximo bloco recomendado (sujeito ao roadmap original ausente): auditar e remover código de fallback ainda presente no worker/core e compatibilidade clínica, com inventário de rotas/callers e testes D1/R2 fail-closed; manter os contratos internos necessários, sem reimportar dados.

## Verificação local

- `node --test worker/*.test.mjs tests/*.test.mjs`: baseline 156; final 162 passaram (inclui integração D1 real local).
- `npm run test:auth-runtime`, `npm run test:cloudflare-regressions`, `npm run test:frontend-cutover`, `npm run test:demo`: passaram.
- `node scripts/test-commercial-auth-recovery.mjs`, `node scripts/test-saas-foundation.mjs`, `node scripts/test-canonical-app-routing.mjs`: passaram.
- `npm run build`: passou; guardrail verifica dist/assets e configurações geradas. Arquivos growth/ícones gerados durante build não entram como alterações não relacionadas no commit.
- `node --check` nos arquivos JS/MJS de src/worker/public/tests/scripts: passou.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/chromium npx playwright test`: 2 E2E passaram contra Worker Miniflare e D1/R2 em memória. Login → cadastro → edição → reload → logout; recovery comercial → link gerado no backend → reset → login com nova senha → senha antiga/token usado recusados.
- `node --test tests/cloudflare-recovery-d1.test.mjs`: duas redefinições concorrentes sobre o mesmo token no D1 local; exatamente uma aceita, somente a senha vencedora autentica.

Para reproduzir: Node 22.13+ (node:sqlite) ou Node 24; `npm install`; `npx playwright install chromium`; `npm run test:block5`; `npm run test:e2e`. Neste ambiente o download padrão do Chromium foi truncado; usou-se Chromium 143 local via variável de ambiente. Não é dependência de produção.

Nenhum deploy, merge, alteração em D1 remoto, reimportação de pacientes ou e-mail real foi realizado.

## Arquivos alterados

- `.github/workflows/validate-saas-foundation.yml`
- `app/index.html`
- `cloudflare/migrations/0005-auth-recovery.sql`
- `cloudflare/runtime-schema.sql`
- `docs/BLOCO-5-CLOUDFLARE-NATIVE.md`
- `index.html`
- `package.json`
- `playwright.config.mjs`
- `public/clinical-source/core/app-shell.js`
- `public/clinical-source/manifest.json`
- `public/comercial/auth-recovery.js`
- `public/comercial/index.html`
- `public/comercial/sandbox-teste.js`
- `public/sw.js`
- `scripts/materialize-clinical-source.mjs`
- `scripts/test-canonical-app-routing.mjs`
- `scripts/test-cloudflare-runtime.mjs`
- `scripts/test-commercial-auth-recovery.mjs`
- `src/bootstrap.js`
- `src/cloudflare-fetch-bridge.js`
- `tests/block-1-2-hygiene.test.mjs`
- `tests/clinical-source-app-runtime-ui.test.mjs`
- `tests/clinical-source-bootstrap-canonical.test.mjs`
- `tests/clinical-source-consolidation.test.mjs`
- `tests/cloudflare-async-errors.test.mjs`
- `tests/cloudflare-functional-regressions.test.mjs`
- `tests/cloudflare-native-bootstrap.test.mjs`
- `tests/cloudflare-password-recovery.test.mjs`
- `tests/cloudflare-recovery-d1.test.mjs`
- `tests/e2e/clinical.spec.mjs`
- `tests/e2e/recovery.spec.mjs`
- `tests/e2e/server.mjs`
- `tests/helpers/cloudflare-local.mjs`
- `tests/patient-ui-integrity.test.mjs`
- `tests/service-worker-update.test.mjs`
- `worker/cloudflare-auth-runtime.js`
- `worker/cloudflare-clinical-legacy-runtime.js`
