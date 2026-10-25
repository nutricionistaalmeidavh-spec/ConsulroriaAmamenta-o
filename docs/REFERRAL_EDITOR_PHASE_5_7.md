# Encaminhamentos: fases 5, 6 e 7

Base: branch `feat/referral-editor-premium-pdf-phase-3-4` (PR #122). Esta entrega é PR empilhada, isolada da `main`, e depende das PRs #121 e #122.

## 5 — Pré-visualização e revisão
- Botão **Pré-visualizar PDF** gera o PDF oficial com os valores **atuais, ainda não salvos**, do editor; não grava, finaliza nem compartilha dados.
- A prévia abre em painel responsivo, com botão para voltar e alternativa para baixar em navegadores que não exibam PDF embutido. O Blob URL é liberado ao fechar.
- Revisão determinística detecta instruções do template como `[Descreva ...]`; impede a finalização até corrigir. Seções vazias ou sem título produzem avisos explícitos com confirmação. Nenhuma IA, conteúdo clínico inventado ou serviço pago.

## 6 — Persistência e imutabilidade
- O rascunho preserva `clinical_documents.content.html` (schema 1) com a estrutura semântica H2/H3/HR e os campos escolhidos pela profissional. Dados ausentes não são preenchidos automaticamente.
- Ao finalizar, o sistema registra `content.issued_snapshot` com HTML, especialidade, destino e data de emissão. O PDF oficial é produzido dos dados persistidos confirmados, e não da cópia transitória do formulário.
- O editor de documentos finalizados permanece somente leitura. **Proteção no servidor** rejeita PATCH, DELETE e upsert conflitante em encaminhamento finalizado (HTTP 409), mesmo fora do navegador. Os outros tipos de documentos preservam as regras preexistentes.
- Nenhuma migration D1, alteração de secrets/auth ou mudanças em Wrangler.

## 7 — QA e evidências
- Workflow `validate-referral-editor-phase57.yml`: syntax/Node, testes das fases anteriores, testes de revisão e guardas do servidor, build da aplicação, PDF fictício renderizado, Playwright do fluxo completo (prévia → rascunho → reabertura → advertência → finalização → reabertura), tentativa de PATCH e DELETE em registro finalizado.
- Imagens de QA, PDF e relatórios em artifact da Action por 14 dias.
- **Definition of Done:** PR com todos os gates relevantes aprovados, prints e PDF conferidos, compatível com a PR #122, sem merge automático.

## Rollback
Reverter a PR 5–7. As mudanças são aditivas e o formato histórico `content.html` é preservado. O `issued_snapshot` é um campo JSON opcional que não obriga migração nem modifica documentos antigos.
