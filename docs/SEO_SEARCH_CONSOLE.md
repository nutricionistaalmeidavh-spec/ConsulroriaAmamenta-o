# ArtiSys SEO / Google Search Console

## Separação de autenticações

A administração de SEO é independente do login usado por profissionais, pacientes, membros, clientes da Loja Online ou usuários do Obra na Mão.

- a conta Google administrativa autoriza o Search Console;
- o Worker guarda Client Secret, refresh token e uma chave administrativa própria como secrets;
- a API SEO exige a sessão administrativa do painel ou a chave administrativa de contingência;
- nenhuma conta do produto é necessária para administrar SEO;
- Client Secret, refresh token, access token e chave administrativa nunca são enviados em respostas da API.

## Painel compartilhado

O painel continua no endereço existente:

```text
https://deboralactacao.com/admin/seo/
```

Ele agora pode alternar entre produtos, propriedades e lojas sem duplicar credenciais Google.

Contextos prontos:

- `debora`: propriedade da Débora Lactação;
- `loja-online`: propriedade `sc-domain:artisys.dev`, filtrada por `https://artisys.dev/sistemas/loja-online/`.

O atalho da Central ArtiSys abre:

```text
https://deboralactacao.com/admin/seo/?context=loja-online
```

## Endpoints administrativos

```text
GET /api/seo/google/sites
GET /api/seo/google/overview
```

`/sites` devolve somente as propriedades às quais a conta Google conectada realmente tem acesso e os contextos ArtiSys disponíveis. O backend não aceita uma propriedade arbitrária que não apareça nessa lista.

`/overview` aceita opcionalmente:

```text
?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
?context=loja-online
?siteUrl=sc-domain:artisys.dev
?siteUrl=sc-domain:artisys.dev&pagePrefix=https%3A%2F%2Fminhaloja.artisys.dev%2F
```

Sem período explícito, consulta 28 dias terminando dois dias antes do dia atual.

Quando `pagePrefix` é informado, todas as consultas agregadas, buscas e páginas recebem o mesmo filtro de dimensão `page`; assim as métricas ficam separadas por loja/URL sem misturar o restante da propriedade.

## Proteção

A rota exige uma sessão SEO administrativa válida ou o Bearer token de contingência. As credenciais Google permanecem exclusivamente no Worker.

Além da autenticação, o Worker aplica fail-closed por propriedade: `siteUrl` só é aceito se a API `sites.list` do Search Console confirmar acesso para a conta conectada. Uma propriedade não autorizada retorna `403 seo_site_not_allowed`.

URLs de loja usadas como `pagePrefix` precisam ser HTTPS e não podem carregar usuário, senha ou fragmento.

## Secrets / variáveis do Worker

Secrets existentes:

```text
ARTISYS_GOOGLE_CLIENT_ID
ARTISYS_GOOGLE_CLIENT_SECRET
ARTISYS_GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN
ARTISYS_SEO_ADMIN_TOKEN
ARTISYS_SEO_ADMIN_PASSWORD
```

Configuração de propriedades:

```text
ARTISYS_SEO_SITE_URL=deboralactacao.com
ARTISYS_SEO_ARTISYS_SITE_URL=sc-domain:artisys.dev
```

`ARTISYS_SEO_ARTISYS_SITE_URL` é opcional; o default é `sc-domain:artisys.dev`. `ARTISYS_SEO_LOJAONLINE_PAGE_PREFIX` também é opcional e só precisa ser usado se a página comercial da Loja Online mudar de endereço.

Não há novo serviço pago obrigatório nem novo segredo por loja. Subdomínios de `artisys.dev` podem ser analisados dentro da propriedade de domínio `sc-domain:artisys.dev`. Domínios próprios de clientes precisam estar verificados/acessíveis no Search Console para aparecerem na lista do painel.

## Provisionamento

O fluxo existente de OAuth/refresh token continua válido. A conta Google conectada deve possuir acesso às propriedades que serão exibidas no painel. Para habilitar `artisys.dev`, confirme a propriedade de domínio nessa mesma conta; o painel a descobrirá automaticamente via Search Console.

## Teste isolado

A validação focada do painel executa:

```bash
node --test worker/seo-search-console.test.mjs
node scripts/test-public-seo.mjs
node --check worker/seo-search-console.js
node --check worker/domain-entry.js
node --check public/admin/seo/app.js
```

Os testes cobrem autenticação, descoberta de propriedades, contexto Loja Online, filtro por URL de loja, bloqueio de propriedades não autorizadas, contrato da UI e ausência de vazamento de secrets.

## Origem do core

Os helpers vendorizados em `worker/vendor/artisys-seo/` vêm do núcleo reutilizável `artisys-seo`. O painel mantém a integração local sem alterar dados clínicos, billing ou autenticação dos produtos.
