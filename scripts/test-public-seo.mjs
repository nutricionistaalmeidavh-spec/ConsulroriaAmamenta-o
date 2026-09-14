import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'); }

const landing = read('public/debora/index.html');
const robots = read('public/robots.txt');
const sitemap = read('public/sitemap.xml');
const dashboard = read('public/admin/seo/index.html');
const dashboardApp = read('public/admin/seo/app.js');
const worker = read('worker/domain-entry.js');
const seoWorker = read('worker/seo-search-console.js');

assert.match(landing, /<link\s+rel="canonical"\s+href="https:\/\/deboralactacao\.com\/"/i);
assert.match(robots, /Sitemap:\s*https:\/\/deboralactacao\.com\/sitemap\.xml/i);
assert.match(sitemap, /<loc>https:\/\/deboralactacao\.com\/<\/loc>/i);

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
