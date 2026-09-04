# Entregas 6–8 — Encaminhamento final, exportação e organização da ficha

Base: `4911badf244f85946d731a3ff5e5055fe850e83d` (Fases 3–5).
Branch: `feature/clinical-documents-phase-6-8`.

## Contratos preservados

- `mother_id`, `baby_id`, `appointment_id` e `encounter_id` continuam sendo os vínculos clínicos canônicos.
- Nenhuma alteração em Agenda, billing, pacotes, follow-up, curvas ou finalização do atendimento.
- Encaminhamento finalizado permanece no mesmo registro de `clinical_documents`; não é criada uma segunda cópia clínica.
- Exportação lê dados persistidos do banco. Não captura o HTML/DOM da tela como prontuário.
- Fotos ficam desmarcadas por padrão na exportação.
- Nenhum deploy, merge em `main` ou migration em produção faz parte destas fases.

## Fase 6 — Encaminhamento finalizado

- Rascunhos existentes podem ser finalizados explicitamente.
- A finalização grava `status=finalized` e `finalized_at` no mesmo documento.
- `mother_id`, `baby_id`, `appointment_id` e `encounter_id` são preservados.
- Documentos finalizados ficam somente para leitura no editor.
- PDF oficial usa identidade Débora Lactação e pode ser baixado ou compartilhado pelo Web Share API quando disponível.
- A lista da paciente diferencia **Rascunho** e **Finalizado**.

## Fase 7 — Exportar prontuário / PDF

O exportador permite:

- **Resumo clínico** ou **Prontuário completo**;
- todos os bebês ou um bebê específico;
- todo o histórico ou intervalo de datas;
- incluir/excluir anamnese, consultas/evoluções, planos de cuidados, peso/crescimento, encaminhamentos, termos e mídia clínica.

Fontes persistidas:

- `mothers`
- `babies`
- `clinical_encounters`
- `clinical_encounter_babies`
- `consents`
- `clinical_documents`
- `clinical_media`
- `weights`

O PDF é paginado. Quando **Fotos e mídia clínica** é selecionado, imagens privadas são lidas por URL assinada, convertidas localmente para JPEG e incorporadas ao final do PDF. Falhas individuais de imagem são registradas no próprio documento sem bloquear o restante da exportação.

Cada exportação tenta registrar um snapshot do ato em `clinical_documents` com `document_type=export`, sem armazenar uma segunda fonte de verdade do prontuário.

## Fase 8 — Registros e documentos

Foi criada uma camada de navegação compacta **Registros e documentos** com atalhos para:

- Termos
- Encaminhamentos
- Álbum clínico
- Exportar prontuário

Os cards funcionais já existentes continuam montados e operacionais. O hub apenas organiza o acesso; não remove nem substitui seus fluxos.

## Rollback

Remover `/phase68-loader.js` do `index.html` desativa integralmente as Fases 6–8 sem alterar as Fases 0–5. Como não há migration nova nesta rodada, não existe rollback de banco específico das Fases 6–8.
