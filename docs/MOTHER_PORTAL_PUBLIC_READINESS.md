# Área das Mães 1.0 — fases 0 a 4 (branch isolada)

## Base e escopo
- Base da branch: `main` no commit `55675a5355b9e85b369e88ffced26638cfddbca1`.
- Sem merge para `main`, sem deploy e sem alteração de secrets ou bindings.
- O portal permanece desligado por padrão: `MOTHER_PORTAL_ENABLED=false` quando ausente.
- O caminho `#mae` não é uma barreira de segurança; a API é a autoridade.
- Código-fonte: `public/member-feature.js`, `public/clinical-care-flow-feature.js`, `worker/block6-rpc-runtime.js`, `worker/cloudflare-data-runtime.js`.
- Não recriar `mother_id`, `baby_id`, `appointment_id`, `encounter_id` ou `owner_id`. Prontuário e agenda seguem canônicos.
- `care_plan.orientation_mode` e `care_plan.weekly_plan` são lidos do atendimento, sem segunda fonte de verdade.

## Fluxos projetados
1. Consultora seleciona paciente desambiguada, revisa plano de cuidado e publica apenas conteúdo autorizado.
2. Mãe recebe o link genérico da Área das Mães, cria conta ou entra com e-mail da liberação.
3. Primeiro vínculo: mãe solicita um código enviado ao e-mail convidado; código de seis dígitos expira em 15 minutos, admite cinco tentativas e limita reenvios.
4. Após verificação, o `member_user_id` é vinculado de maneira atômica ao convite persistido no D1.
5. A API retorna somente registros da mãe vinculada e conteúdos liberados para seu nível de acesso.
6. Materiais R2 são assinados apenas após validação da permissão; cada download delegado revalida revogação.

## Segurança e modelo de identidade
- E-mail e nome não são chave clínica; alterações de e-mail exigem nova comprovação.
- `owner_id` + `mother_id` delimita os dados do vínculo.
- RPCs clínicas profissionais e registros privados são negados a identidades vinculadas como mães, antes dos handlers clínicos.
- Publicações de prontuário, anamnese, avaliação completa e encaminhamento não são entregues pelo portal.
- Não colocar conteúdo clínico sensível em arquivos estáticos públicos; materiais individuais privados devem usar R2.
- A API de convite não envia senha nem token de autenticação por e-mail; somente código efêmero.
- Não registrar códigos de verificação, tokens, dados clínicos nem corpos completos de publicações em logs.
- Uma mãe com papel profissional simultâneo requer decisão explícita de produto e testes adicionais antes de ativar a flag.

## Banco
- Migração aditiva: `cloudflare/migrations/0011-mother-portal-challenges.sql`.
- A rotina de deploy existente deve aplicar esta migração antes de habilitar o portal.
- Não remover tabelas nem substituir registros clínicos. A tabela de desafios pode permanecer após rollback.
- Arquivos R2 preservam suas chaves originais; a autorização usa as publicações canônicas.

## Visual e UX
- Reaproveitar `--lac-rose`, `--lac-rose-soft`, `--lac-ink`, `--lac-warm`, `--lac-line` e tipografia do sistema clínico.
- Campos de código de verificação e estados pendente/falha/sucesso devem ser visíveis.
- Pacientes homônimas devem ser distinguidas por bebê, final de telefone e sufixo de ID na interface profissional.
- Marcar conteúdo como concluído apenas após confirmação da escrita; se a rede falhar, manter estado anterior.

## QA antes de liberação (fases 5 e 6 ainda pendentes)
- Executar `npm run test:block6`, `npm run test:cloudflare-regressions`, `npm run test:auth-runtime`, `npm run test:frontend-cutover`, `npm run test:stability`, `npm run test:e2e`, `npm run test:e2e:mobile`.
- Validar dupla reivindicação concorrente, convite revogado, mudança de e-mail, membros com nomes iguais, usuário sem licença e erro de SMTP.
- Executar testes E2E com mães e bebês inteiramente fictícios, incluindo visualizações mobile e arquivos R2.
- Antes de ativar flag: confirmar o envio real de código pelo canal de e-mail já configurado, aplicação de migração e revisão dos controles de domínio.
- Não declarar conformidade LGPD ou WCAG sem homologação; executar auditoria específica.

## Rollback
1. Desabilitar `MOTHER_PORTAL_ENABLED` na configuração de execução.
2. Reverter somente os commits da branch ou o merge futuro mediante PR; preservar D1/R2 e secrets.
3. Não fazer rollback destrutivo da migração 0011.
4. Registrar incidente, evidências sanitizadas, correção e reativação apenas após QA.

## Critério de liberação
O portal só deverá ser publicamente habilitado após passar testes P0 de autorização, convites, R2, persistência clínica, regressão das consultoras, UX mobile, acessibilidade e recuperação de falhas.
