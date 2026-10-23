# Integração Google Agenda — fase 1

## Entrega
- Menu Configurações > Integrações de calendário: conectar Google (OAuth), escolher calendário com permissão de escrita, sincronizar novamente e desconectar.
- Sincronização de agendamentos após criação, PATCH e exclusão nas APIs canônicas; falhas externas nunca impedem salvar o prontuário.
- Download autenticado de .ics no navegador (Google, Outlook, Apple), independente de OAuth.
- Eventos externos preservam somente horário, duração e título genérico. Sem nomes, endereços, prontuários, anotações ou valores.
- Tokens Google criptografados com AES-GCM e chave separada, isolados por owner_id no D1.

## Pré-requisitos externos — sem serviço pago obrigatório
No https://console.cloud.google.com/ criar projeto, habilitar Google Calendar API e configurar tela de consentimento OAuth para o app (inclusive publicação/verificação se aplicável aos usuários). Criar credencial OAuth Client ID > Web application com Authorized redirect URI exatamente:
https://app.deboralactacao.com/api/calendar/google/callback

Aplicar os seguintes secrets somente no Worker do Gestão Amamentação, sem sobrescrever os secrets antigos:
- GOOGLE_CALENDAR_CLIENT_ID: client ID do OAuth Web.
- GOOGLE_CALENDAR_CLIENT_SECRET: client secret correspondente.
- GOOGLE_CALENDAR_REDIRECT_URI: https://app.deboralactacao.com/api/calendar/google/callback (configurável para outro domínio próprio).
- GOOGLE_CALENDAR_TOKEN_KEY: string de 64 caracteres hexadecimais aleatórios (32 bytes) reservada exclusivamente à criptografia de tokens. Gerar localmente com node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"; nunca adicionar ao Git.

Os nomes acima não são dependências para a agenda atual nem para exportar .ics. Com Google não configurado, apenas o botão de conexão permanece oculto.

## Banco / deploy
A migração cloudflare/migrations/0011-calendar-google.sql foi adicionada de forma idempotente a cloudflare/runtime-schema.sql, utilizado pelo cutover atual. Verificar aplicação do schema e o CI antes de liberar o OAuth aos usuários. Não há alteração nos bindings atuais.

## Testes e limites
- node --test tests/calendar-integration.test.mjs
- node --check worker/calendar-integration.js && node --check worker/domain-entry.js
- npm run build
- Fluxo humano após configurar OAuth: conectar conta, selecionar calendário, criar, reagendar e cancelar agendamento; conferir que o evento acompanha as alterações; exportar .ics e abrir em Google/Apple/Outlook; desconectar.
- A fase 1 é unidirecional (sistema → calendário). Alterações no Google não atualizam a agenda clínica.
- Exportação .ics cria cópia estática, não assinatura de calendário.
- A sincronização em massa tem limite de 500 agendamentos por acionamento; integração Google tem cotas e requer consentimento da usuária. Fluxos em lote exigem cuidado se houver volume maior.


## Apple Calendário — assinatura privada, sem Apple ID/CalDAV
Na mesma tela `Configurações > Integrações de calendário` a consultora escolhe **Google Agenda** ou **Apple Calendário**.

- **Google**: OAuth com agenda selecionada e sincronização pela API, conforme seções acima.
- **Apple**: gera uma URL HTTPS privada para **assinar** no Calendário do iPhone, iPad ou Mac. A consultora pode tocar em "Abrir no Apple Calendário" (webcal://) ou copiar o link e adicionar uma assinatura manualmente.
- **Sem configuração do Apple Developer / iCloud secrets / senha de aplicativo**. A assinatura Apple é **somente leitura**, do Gestão Amamentação para a Apple, sujeita à frequência de atualização definida pela Apple. Não modifica eventos dentro do calendário pessoal já existente nem lê agenda Apple.
- **Segurança**: o Worker gera 32 bytes aleatórios, salva apenas o SHA-256 do segredo em `calendar_apple_feeds` e entrega a URL somente na criação/rotação. GET `/api/calendar/apple/feed/:token.ics` consulta proprietário pelo hash, lista apenas agendamentos do proprietário, devolve somente horários, duração e título genérico. Headers no-store/noindex/no-referrer. Quem obtiver o link privado pode ver os horários, por isso a usuária deve tratá-lo como credencial.
- **Rotação e revogação**: gerar outro link invalida imediatamente o anterior; revogar desativa a URL. Assinaturas antigas podem manter eventos já carregados em cache na Apple até serem removidas/atualizadas.
- **Sem dados de pacientes**: nunca transmitir nomes de mães/bebês, prontuários, endereços, diagnóstico ou anotações no ICS. Não confundir com a funcionalidade de exportação manual ICS (cópia estática).
- **Limite**: a consulta publicada nesta fase lê até 2.000 agendamentos por atualização. Não garante sincronização imediata nem bidirecional.
- **D1**: `cloudflare/migrations/0012-calendar-apple.sql` replicada no `cloudflare/runtime-schema.sql` idempotente. Não modificar secrets existentes.
- **Testes**: `node --test tests/apple-calendar-integration.test.mjs tests/calendar-integration.test.mjs`; sintaxe Worker/Frontend; `npm run build`. Validar manualmente assinatura real em dispositivo Apple, rotação/revogação, horários, cancelamento e isolamento.
