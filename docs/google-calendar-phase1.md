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
