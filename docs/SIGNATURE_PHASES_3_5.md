# Assinatura eletrônica — Fases 3–5 (mesma branch da PR #134)

## Escopo implementado

A etapa aproveita a fundação já criada nas fases 0–2 e incorpora as atualizações de termos integrais existentes na `main` antes da merge da PR. **Não altera conteúdo ou layout dos documentos originais**.

### Fase 3 — Assinatura da mãe sem login
- Página `/assinar` isolada do app com CSP e `noindex`; a URL do link é limpa assim que o JavaScript inicia.
- Token individual de 256 bits, somente SHA-256 no D1; link expira em 72h, é revogado na conclusão e não permite reutilização.
- Leitura do PDF **integral previamente congelado no R2**. Não disponibiliza acesso a prontuário, bebês ou documentos de outras mães.
- Mãe precisa indicar nome completo coincidente com o cadastro, escolher assinatura por desenho ou nome digitado e marcar duas confirmações expressas.
- PDF original permanece inalterado; assinatura cria a versão 2 com anexo de assinatura e hash de origem.
- Caso o link expire, seja revogado ou o PDF difira de seu hash, operação falha fechada.

### Fase 4 — Assinatura da consultora
- Um botão `Solicitar assinatura` foi incluído na interface existente de cada termo elegível; sem novo editor ou mudança no status de consentimento.
- A consultora gera o PDF a partir do modelo integral `getConsultantConsentDocument()` (v2.0) e do gerador canônico `createConsentPdf()` com o cabeçalho/rodapé do encaminhamento. A consultora **deve visualizar e revisar** o texto, com opção explícita de anexar PDF alternativo. A revisão jurídica desses modelos é pré-requisito para produção.
- A assinatura da mãe precede obrigatoriamente a da consultora.
- A consultora assina somente com sessão autenticada. A identidade da conta é gravada na evidência.
- A versão 3 corresponde ao PDF com as duas assinaturas.

### Fase 5 — PDF imutável e provas
- Arquivos armazenados em R2 privado, chave contendo proprietário, mãe, solicitação, versão e hash do conteúdo; dados anteriores nunca são sobrescritos.
- `pdf-lib` (MIT) acrescenta um **anexo de assinatura visual**, com nome declarado, função, data/hora do servidor, ID do documento e hash do PDF precedente.
- D1 registra versões, hashes SHA-256, autoria, estados e eventos; cada assinatura recebe HMAC-SHA256 com chave do sistema derivada do segredo clínico já existente.
- `GET /api/signatures/verify/:id?sha256=...` confere hash, HMAC da conclusão e bytes no R2; retorna apenas um resultado mínimo, sem prontuário.
- Falhas de rede antes do commit não produzem registro de assinatura concluída. Há travas de estado para impedir dupla assinatura concorrente.

## O que NÃO faz
- **Não** é assinatura digital qualificada ICP-Brasil, assinatura PAdES com certificado próprio da mãe/consultora, comprovação biométrica ou verificação de identidade civil.
- Um PDF exibindo assinatura manuscrita/digitada **não** é automaticamente assinatura eletrônica avançada; a adequação de cada documento precisa de validação jurídica.
- A assinatura permanece separada de `consents` e do editor clínico canônico. Sincronização de status com prontuário faz parte da fase 6 e requer definição de regras de revogação.
- Nenhuma modalidade de envio automática será ligada em produção até revisão e implantação segura.

## API
| Operação | Endpoint | Requisito |
|---|---|---|
| Criar solicitação | POST `/api/clinical/signatures/requests` | Consultora autenticada |
| Listar por mãe | GET `/api/clinical/signatures/requests?mother_id=...` | Consultora proprietária |
| Congelar documento | POST `/api/clinical/signatures/requests/:id/document` | PDF integral, sessão da consultora, confirmação de revisão |
| Enviar e-mail | POST `/api/clinical/signatures/requests/:id/send` | Documento congelado + flags de readiness |
| Consultar solicitação pública | GET `/api/signatures/recipient` | `x-signature-token` |
| Visualizar PDF público | GET `/api/signatures/recipient/document` | Token válido, não consumido |
| Assinar como mãe | POST `/api/signatures/recipient/sign` | Token + declaração expressa |
| Assinar como consultora | POST `/api/clinical/signatures/requests/:id/sign` | Sessão + mãe assinada |
| Baixar último PDF | GET `/api/clinical/signatures/requests/:id/document` | Consultora proprietária |
| Verificar PDF final | GET `/api/signatures/verify/:id?sha256=...` | Confere hash, HMAC e R2 |

## Rollout / segurança operacional

1. Revisar PR e testes; **não** habilitar envio real neste momento.
2. Aplicar a migração 0019 aditiva somente com autorização, dentro do fluxo atual de deploy; não importar/recriar base clínica.
3. Os endpoints e a tela pública ficam instalados, mas o link público somente funciona com `SIGNATURE_PUBLIC_FLOW_READY=true`. O disparo também exige `SIGNATURE_DELIVERY_ENABLED=true`.
4. Confirmar fluxo de domínio customizado `/assinar`, e-mail real com remetente autorizado e telefone iOS/Android. **Não colocar segredos em arquivos, GitHub ou Wrangler.**
5. Revisar os termos integrais com jurídico e equipe clínica. Uma consultora não deve assinar um mero PDF de status.
6. Não associar assinatura da plataforma a certificado ICP-Brasil. A validade como assinatura simples e exigências específicas do profissional devem ser avaliadas caso a caso.
7. Rodar QA dos testes D1/R2/PDF, segurança do token, isolamento entre consultoras, expiração/replay, PDF adulterado, URL, responsividade e regressão dos PDFs clínicos.

**Custo:** biblioteca `pdf-lib` é open source (MIT); D1/R2/Workers existentes, sem SaaS pago obrigatório. O transporte de e-mail continua o já instalado; serviço de envio de terceiros é uma escolha explícita, não dependência do módulo. O consumo de infraestrutura precisa respeitar as franquias configuradas.
