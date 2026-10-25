# Encaminhamentos — fases 3 e 4

## Escopo e base canônica

Base da implementação: PR #121, `feat/referral-editor-phase-0-2`; trabalho em branch independente `feat/referral-editor-premium-pdf-phase-3-4` (PR #122). Sem alterações em `main`, auth, secrets, migrations, banco, Cloudflare ou Wrangler.

### Fase 3 — Organização dos cards

No editor de encaminhamentos, cada `<h2>` abre um card com título livre; novo `<h2>` encerra o card anterior e `<hr>` encerra-o explicitamente. `<h3>` cria subtítulo. O controle acessível permite inserir um card com título definido pela consultora, selecionar, mover para cima/baixo e excluir mediante confirmação.

A ordem é guardada pelo HTML já existente em `clinical_documents.content.html`, sem nova tabela, sem IDs artificiais e sem perda dos links mãe/bebê/atendimento. Os dados inseridos são apenas os selecionados nas fases 0–2. Nenhuma informação clínica é produzida por IA.

### Fase 4 — PDF premium

`createReferralPdf` continua síncrono e mantém o contrato público. O renderer agora lê `P`, `H2`, `H3`, `LI`, `HR` e texto livre, em sequência, e gera o layout premium apenas para encaminhamentos. Inclui o traçado vetorial extraído da **logo oficial** (`public/icon.svg`), lilás `#C4A3D4`, rosa `#F3BFD1`, fundo claro, faixa de seção roxa, cabeçalho e rodapé repetidos e paginação.

Sem assinatura impressa gerada pelo sistema e sem injetar identificação da mãe/bebê no PDF, salvo quando tiver sido expressamente inserida pela consultora no corpo do documento. Especialidade, destino (se preenchido) e data de emissão são metadados do cabeçalho. Documentos antigos continuam disponíveis, com seu HTML original preservado.

Outras exportações do módulo de documentos não recebem a renderização premium; não há dependências pagas. Modelo de exemplo e render em PNG são produzidos pelo GitHub Actions com nomes 100% fictícios.

## Gate, QA e rollback

- Testes: `node --test tests/referral-editor-phase02.test.mjs tests/referral-editor-phase34.test.mjs tests/phase35-contracts.test.mjs tests/phase68-contracts.test.mjs`
- `npm run build`; Playwright do fluxo local de cadastro, criação, rearranjo e reabertura.
- PDF de exemplo renderizado com PyMuPDF em Actions; verificar conteúdo, quebras, caracteres e logotipo.
- Rollback consiste em reverter esta PR, mantendo a base das fases 0–2 intacta; sem migration necessária.

A pré-visualização do PDF no editor, revisão de preenchimentos incompletos e regras de finalização são parte da **fase 5**, não desta entrega.
