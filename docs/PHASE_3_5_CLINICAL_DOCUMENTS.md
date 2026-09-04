# Entregas 3–5 — Álbum clínico e Encaminhamentos

Base herdada das fases 0–2: `8764714570948e564e300963ac08a5f7ec6798ad`.
Branch: `feature/clinical-documents-phase-3-5`.

## Correção preventiva da fundação documental

A inspeção do Supabase mostrou que já existe uma tabela `public.document_templates` usada por outra parte do produto. Como a migration das fases 0–2 ainda não foi aplicada em produção, ela foi corrigida antes de qualquer deploy para usar `public.clinical_document_templates`, evitando colisão e sem tocar na tabela existente.

## Fase 3 — Álbum clínico

- Nova tabela aditiva `clinical_media` como índice clínico de arquivos do bucket privado `clinical-media`.
- Vínculos opcionais com `baby_id`, `appointment_id` e `encounter_id`, sempre validados contra a mesma mãe e `owner_id`.
- O arquivo continua no Storage; o SQL é a fonte de contexto clínico do álbum.
- Upload exige consentimento `clinical_media` ativo.
- O caminho do arquivo começa por `owner_id/`, compatível com as policies de Storage já existentes.
- Galeria por data, categoria e bebê, sem usar `localStorage` como fonte clínica.
- Categorias iniciais: Mama, Pega, Posição, Bebê, Língua/oral, Lesão, Evolução, Documento e Outro.

## Fase 4 — Encaminhamentos e modelos por especialidade

Modelos iniciais incorporados ao frontend, sem semear dados clínicos:

- Pediatria
- Fonoaudiologia
- Ginecologia e Obstetrícia
- Mastologia
- Fisioterapia
- Osteopatia
- Psicologia
- Psiquiatria
- Clínica Geral
- Odontologia/Odontopediatria
- Nutrição
- Outro

A ficha da paciente recebe uma área de Encaminhamentos. Nesta fase, os registros são rascunhos em `clinical_documents` com `document_type='referral'`.

## Fase 5 — Editor e pré-preenchimento

O editor:

- parte do modelo escolhido;
- preenche nome da mãe, bebê, idade, peso atual registrado, queixa e resumo do plano quando esses dados existem;
- usa o atendimento persistido mais recente do bebê selecionado;
- mantém `mother_id`, `baby_id`, `appointment_id` e `encounter_id` explícitos no rascunho;
- oferece apenas negrito, itálico, sublinhado e listas;
- sanitiza o HTML antes de salvar;
- não finaliza nem gera PDF nesta fase.

A profissional deve revisar o texto antes de salvar. O sistema não inventa achados clínicos ausentes.

## Fora do escopo destas três fases

- Finalização do encaminhamento.
- Histórico/timeline documental definitivo.
- PDF e compartilhamento do encaminhamento.
- Exportação completa do prontuário.

Esses itens permanecem para a fase 6 e posteriores.

## Deploy e rollback

Nenhuma migration desta branch deve ser aplicada em produção antes do merge/homologação.
O frontend permanece aditivo: remover `/phase35-loader.js` de `index.html` desativa as fases 3–5 sem alterar Agenda, financeiro, pacotes, curvas, follow-up ou prontuário existente.
