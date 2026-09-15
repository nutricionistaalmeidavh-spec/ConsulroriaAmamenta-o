import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { injectCommercialSeoHtml } from '../worker/commercial-seo.js';

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'); }

const landing = read('public/debora/index.html');
const commercialLanding = read('public/comercial/index.html');
const commercialSeoLanding = injectCommercialSeoHtml(commercialLanding);
const robots = read('public/robots.txt');
const sitemap = read('public/sitemap.xml');
const dashboard = read('public/admin/seo/index.html');
const dashboardApp = read('public/admin/seo/app.js');
const worker = read('worker/domain-entry.js');
const seoWorker = read('worker/seo-search-console.js');

assert.match(landing, /<link\s+rel="canonical"\s+href="https:\/\/deboralactacao\.com\/"/i);
assert.match(robots, /Sitemap:\s*https:\/\/deboralactacao\.com\/sitemap\.xml/i);
assert.match(sitemap, /<loc>https:\/\/deboralactacao\.com\/<\/loc>/i);
assert.match(sitemap, /<loc>https:\/\/deboralactacao\.com\/comercial\/<\/loc>/i);

// P0 local/commercial SEO intent: keep the emotional H1 while making service + location explicit.
assert.match(landing, /<title>Consultora de Amamentação em Ribeirão Preto \| Débora<\/title>/i);
assert.match(landing, /<meta\s+name="description"\s+content="Consultoria de amamentação presencial em Ribeirão Preto e online\. Orientação para pega, dor ao amamentar, preparação e pós-parto\."/i);
assert.match(landing, /Consultora de amamentação em Ribeirão Preto e online/i);
assert.match(landing, /<h1[^>]*>Amamentar tem sido mais difícil do que você imaginava\?<\/h1>/i);
assert.match(landing, /Dor ao amamentar, dificuldade na pega ou insegurança sobre as mamadas\?/i);
assert.match(landing, /presencialmente em Ribeirão Preto ou online/i);
assert.match(landing, /Consultoria de amamentação em Ribeirão Preto/i);
assert.match(landing, /É normal sentir dor ao amamentar\?/i);
assert.match(landing, /Como saber se a pega do bebê precisa de orientação\?/i);
assert.match(landing, /A consultoria de amamentação é presencial em Ribeirão Preto\?/i);
assert.match(landing, /"@type"\s*:\s*"City"[^}]*"name"\s*:\s*"Ribeirão Preto"/i, 'structured data must reflect the confirmed local service area');

// Commercial page is a separate search intent: software/management for lactation consultants.
assert.match(commercialSeoLanding, /<title>Sistema para Consultoras de Amamentação \| Débora Lactação<\/title>/i);
assert.match(commercialSeoLanding, /<meta\s+name="description"\s+content="Sistema de gestão para consultoras de amamentação/i);
assert.match(commercialSeoLanding, /<link\s+rel="canonical"\s+href="https:\/\/deboralactacao\.com\/comercial\/"/i);
assert.match(commercialSeoLanding, /property="og:url"\s+content="https:\/\/deboralactacao\.com\/comercial\/"/i);
assert.match(commercialSeoLanding, /name="twitter:card"\s+content="summary"/i);
assert.match(commercialSeoLanding, /"@type":"SoftwareApplication"/i);
assert.match(commercialSeoLanding, /"@type":"FAQPage"/i);
assert.match(commercialLanding, /<h1>Seu atendimento termina\. <span>A organização dele não deveria tomar o resto do seu dia\.<\/span><\/h1>/i, 'commercial conversion copy must remain untouched');
assert.match(worker, /withCommercialSeo/i, 'domain worker must apply commercial SEO at the edge');
assert.match(worker, /isCommercialLandingPath/i, 'commercial SEO must be restricted to the sales landing');

assert.match(dashboard, /<meta\s+name="robots"\s+content="noindex,nofollow"/i);
assert.match(dashboard, /Painel SEO/i);
assert.match(dashboard, /E-mail/i);
assert.match(dashboard, /Senha/i);
assert.doesNotMatch(dashboard, /Entrar com Google/i, 'Google login must be removed from SEO admin UI');
assert.doesNotMatch(dashboardApp, /accounts\.google\.com|gsi\/client|initTokenClient|workers\.dev|obra-na-mao-comercial/i, 'SEO admin login must not depend on Google UI or another product');
assert.match(dashboardApp, /\/api\/seo\/login/i, 'dashboard must submit e-mail/password to its own worker');
assert.match(dashboardApp, /\/api\/seo\/google\/overview/i);
assert.doesNotMatch(dashboardApp, /localStorage/);
assert.match(seoWorker, /ARTISYS_SEO_ADMIN_PASSWORD/i, 'SEO worker must read password only from a Worker secret');
assert.match(seoWorker, /nutricionistaalmeidavh@gmail\.com/i, 'SEO worker must restrict access to the owner e-mail');
assert.match(seoWorker, /artisys-seo-session/i, 'successful login must create its own HttpOnly session');
assert.doesNotMatch(seoWorker, /SEO_GOOGLE_LOGIN_CLIENT_ID|oauth2\/v2\/userinfo|tokeninfo\?access_token/i, 'admin login must not validate Google credentials anymore');
assert.match(worker, /\/api\/seo\/login/i, 'worker must expose the password login endpoint');
assert.match(worker, /x-robots-tag/i);

console.log('Public SEO contract OK');
