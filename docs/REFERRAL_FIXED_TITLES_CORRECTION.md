# Correção dos encaminhamentos — títulos do modelo

## Diagnóstico
O modelo existente `public/referral-templates.js` **já continha as seções clínicas** (Queixa(s) em acompanhamento; Motivo do encaminhamento; Resumo do caso e condutas já realizadas e, quando presente, Informação antropométrica pertinente). Porém seus títulos eram texto em negrito dentro de `<p>`, enquanto o novo PDF só reconhecia `<h2>`. O editor avançado foi adicionado sem necessidade.

## Alteração
- O novo encaminhamento abre com os três títulos fixos do modelo e corpo clínico vazio, sem preencher dados sensíveis automaticamente. Pré-preenchimento de texto existente é opcional.
- Os títulos são protegidos contra edição direta no editor; os parágrafos continuam livremente editáveis e permitem selecionar informações já registradas.
- Retirados seletor de tipo de bloco, botão de encerrar seção, criação/reordenação/exclusão de cards e CSS do organizador. Mantida a formatação simples de texto.
- Para rascunhos históricos, `normalizeReferralHeadings` reconhece **somente** os títulos fixos dentro de `<p><strong>TÍTULO:</strong><br>texto</p>` e os converte para visualização sem alterar o registro existente. O gerador de PDF usa a mesma normalização.
- H2/H3 de documentos antigos criados com a versão anterior continuam preservados na exportação e na reabertura. Nenhuma migração.
- Cabeçalho, rodapé, logo oficial, paleta lilás/rosa, paginação, prévia e congelamento de registros finalizados permanecem.

## Testes e rollback
Testes Node validam os títulos e a conversão conservadora; Playwright verifica ausência do editor avançado, seleção de dados, persistência e finalização; PDF fictício é renderizado. Rollback reverte apenas a PR, sem alterações no D1, APIs, secrets ou Wrangler.
