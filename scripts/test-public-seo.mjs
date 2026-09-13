import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const landing = read('public/debora/index.html');
const robots = read('public/robots.txt');
const sitemap = read('public/sitemap.xml');
const dashboard = read('public/admin/seo/index.html');
const dashboardApp = read('public/admin/seo/app.js');
const worker = read('worker/domain-entry.js');
const seoWorker = read('worker/seo-search-console.js');

assert.match(landing, /<link\s+rel="canonical"\s+href="https:\/\/deboralactacao\.com\/"/i, 'landing must declare apex canonical');
assert.match(landing, /<meta\s+name="robots"\s+content="index,follow,max-image-preview:large"/i, 'landing must explicitly allow indexing');
assert.match(landing, /<meta\s+property="og:url"\s+content="https:\/\/deboralactacao\.com\/"/i, 'landing must expose og:url');
assert.match(landing, /<meta\s+name="twitter:card"\s+content="summary_large_image"/i, 'landing must expose Twitter card metadata');
assert.match(landing, /application\/ld\+json/i, 'landing must include JSON-LD');
assert.match(landing, /"@type"\s*:\s*"Person"/i, 'JSON-LD must describe Débora');
assert.match(landing, /"@type"\s*:\s*"FAQPage"/i, 'JSON-LD must describe visible FAQ content');

assert.match(robots, /User-agent:\s*\*/i);
assert.match(robots, /Disallow:\s*\/api\//i);
assert.doesNotMatch(robots, /Disallow:\s*\/app\//i, 'noindex HTML pages must remain crawlable so crawlers can see the directive');
assert.doesNotMatch(robots, /Disallow:\s*\/admin\//i, 'admin HTML must rely on noindex rather than crawler blocking');
assert.doesNotMatch(robots, /Disallow:\s*\/clinical-source\//i, 'internal HTML must rely on noindex rather than crawler blocking');
assert.match(robots, /Sitemap:\s*https:\/\/deboralactacao\.com\/sitemap\.xml/i);

assert.match(sitemap, /<loc>https:\/\/deboralactacao\.com\/<\/loc>/i);
assert.doesNotMatch(sitemap, /\/app\//i);
assert.doesNotMatch(sitemap, /\/admin\//i);
assert.doesNotMatch(sitemap, /\/api\//i);

assert.match(dashboard, /<meta\s+name="robots"\s+content="noindex,nofollow"/i, 'admin dashboard must not be indexed');
assert.match(dashboard, /Painel SEO/i);
assert.match(dashboard, /Entrar com Google/i, 'SEO dashboard must use the existing ArtiSys Google sign-in');
assert.doesNotMatch(dashboard, /Chave SEO/i, 'legacy admin key must not be exposed in the UI');
assert.doesNotMatch(dashboardApp, /provider[^\n]*google|provider=google/i, 'dashboard must not call the disabled Supabase Google provider');
assert.match(dashboardApp, /obra-na-mao-comercial\.nutricionistaalmeidavh\.workers\.dev\/api\/artisys-sso\/start/i, 'dashboard must reuse the existing ArtiSys Google OAuth broker');
assert.match(dashboardApp, /artisys_sso_code/i, 'dashboard must redeem the one-time owner SSO code');
assert.match(dashboardApp, /\/api\/seo\/google\/session/i, 'dashboard must establish an HttpOnly SEO admin session');
assert.match(dashboardApp, /\/api\/seo\/google\/overview/);
assert.doesNotMatch(dashboardApp, /localStorage/);
assert.match(seoWorker, /artisys-seo-session/i, 'SEO API must support its own HttpOnly admin session');
assert.match(seoWorker, /nutricionistaalmeidavh@gmail\.com/i, 'SEO API must restrict access to the owner e-mail');
assert.match(seoWorker, /ARTISYS_SEO_ADMIN_TOKEN/, 'legacy admin token must remain available as emergency fallback and signing key');
assert.match(seoWorker, /api\/artisys-sso\/redeem/i, 'SEO session exchange must redeem the broker code server-side');

assert.match(worker, /\/api\/seo\/google\/session/i, 'worker must route the SEO SSO session exchange');
assert.match(worker, /x-robots-tag/i, 'private paths must receive X-Robots-Tag');

console.log('Public SEO contract OK');
