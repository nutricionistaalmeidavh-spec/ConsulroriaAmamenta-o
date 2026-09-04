# Entregas 0–2 — Documentos clínicos e Termos

Base congelada: `709aeae1dd27d89d007cea914a4e18de4f270571`.
Branch de trabalho: `feature/clinical-documents-phase-0-2`.

## Fase 0 — contrato de regressão

Invariantes que não podem mudar nesta entrega:

- `mother_id`, `baby_id`, `appointment_id` e `encounter_id` persistidos continuam sendo a única identidade clínica.
- Agenda, finalização de atendimento, follow-up, financeiro, pacotes, pesos/curvas e prontuário existente não recebem alteração funcional.
- O AppDeploy e o ambiente de produção não são alterados nesta entrega.
- A nova camada é carregada de forma aditiva pelo bootstrap.
- `consents` continua sendo a fonte de verdade para autorizações; PDFs são somente representações documentais.

## Fase 1 — infraestrutura documental

Arquivos novos:

- `public/documents-feature.js`: cliente documental isolado, leitura de contexto da paciente e acesso REST autenticado.
- `public/document-pdf-service.js`: gerador de PDF reutilizável, sem dependência nova.
- `public/documents-feature.css`: superfícies documentais usando os tokens atuais da Débora Lactação.
- `supabase/phase-clinical-documents-terms.sql`: criação aditiva de `document_templates` e `clinical_documents`, RLS owner-scoped e validação dos vínculos clínicos.

Nenhuma tabela existente é removida ou renomeada.

## Fase 2 — Termos

`public/terms-feature.js` adiciona na ficha da paciente a seção **Termos e autorizações**. Ela:

- lê diretamente `consents`;
- mostra status, aceite, revogação e versão;
- permite visualizar cada registro;
- gera PDF com a identidade visual da Débora Lactação;
- usa Web Share API quando disponível e download como fallback;
- ao gerar/compartilhar, tenta registrar uma cópia documental em `clinical_documents` sem mudar o consentimento original.

A alteração de consentimento continua sendo feita em **Editar cadastro**.

## Rollback

Frontend: remover a referência a `phase02-loader.js` de `index.html`.

Banco: como a migration é estritamente aditiva, o rollback de aplicação pode deixar as tabelas sem uso. Não é necessário apagar dados para restaurar o fluxo anterior.
