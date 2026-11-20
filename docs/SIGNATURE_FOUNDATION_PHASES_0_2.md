# Assinaturas eletrônicas — auditoria e fundação (fases 0 a 2)

**Status:** backend em branch, sem implantação; envio real bloqueado até fases 3–5.
**Escopo:** documentos que já aparecem às consultoras; não criar novos modelos nem alterar os layouts dos PDFs.
**Core:** R$ 0 em licenças adicionais, Workers + D1 + R2 existentes, sem dependência de SaaS pago.

## Fase 0: inventário confirmado no código

| Superfície/categoria existente | Origem atual | Quem poderá assinar | Cuidados |
|---|---|---|---|
| Tratamento de dados pessoais e de saúde | `public/terms-feature.js`, `consents:data_processing` | Mãe | Aceite/versão não se confundem com assinatura |
| Contato por WhatsApp | `consents:whatsapp` | Mãe | Registrar finalidade e revogação |
| Fotos, vídeos e documentos clínicos | `consents:clinical_media` | Mãe | Preservar versionamento 1.1 e histórico |
| Uso público de imagem | `consents:public_media` | Mãe | Autorização opcional e separada |
| Teleatendimento | `consents:teleconsultation` | Mãe | Identificar profissional e modalidade |
| Encaminhamento para profissional | `public/referrals-feature.js` + `public/referral-premium-pdf.js` | Consultora (futura classificação) | Não incluir neste MVP sem validar modalidade jurídica |
| Prontuário/exportações | `public/record-export-feature.js`, `public/document-pdf-service.js` | A definir em fase posterior | Não alterar geração, domínio, layout ou acesso |

**Integrações verificadas:**
- Identidade clínica canônica: `mothers.id`, `mothers.owner_id`; bebê é opcional e nunca define a mãe.
- E-mail materno: campo `mothers.email` no registro do D1; ausência impede preparar a solicitação.
- Consentimentos: `supabase_records` na tabela lógica `consents`; não sobrescrever aceite/revogação ao gerar PDF.
- Documentos: `clinical_documents` + cliente `public/documents-feature.js` e PDFs atuais gerados no navegador. **Não há PDF legal congelado em R2 para assinatura nesta fase.**
- Transacional: `worker/transactional-email.js`, com `EMAIL` existente e fallback já implementado. A entrega real depende de remetente/transporte previamente configurado, sem novo custo obrigatório.
- Segurança: `authenticateClinicalRequest` e bloqueio de mães em rotas profissionais `/api/clinical/` no `worker/domain-entry.js`.

## Fase 1: contrato técnico

`cloudflare/migrations/0019-signature-foundation.sql` cria **somente** tabelas novas:
`signature_requests`, `signature_participants`, `signature_documents`,
`signature_tokens`, `signature_events`, `signature_evidence`.

- Cada solicitação tem um `owner_id`, `mother_id`, tipo **fixo** de consentimento e e-mail derivado do registro persistido, nunca do payload cliente.
- Criação em transação D1 insere participantes (mãe, consultora) e evento de criação.
- Índice parcial impede solicitações abertas concorrentes do mesmo tipo para a mesma mãe e consultora.
- Criar solicitação **não** modifica `consents`, `clinical_documents`, dados do bebê ou prontuário.
- `source_snapshot_json` + `source_sha256` fotografam **o estado do registro de consentimento**, **não** um PDF assinado.
- Tokens posteriores são aleatórios de 256 bits; banco mantém apenas SHA-256; não imprimir em logs nem retornar por listagem.
- Reservar `signature_documents` para PDFs imutáveis no R2 privado e `signature_evidence` para eventos e artefatos de auditoria da fase 5.
- Não abrir leitura pública do D1/R2; APIs administrativas exigem autenticação da consultora e isolamento por `owner_id`.

### Rotas da fundação

- `POST /api/clinical/signatures/requests`: `{ "mother_id": "...", "consent_type": "whatsapp" }`, retorna rascunho; restrita a profissional.
- `GET /api/clinical/signatures/requests?mother_id=...`: listagem de solicitações da consultora e mãe.
- `POST /api/clinical/signatures/requests/:id/send`: preparado para o envio, **bloqueado por padrão** com 409 `signature_signing_not_ready`.

Nenhuma interface de assinatura, botão de envio público nem configuração de liberação é ativada nesta fase.

## Fase 2: envio por e-mail, sem envio prematuro

Adicionado tipo `signature_request` ao serviço de e-mails **existente**, com assunto, título do documento, link HTTPS individual, validade e aviso para ignorar e-mails inesperados.

O disparo só será permitido **após** ambas as flags de readiness:
- `SIGNATURE_DELIVERY_ENABLED=true`;
- `SIGNATURE_PUBLIC_FLOW_READY=true`.

Além das flags, a API requer um PDF congelado registrado em `signature_documents` e presente no R2 antes de emitir link. São condições **não atendidas** até a implementação e validação da página de assinatura nas fases 3–5.

Essa estratégia evita enviar à mãe um link que leve a página inexistente, documento não congelado ou autorização ainda sem texto jurídico completo. **Não configure as flags agora.**

Quando liberado, o fluxo tem:
1. Bloqueio transacional do envio concorrente pelo estado `sending`;
2. geração de token aleatório e armazenamento só do hash;
3. e-mail via transporte transacional já existente;
4. confirmação de `sent` e evento de auditoria;
5. revogação do token e `delivery_failed` se houver falha identificada.

**Pendente intencional:** página para ler e assinar (fase 3), assinatura da consultora (fase 4), PDF imutável e relatório de evidências (fase 5), envio real em ambiente de testes e revisão jurídica de modalidades de assinatura.

## Implantação / rollback / QA

- Alterações isoladas; **não rodar migrations em produção** nem habilitar envio antes da revisão do PR.
- Aplicar `0019-signature-foundation.sql` pelo fluxo de migrations já utilizado, antes de liberar as novas rotas.
- Testes: `node --test tests/signature-foundation.test.mjs worker/transactional-email.test.mjs`; CI existente continua valendo.
- Falhar fechado para e-mail inválido, identidade não pertencente, tipo desconhecido, link não pronto, arquivo não congelado.
- Rollback de código é seguro porque as novas tabelas não alteram as existentes; **não apagar tabelas/dados de solicitações** ao reverter o deploy.
- Encaminhamentos e documentos clínicos que exigirem assinatura avançada/qualificada deverão receber revisão jurídica específica antes da liberação.
