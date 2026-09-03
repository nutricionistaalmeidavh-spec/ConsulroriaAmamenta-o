# UX-CONTRACT — Fluxo clínico

## Fonte de identidade
`mother_id`, `baby_id(s)`, `appointment_id` e `encounter_id` persistidos no Supabase são a única identidade clínica. `sessionStorage`, `localStorage`, datasets auxiliares e caches visuais não podem escolher paciente, bebê ou prontuário.

## Novo atendimento
1. A profissional abre Novo atendimento.
2. Seleciona paciente e bebê(s).
3. Ao avançar do primeiro passo, o frontend chama `start_clinical_encounter`.
4. A RPC cria `appointments` + `clinical_encounters` na mesma transação e retorna `appointment_id` + `encounter_id`.
5. O frontend fixa esses IDs e bloqueia alteração da identidade durante o atendimento.
6. Autosave atualiza o mesmo `clinical_encounters.id`.
7. Finalização atualiza o mesmo appointment e o mesmo encounter; nunca cria um segundo prontuário.

## Prontuário
- Só abre com `encounter_id` persistido.
- O texto livre é salvo em `clinical_encounters.clinical_note`.
- Alterações posteriores geram `clinical_note_revisions`.
- Gêmeos são resolvidos por `clinical_encounter_babies` e validados contra a mesma mãe/profissional.
- A ficha da mãe/bebê lista prontuários reais e cada card carrega um ID exato.

## Estados de interação
- Carregando: botão mantém dimensões e usa `aria-busy` quando aplicável.
- Salvando: status fica visível no prontuário.
- Sucesso: toast curto; informação durável continua na própria tela.
- Erro: mensagem explica o que falhou e mantém o conteúdo digitado no campo.
- Sem registros: card de prontuários mostra estado vazio, sem inventar um atendimento.

## Exclusões
- Paciente: modal próprio exige o nome exato.
- Atendimento/prontuário: modal próprio exige `EXCLUIR`.
- Botão destrutivo permanece separado da ação primária.
- RPC é a única via de exclusão da UI e grava auditoria no SQL.
- Escape/cancelamento não altera dados; o foco retorna ao acionador.

## Biblioteca
O módulo continua preservado no código e indisponível na navegação/rota enquanto estiver desativado.
