# Diagnóstico de roteamento por domínio — 2026-09-13

Sintoma observado após deploy manual:
- `deboralactacao.com/` servia o `index.html` clínico diretamente em vez da landing `/debora/`;
- `comercial.deboralactacao.com/` também servia o `index.html` clínico;
- `deboralactacao.com/comercial/` funcionava corretamente.

Causa raiz: em `wrangler.jsonc`, `assets.run_worker_first` estava limitado a `["/api/*"]`. Assim, requisições de assets/HTML para `/` eram atendidas pelo Static Assets antes de `worker/domain-entry.js`, impedindo que `resolvePublicHostRoute()` executasse os rewrites/redirects por hostname.

Correção: executar o Worker antes dos assets para todas as rotas (`run_worker_first: true`) e manter o bypass explícito de `/api/*` no próprio `domain-entry.js`.
