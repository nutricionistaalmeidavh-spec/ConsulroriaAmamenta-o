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

assert.match(landing, /<link\s+rel="canonical"\s+href="https:\/\/deboralactacao\.com\/"/i, 'landing must declare apex canonical');
assert.match(landing, /<meta\s+name="robots"\s+content="index,follow,max-image-preview:large"/i, 'landing must explicitly allow indexing');
assert.match(landing, /<meta\s+property="og:url"\s+content="https:\/\/deboralactacao\.com\/"/i, 'landing must expose og:url');
assert.match(landing, /<meta\s+name="twitter:card"\s+content="summary_large_image"/i, 'landing must expose Twitter card metadata');
assert.match(landing, /application\/ld\+json/i, 'landing must include JSON-LD');
assert.match(landing, /"@type"\s*:\s*"Person"/i, 'JSON-LD must describe Débora');
assert.match(landing, /"@type"\s*:\s*"FAQPage"/i, 'JSON-LD must describe visible FAQ content');

assert.match(robots, /User-agent:\s*\*/i);
assert.match(robots, /Disallow:\s*\/app\//i);
assert.match(robots, /Disallow:\s*\/admin\//i);
assert.match(robots, /Disallow:\s*\/api\//i);
assert.match(robots, /Sitemap:\s*https:\/\/deboralactacao\.com\/sitemap\.xml/i);

assert.match(sitemap, /<loc>https:\/\/deboralactacao\.com\/<\/loc>/i);
assert.doesNotMatch(sitemap, /\/app\//i);
assert.doesNotMatch(sitemap, /\/admin\//i);
assert.doesNotMatch(sitemap, /\/api\//i);

assert.match(dashboard, /<meta\s+name="robots"\s+content="noindex,nofollow"/i, 'admin dashboard must not be indexed');
assert.match(dashboard, /Painel SEO/i);
assert.match(dashboardApp, /\/api\/seo\/google\/overview/);
assert.match(dashboardApp, /sessionStorage/);
assert.doesNotMatch(dashboardApp, /localStorage/);

assert.match(worker, /x-robots-tag/i, 'private paths must receive X-Robots-Tag');

console.log('Public SEO contract OK');
