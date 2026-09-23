# Correções de estabilidade após o Bloco 10

Base conferida: merge PR #63, `e9e3d1ad9e20ae3147087811e69fa253a57a0762`.
Branch: `fix/post-migration-stability`.

## Falhas corrigidas e evidências

| Falha | Correção | Evidência |
| --- | --- | --- |
| Carga inicial apagava formulário | Aplicação só libera edição depois de carregar dados e renderizar a rota; falha permite nova tentativa | Teste RED/GREEN de inicialização e E2E com consultas suspensas |
| Reload restaurava sessão antiga | Sessão persistente é autoritativa; handoff comercial explícito grava a sessão nova antes de navegar; refresh/logout sincronizam aliases | Teste com sessão comercial revogada e sessão clínica renovada; teste de logout durante refresh |
| Falha temporária apagava sessão | Apenas rejeição de credenciais invalida a sessão; 503/429/offline preservam credenciais, sem replay da escrita | Testes 503, 429, offline e regressões de single-flight/replay único |
| Cadastro duplicado em reenvio | Bloqueio de submit simultâneo e Idempotency-Key preservada para mesma tentativa; sucesso antes de falha visual converte próxima tentativa em edição | E2E aborta resposta após persistência, reenvia e confirma apenas uma paciente |
| Edição parcial | PATCH /api/clinical/patients grava mãe, bebês, consentimentos e idempotência em um batch D1 | D1 local: trigger injeta erro tardio; tudo sofre rollback; testes de ownership, consentimentos migrados e concorrência |
| Recovery consumia token antes de salvar | Todas as escritas e consumo ficam no mesmo batch, consultando o token dentro da transação | D1 local: dois resets concorrentes têm um vencedor; falha tardia preserva senha, sessão e token; retry funciona |

O E2E comercial e um contrato de identidade ainda usavam rotas removidas no Bloco 10; foram atualizados para `/api/auth`. SW passa a revisão `1.14.1-stability`.

## Verificação

- Baseline: 196 testes passando, um ignorado por ausência de dist.
- `npm run build`: passou.
- `node --test worker/*.test.mjs tests/*.test.mjs` após build: **209 passaram**, nenhum ignorado.
- `npm run test:auth-runtime`, `npm run test:cloudflare-regressions`, `npm run test:frontend-cutover`: passaram.
- Contratos `test-commercial-auth-recovery.mjs`, `test-saas-foundation.mjs`, `test-canonical-app-routing.mjs`: passaram após materialização.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/chromium node node_modules/@playwright/test/cli.js test`: **4 E2E passaram**; Worker local com D1/R2 em memória e dados sintéticos.
- `node --check`: 178 arquivos JS/MJS passaram; `git diff --check` passou.
- Novo comando `npm run test:stability` incluído no workflow de validação SaaS.

Os assets são materializados por `npm run build`/`npm run dev`. Arquivos gerados não relacionados (incluindo ícones e growth) não fazem parte das correções autorais.

## Limites

Publicação e merge foram autorizados pelo usuário após a validação local. Não foram executados deploy, migração remota nem acesso a pacientes reais. A validação é local, não uma afirmação sobre produção.

Edições simultâneas distintas continuam last-write-wins: controle de versão otimista e coordenação de refresh entre múltiplas abas não foram adicionados. A chave de reenvio do formulário é mantida durante a tentativa na mesma página; não é persistência de rascunho clínico após fechar/recarregar a página. Nenhuma garantia de ausência universal de bugs é feita.
