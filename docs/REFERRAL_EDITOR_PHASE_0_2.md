# Editor de encaminhamentos — fases 0, 1 e 2

## Fase 0: inventário e compatibilidade

- Interface e modelo: `public/referrals-feature.js` e `public/referral-templates.js`.
- Campo canônico: `clinical_documents.content.html` (HTML sanitizado em `schema_version: 1`). Links `mother_id`, `baby_id`, `encounter_id` e `appointment_id` permanecem.
- Persistência: `window.DeboraDocuments.saveDocument/updateDocument/listDocuments`, sem endpoints, migration, changes in D1, Secrets, autorização ou R2.
- Finalização: `public/referral-finalization.js` permanece intocada; documentos já finalizados continuam somente leitura e exportáveis.
- PDF: `public/document-pdf-service.js` permanece intocado nesta entrega. Ele ainda produz o PDF legado sem cards visuais; o layout premium será objeto das fases 3–4.
- O modelo de pré-preenchimento pré-existente continua editável para preservar contratos de versões anteriores. A inserção **adicional** de dados passa a ser totalmente opcional e explícita.

## Fase 1: estrutura semântica

O editor possui os formatos **Texto normal (P)**, **Título de seção (H2)** e **Subtítulo (H3)**, além do botão **Encerrar seção (HR)**. Um novo H2 fecha implicitamente a seção anterior; o HR encerra explicitamente a seção e insere um novo parágrafo. Os marcadores são HTML semântico, não textos literais `[INÍCIO]` ou `[FIM]`.

O sanitizador existente mantém sua lista de elementos seguros, agora com `H2`, `H3` e `HR`. Nenhum atributo de estilo, classe ou execução é persistido. A versão de schema permanece `1`, preservando leituras de documentos antigos.

## Fase 2: escolher e inserir dados

O novo seletor obtém candidatos somente de `patientContext(motherId)` e `latestEncounter(motherId,babyId)`, já protegidos pelo backend. As opções disponíveis apresentam apenas valores realmente armazenados, agrupados por **Mãe**, **Bebê** e **Atendimento**. Dados ausentes não aparecem, não são inventados e não são inseridos automaticamente pelo seletor.

A consultora posiciona o cursor, escolhe o dado e usa **+ Inserir dado**. O valor é inserido como texto comum e revisável (snapshot), sem adicionar novos links dinâmicos ou persistir dados secretos no cliente. O nome da mãe e o bebê correto permanecem vinculados pelos IDs já existentes.

## Limites e próximos passos

- A reformulação visual do PDF, seleção de campos por modelos, pré-visualização e alertas de placeholders são fases posteriores.
- Documentos legados continuam em HTML e não são reescritos na abertura.
- Não alterar `wrangler`, auth, secrets, deploy, tokens ou tabelas.
- Rollback: reverter os commits exclusivos desta branch e eliminar `public/referral-editor-structure.js`; nenhuma migration ou transformação de registros é necessária.
- QA: `node --test tests/referral-editor-phase02.test.mjs tests/phase35-contracts.test.mjs tests/phase68-contracts.test.mjs` seguido de `npm run build` na Action. Merge apenas depois da aprovação.
