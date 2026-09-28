# Correções do fluxo de novo cliente — 28/09/2026

Implementação local concluída sobre main `5a2c42a656e156caf58289aee7cf8e32b7eac248`. Sem commit, push, deploy ou cobrança real.

## Comportamento corrigido

- Cadastro gratuito reutiliza a identidade de uma compra Pro pendente somente após validar a senha; não cria outra identidade para o mesmo cliente.
- Benefício previamente concedido por e-mail exige prova de posse da caixa postal pelo fluxo de recuperação, sem aceitar a senha de quem primeiro informar aquele endereço.
- Recuperação de compra pendente altera credenciais e invalida tokens de maneira transacional, inclusive quando a conta é ativada durante a recuperação.
- Conclusão do cadastro e tentativas simultâneas não geram uma segunda compra quando há pagamento ou ativação em andamento.
- A interface só anuncia Pro liberado após confirmação efetiva da Central de Licenças; pagamento e ativação são estados distintos.
- Eventos CHECKOUT são verificados no provedor; eventos interrompidos ou com falha temporária podem ser reprocessados.
- Reconciliação agendada a cada cinco minutos recupera pagamentos sem webhook. Bloqueios por cliente serializam checkout e ativação.
- Expiração local respeita a validade de 60 minutos e a confirmação do provedor antes de permitir uma nova compra.
- A página de plano consulta o estado com tentativas limitadas e preserva a sessão em falhas transitórias.
- Vigência respeita o último dia do mês e anos bissextos. Eventos mensais antigos não revogam uma renovação mais recente.
- Falha de licenciamento bloqueia operações protegidas; acesso legado só permanece liberado quando explicitamente confirmado pelo serviço.

## Evidência local

Codex Engineering Guardrails orientou regressões comportamentais, verificação integrada e separação entre teste local e prontidão de produção.

| Verificação | Resultado |
| --- | --- |
| `npm run test:billing-flow` | 48 testes aprovados, incluindo mensal/anual em Worker + D1 local |
| `npm run test:billing` | Contratos de cobrança e preços aprovados |
| `npm run test:auth-runtime` | 37 testes aprovados |
| `npm run test:cloudflare-regressions` | Aprovado |
| `npm run test:block5` | 25 aprovados; 1 teste de artefato compilado omitido na árvore sem dist |
| Scripts preconfirm-checkout, cloudflare-license-authority e commercial-auth-recovery | Aprovados |
| `npm run build` | Aprovado em cópia isolada, preservando fontes locais |

Os testes usam serviços controlados para Asaas/licenciamento e falhas injetadas; não demonstram configuração ou disponibilidade dos serviços reais. O novo workflow executará as 48 regressões quando publicado.

## Antes da publicação

1. Revisar e publicar as alterações pelo processo normal do repositório.
2. Aplicar as migrações `0009-billing-recovery.sql` e `0010-billing-reconciliation.sql` antes do Worker. O script de cutover foi atualizado para incluí-las.
3. Conferir binding/segredo da Central de Licenças, entrega de recuperação `AUTH_RECOVERY_DELIVERY`, origem autorizada de recuperação e configuração/token do webhook Asaas.
4. Homologar mensal e anual no sandbox real: cadastro, pagamento, webhook, falha/repetição, recuperação de senha e liberação efetiva. Confirmar execução do cron e acompanhar `billing_reconciliation_schedule.last_error`.
5. Identidades históricas já divergentes para um mesmo e-mail exigem análise e remediação manual; não foram mescladas automaticamente.

Nenhuma dependência paga nova foi adicionada. Produção e dados de clientes não foram alterados.

## Pendências consolidadas após revisão de observabilidade

Relatório recebido: `achados_observabilidade_logins_debora_codex(1).txt`. Revisão estática na cópia local em 28/09/2026; sem confirmação do estado remoto atual ou reprodução no navegador nesta rodada. Este complemento registra trabalho pendente, não correções implementadas.

### Confirmado no código local

- `public/usage-presence-runtime.js` prioriza `token || readToken()`, podendo manter token antigo após refresh; não verifica a resposta HTTP do heartbeat.
- A busca em worker, public e patch-source encontrou consumidores de `canonical-auth-session`, mas nenhum emissor. A integração após login/refresh precisa ser reproduzida e corrigida.
- `auth_users.last_sign_in_at` e `user_sessions` são fontes distintas. Não foi encontrada tabela de histórico de logins nas fontes de autenticação/migrações consultadas.
- A migration 0008 cria tabelas de presença/sessões sem backfill. Online usa janela de dois minutos. Ausência de sessão antiga e estado offline não provam falha de login.
- A data exata de implantação e os casos individuais descritos no relatório não foram confirmados em produção. Merge não equivale necessariamente a implantação.

### Ordem de execução

1. Manter alterações fora de produção e comparar com a main remota atual antes de integrar. Confirmar se há publicação automática configurada no painel Cloudflare, além dos workflows do repositório.
2. Reproduzir e corrigir heartbeat com token atualizado, integração login/refresh/logout e tratamento observável de 401/403/5xx. Evitar retries ilimitados, tokens nos logs ou bloqueio do uso clínico por falha de telemetria.
3. Adicionar testes de login seguido de heartbeat, troca de token A para B, criação de presença/sessão, contagem e duração, logout, erro HTTP e isolamento de falhas de telemetria frente a billing/licenças.
4. Criar histórico de login no backend após autenticação válida, com paginação, autorização interna, retenção definida e dados mínimos. Refresh não deve contar como novo login. A persistência de telemetria não deve tornar login indisponível.
5. Ajustar a Central Artisys para separar último login, última atividade, presença, histórico de logins e sessões de uso. Preservar consulta read-only e não inventar sessões históricas.
6. Executar gates de auth, observability, billing, licenças, regressões Cloudflare e build na versão integrada. O teste `worker/usage-observability-maintenance.test.mjs` ainda exige uma lista contendo apenas o cron diário, incompatível com o cron de reconciliação adicionado; atualizar o contrato e testar que a limpeza diária não roda a cada cinco minutos.
7. Homologar cadastro, mensal/anual, webhook e liberação em ambiente isolado. Só depois revisar merge, backup, migrações e plano de rollback para publicação autorizada.

### Esclarecimento sobre Sandbox

Ter rotas Asaas Sandbox não significa ter um ambiente completo isolado. A configuração base aponta para os domínios e serviço de licenças de produção. `syncCommercialLicense` ignora ambientes diferentes de production, portanto a rota Sandbox atual não comprova liberação de Pro ponta a ponta. Não remover essa proteção para testar contra a Central real. Preparar Worker, dados e licenças de homologação separados, sem chave Asaas de produção, e validar a configuração existente antes de criar ou substituir qualquer recurso remoto. Não há autorização nesta revisão para configurar recursos remotos, cobrar, migrar, publicar ou fazer merge.
