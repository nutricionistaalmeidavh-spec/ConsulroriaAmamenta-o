# Outlook Calendário — assinatura ICS sem OAuth Microsoft

## Para a consultora
Em **Configurações → Outlook Calendário**, toque em **Gerar link Outlook** e em **Copiar link**.
Abra o Outlook (pessoal ou corporativo) → Calendário → Adicionar calendário → **Assinar da Web** → cole a URL HTTPS → Importar/Salvar.
**Não use 'Importar arquivo .ics'**, pois isso cria somente uma cópia sem atualização. Consulte instruções oficiais: https://support.microsoft.com/pt-br/outlook/import-or-subscribe-to-a-calendar-in-outlook-com-or-outlook-on-the-web

Depois da assinatura inicial, Outlook consulta a URL periodicamente e mostra alterações, reagendamentos ou cancelamentos no feed. **A Microsoft controla o intervalo e pode levar mais de 24 horas**. Assinatura somente leitura: alterações feitas no Outlook não são enviadas ao Gestão Amamentação.

## Privacidade
URL secreta HTTPS emitida uma única vez (32 bytes aleatórios); banco D1 guarda exclusivamente SHA-256, nunca a URL nem o token.
Uma URL válida permite a qualquer portador consultar os horários genéricos; portanto é uma credencial.
O endpoint sem login usa a prova criptográfica de posse do token e consulta dados estritamente por `owner_id`. Nunca expor mães, bebês, nomes, endereço, observações clínicas nem prontuários.
Gerar novo link revoga o anterior; revogar desativa a URL. O Outlook pode conservar eventos em cache até deixar de atualizar ou a assinatura ser removida.

## Estrutura
- `worker/outlook-calendar-integration.js`: endpoints independentes `/api/calendar/outlook/status`, `/create`, `/revoke`, `/feed/:token.ics`
- `public/outlook-calendar-feature.js`: card mobile-first em Configurações
- `cloudflare/migrations/0017-calendar-outlook.sql`: D1 aditivo e idempotente; espelhado no schema canônico
- Reutiliza a projeção ICS canônica de `worker/apple-calendar-ics.js` **somente para gerar campos de evento genéricos e filtrar agendamentos por profissional**. Os tokens são 100% independentes dos da Apple.
- Nenhum secret, chave Microsoft, Microsoft Graph, OAuth ou alteração nas contas Google e Apple.
- Testes: `node --test tests/outlook-calendar-integration.test.mjs tests/apple-calendar-integration.test.mjs` e `npm run build`.

## Validação
Testar com duas consultoras e dados fictícios, que cada assinatura lista apenas seus compromissos; após alteração e cancelamento, a URL reflete a mudança. Validar revogação/rotação e independência Apple.
Validar assinatura num Outlook real, pois CI não consegue antecipar o cache remoto da Microsoft.
