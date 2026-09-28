# E-mails transacionais

O Worker envia três mensagens: recuperação de senha, boas-vindas após a criação da conta e confirmação da primeira compra. Falhas em boas-vindas ou compra não bloqueiam o cadastro/pagamento; falhas de recuperação invalidam o link gerado e retornam indisponibilidade.

## Configuração recomendada (Cloudflare Email Sending)

1. Ative o domínio em **Envio de Email** no Cloudflare e confirme os registros DNS solicitados.
2. O binding nativo `EMAIL` já está declarado em `wrangler.jsonc` com `remote: true`.
3. O remetente padrão é `Débora Lactação <welcome@deboralactacao.com>`. Para usar outro endereço verificado, defina `TRANSACTIONAL_EMAIL_FROM` no painel do Worker.
4. Defina `AUTH_RECOVERY_ORIGIN=https://app.deboralactacao.com`.
5. Publique o Worker e teste recuperação, criação de conta e compra com um endereço controlado pela equipe.

Esse transporte usa `env.EMAIL.send()` e não exige token de API.

## Transportes alternativos

Se o binding nativo não estiver disponível, o runtime aceita um Worker privado via service binding `TRANSACTIONAL_EMAIL_DELIVERY`, o binding legado `AUTH_RECOVERY_DELIVERY` exclusivamente para recuperação, ou Resend por `RESEND_API_KEY` e `TRANSACTIONAL_EMAIL_FROM`.

Não publique chaves em `wrangler.jsonc`, arquivos `.env`, logs ou commits. Configure DMARC inicialmente em modo de observação e só aumente a política depois de confirmar SPF/DKIM alinhados para todos os remetentes legítimos.
