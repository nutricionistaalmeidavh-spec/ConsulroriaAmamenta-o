# SEO / Google Search Console — Débora Lactação

## Separação de autenticações

A conexão administrativa do Search Console é independente do login Google usado por profissionais, pacientes ou outros usuários do produto.

- o usuário do sistema autentica normalmente via Supabase;
- o Worker valida se esse usuário está na allowlist SEO;
- o Worker usa, no servidor, o OAuth administrativo da ArtiSys para consultar o Search Console;
- Client Secret, refresh token e access token nunca são enviados ao navegador.

## Endpoint

```text
GET /api/seo/google/overview
```

O endpoint aceita opcionalmente:

```text
?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
```

Sem período explícito, consulta 28 dias terminando dois dias antes do dia atual.

Resposta autorizada:

```json
{
  "ok": true,
  "googleSearch": {
    "siteUrl": "sc-domain:deboralactacao.com",
    "period": { "startDate": "...", "endDate": "..." },
    "metrics": {
      "clicks": 0,
      "impressions": 0,
      "ctr": 0,
      "position": null
    },
    "topQueries": [],
    "topPages": []
  }
}
```

Os valores acima são apenas o formato do contrato; o Worker retorna dados reais da API.

## Proteção

A rota exige:

1. Bearer token válido do Supabase do produto;
2. usuário presente em `ARTISYS_SEO_ALLOWED_USER_IDS` ou `ARTISYS_SEO_ALLOWED_EMAILS`;
3. credenciais Google configuradas como secrets do Worker.

Sem allowlist configurada, o endpoint permanece fechado (`503 seo_admin_not_configured`).

## Secrets do Worker

```text
ARTISYS_GOOGLE_CLIENT_ID
ARTISYS_GOOGLE_CLIENT_SECRET
ARTISYS_GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN
ARTISYS_SEO_ALLOWED_EMAILS
```

Opcionalmente, a allowlist pode usar:

```text
ARTISYS_SEO_ALLOWED_USER_IDS
```

O domínio padrão do produto é `deboralactacao.com`; `ARTISYS_SEO_SITE_URL` pode sobrescrever esse valor se necessário.

## Provisionamento sem copiar segredos

Depois que o OAuth local do `artisys-seo` estiver concluído, no checkout deste repo:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\provision-seo-search-console.ps1 -AllowedEmail "seu-email-de-login-no-sistema"
```

O script:

- lê `%LOCALAPPDATA%\ArtiSys\SEO\google-search-console-token.json`;
- lê Client ID/Secret do remote rclone `artisys-qa-drive`;
- cria um JSON temporário fora do repo;
- envia os secrets em lote ao Cloudflare via Wrangler;
- remove o arquivo temporário mesmo em caso de erro.

Nenhum valor secreto é commitado.

## Teste isolado

```bash
npm run test:seo
```

Os testes cobrem autenticação obrigatória, default-deny, allowlist, consulta real modelada do Search Console e ausência de vazamento de secrets na resposta.

## Origem do core

Os helpers vendorizados em `worker/vendor/artisys-seo/` vêm do módulo `artisys-seo` do repositório `utilidades`; `SOURCE.json` registra o commit de origem para auditoria e atualização futura.
