# Assistente de Amamentação — Backend, proteção clínica e base científica (fases 1–3)

## Dependência e isolamento
Branch: `feat/mother-ai-zero-spend-foundation`, baseada na branch da PR #106 (`feat/mother-portal-public-readiness`). Não integrar à `main` antes de autenticação materna, vínculo verificado por e-mail e isolamento de `owner_id/mother_id` da PR #106 terem sido aprovados. Nenhum dado do prontuário, bebê ou documentos privados é enviado à IA nesta fase.

## Infraestrutura existente
- Worker atual: endpoint `POST /api/member/ai/chat`.
- Autenticação Bearer com o mecanismo D1 já canônico; busca do vínculo no D1 a partir de `member_user_id`. `owner_id`, `mother_id` e `member_verified_at` são lidos apenas no servidor.
- Migração SQL aditiva `cloudflare/migrations/0014-mother-ai-budget.sql`, executada pelo mesmo fluxo de migrações existente (nenhum Wrangler JSON, secret, rota existente ou banco novo alterado).
- Não há frontend de chat nesta fase: a fase 5 cobrirá a interface e o consentimento visual da mãe.
- Não há histórico persistente, mensagens nem dados clínicos sensíveis salvos no D1.

## ZERO consumo de serviços AI por padrão
- `MOTHER_PORTAL_ENABLED`: ausente/falso por padrão; guarda a Área das Mães.
- `MOTHER_AI_ENABLED`: ausente/falso por padrão; API retorna 403 sem executar modelo.
- `MOTHER_AI_ALLOW_INFERENCE`: ausente/falso por padrão; mesmo com IA habilitada, apresenta somente referências oficiais locais.
- `MOTHER_AI_GLOBAL_DAILY_LIMIT`: ausente = 0. `0` bloqueia toda inferência.
- `MOTHER_AI_OWNER_DAILY_LIMIT`: ausente = 0, requer opt-in por consultora.
- `MOTHER_AI_MOTHER_DAILY_LIMIT`: ausente = 0, requer opt-in por mãe.
- **Teto máximo no código: 4 inferências por dia UTC em toda a aplicação**, mesmo quando um valor maior é informado. Reservas D1 são atômicas e não reembolsáveis, prevenindo cobrança por retries e concorrência.
- Modelo reservado para futura habilitação: `@cf/meta/llama-3.1-8b-instruct-fp8-fast`, resposta limitada a 240 tokens; mensagens no máximo 500 caracteres.
- **Não foi adicionado binding `AI` ao Wrangler, nem configuradas chaves ou provedores pagos**.
- **Sem consultas a Cloudflare AI Search, Vectorize, embeddings, AI Gateway, R2 para documentos RAG ou provedores externos**. A base inicial usa uma busca lexical local em 4 páginas oficiais, sem custos adicionais de IA.
- Mesmo com o teto baixo, **Cloudflare Workers Paid cobra uso acima do saldo gratuito da conta inteira**; nenhum limitador interno conhece o consumo de outros Workers/contas no mesmo plano. Não habilitar `MOTHER_AI_ALLOW_INFERENCE` em Workers Paid sem configuração adicional de controle de custo no provedor. A garantia de nenhuma chamada de inferência desta branch é mantê-la desativada (valor padrão).

## Segurança clínica
1. Sinais de possível urgência (ex.: bebê sem respirar ou convulsão) recebem mensagem padronizada de procurar emergência/192, sem consulta ao modelo e sem consumo da quota.
2. Questões sobre doses, medicamentos, sinais clínicos importantes ou ganho de peso recebem orientação para avaliação profissional, sem diagnóstico nem prescrição pela IA.
3. Fora dessas situações, somente fontes oficiais marcadas no catálogo podem ser selecionadas; perguntas sem cobertura não são enviadas ao modelo.
4. O texto enviado ao modelo inclui apenas a pergunta consentida e pequenos resumos de fontes públicas, nunca prontuário nem informações pessoais vindas do servidor.
5. Uso do modelo exige `consent_to_ai_processing:true` enviado pela mãe em cada pergunta, e é negado com HTTP 412 sem esse consentimento.
6. Respostas suspeitas de posologia/diagnóstico assertivo são substituídas por orientação de atendimento e nunca exibidas como recomendação clínica.

A lista contém referências do Ministério da Saúde e da OMS verificadas quanto à origem. **A liberação clínica do chatbot ainda exige revisão de uma consultora responsável**; não atribuir certificação profissional aos resumos do catálogo antes dessa revisão.

## Estados do endpoint
- 403: portal ou assistente indisponível; sem IA.
- 401: sessão inválida; sem IA.
- 403: vínculo verificado da mãe inexistente/revogado/ambíguo; sem IA.
- 200 `urgent` ou `clinical`: orientação de procurar atendimento; sem IA.
- 200 `out_of_scope`: sem fonte adequada; sem IA.
- 200 `reference_only`: referências com links; sem IA.
- 412: consentimento requerido; sem IA.
- 429: teto esgotado; sem IA, sem retry automático.
- 503: falha no orçamento D1 ou provedor; nenhum retry automático; consulta clínica convencional não afetada.
- 200 `educational`: resposta educativa com links verificáveis (somente em fase de testes autorizados da IA).

## Testes
`npm run test:mother-ai`: testes com D1 SQLite real para isolamento de mães, convite não verificado, urgências, nenhuma cobrança por padrão, teto de concorrência e catálogo. Workflow `validate-mother-ai.yml` executa também `npm run test:block6`.

## Checklist de liberação futura
- CI verde e revisão de risco por consultora; simulações clínicas e ataques de prompt injection.
- Validação da configuração de plano e limites globais de todos os sistemas da mesma conta Cloudflare.
- Migração 0013 aplicada antes de qualquer habilitação.
- UI com consentimento e identidade de IA explícitos; política de privacidade e retenção.
- Nenhuma ativação automática via branch, PR, CI ou deploy.
