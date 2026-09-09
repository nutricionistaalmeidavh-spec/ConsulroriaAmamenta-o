# Fases 7–8 — Matriz de regressão e verificação integrada

## Objetivo

Fechar o roadmap clínico sem criar uma nova fonte de verdade nem substituir os módulos já entregues nas Fases 0–6.

## Fase 7 — Matriz de regressão

A suíte `tests/clinical-source-phases-7-8.test.mjs` cobre:

- wizard canônico único com 7 etapas;
- Consulta inicial, Retorno, Acompanhamento e Pré-natal;
- registros atuais `feeding_assessment.byBaby` e registros legados de um bebê;
- histórico longitudinal e comparação objetiva por bebê;
- prontuário livre, adendos e revisões;
- plano de cuidado estruturado preservando `care_plan`;
- allowlist da Área da Mãe e bloqueio fail-closed de conteúdo profissional;
- encaminhamentos, finalização/PDF, exportação e hub de registros.

## Fase 8 — Verificação integrada

A mesma suíte valida de forma cruzada:

- ordem e unicidade dos loaders nas entradas `/` e `/app/`;
- coexistência de avaliação da mamada, plano de cuidado e resumo seguro para a mãe no mesmo atendimento;
- ausência de vazamento de queixa, avaliações ou mamada para o resumo da mãe;
- `encounter-form.js` permanece responsável pelo payload clínico canônico;
- módulos aditivos de histórico e fluxo clínico não criam uma segunda gravação de `clinical_encounters`.

## Gate de merge

A PR só pode ser integrada quando o workflow `Validate clinical source consolidation` concluir com sucesso, incluindo:

1. `node --test tests/clinical-source-*.test.mjs`
2. roteamento canônico multicliente
3. regressões comercial/SaaS
4. contrato Cloudflare/Asaas
5. syntax check do Worker
6. build de produção
7. verificação de publicação do runtime canônico

Nenhuma migration de banco ou alteração de schema faz parte das Fases 7–8.
