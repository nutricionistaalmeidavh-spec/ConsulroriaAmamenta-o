# SEO / Google Search Console — Débora Lactação

## Separação de autenticações

A administração de SEO é independente do login usado por profissionais, pacientes, membros ou qualquer outro usuário do produto.

- a conta Google administrativa autoriza o Search Console;
- o Worker guarda Client Secret, refresh token e uma chave administrativa própria como secrets;
- a API SEO exige essa chave administrativa da ArtiSys;
- nenhuma conta Supabase/Membra/Débora é necessária para administrar SEO;
- Client Secret, refresh token, access token e chave administrativa nunca são enviados em respostas da API.

## Endpoint administrativo

```text
GET /api/seo/google/overview
Authorization: Bearer <ARTISYS_SEO_ADMIN_TOKEN>
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

1. `ARTISYS_SEO_ADMIN_TOKEN` configurado como secret do Worker;
2. o mesmo token no header Bearer da requisição administrativa;
3. credenciais Google configuradas como secrets do Worker.

Sem token administrativo configurado, o endpoint permanece fechado (`503 seo_admin_not_configured`). Sem Bearer token responde `401`; token incorreto responde `403`.

## Secrets do Worker

```text
ARTISYS_GOOGLE_CLIENT_ID
ARTISYS_GOOGLE_CLIENT_SECRET
ARTISYS_GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN
ARTISYS_SEO_ADMIN_TOKEN
```

O domínio padrão do produto é `deboralactacao.com`; `ARTISYS_SEO_SITE_URL` pode sobrescrever esse valor se necessário.

## Provisionamento sem copiar segredos

Depois que o OAuth local do `artisys-seo` estiver concluído, execute no checkout deste repo:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\provision-seo-search-console.ps1
```

O script:

- lê `%LOCALAPPDATA%\ArtiSys\SEO\google-search-console-token.json`;
- lê Client ID/Secret do remote rclone `artisys-qa-drive`;
- valida o refresh token diretamente no Google;
- confirma acesso a `sc-domain:deboralactacao.com`;
- cria ou reutiliza uma chave administrativa forte em `%LOCALAPPDATA%\ArtiSys\SEO\debora-seo-admin-token.txt`;
- cria um JSON temporário fora do repo;
- envia os quatro secrets em lote ao Cloudflare via Wrangler;
- remove o arquivo temporário mesmo em caso de erro.

O valor da chave administrativa não é exibido no terminal e nenhum segredo é commitado. A conta Google administrativa pode ser a conta que já possui a propriedade no Search Console; isso não cria nem exige um usuário correspondente dentro do produto.

## Teste isolado

```bash
npm run test:seo
```

Os testes cobrem default-deny, ausência de Bearer token, token administrativo inválido, consulta real modelada do Search Console, independência do login do produto e ausência de vazamento de secrets na resposta.

## Origem do core

Os helpers vendorizados em `worker/vendor/artisys-seo/` vêm do módulo `artisys-seo` do repositório `utilidades`; `SOURCE.json` registra o commit de origem para auditoria e atualização futura.
