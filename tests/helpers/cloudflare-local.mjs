import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pbkdf2Sync } from 'node:crypto';

export const credentials = { email: 'audit@example.test', password: 'Local-test-only-2026!' };
export const userId = 'audit-professional';
export async function createLocalRuntime({ port = 0, assets = false } = {}) {
  const recoveryMessages = [];
  const bundle = await build({ entryPoints: ['worker/domain-entry.js'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  const mf = new Miniflare({
    modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-06',
    host: '127.0.0.1', port,
    bindings: { AUTH_RECOVERY_ORIGIN: 'https://app.test', CLINICAL_AUTH_SECRET: 'local-audit-secret-never-use-in-production' },
    d1Databases: ['CLINICAL_DB'], r2Buckets: ['CLINICAL_FILES'],
    // External services are deliberately unavailable: migrated login and clinical data must work locally.
    outboundService: () => new Response(JSON.stringify({ message: 'External service disabled in local audit' }), { status: 503, headers: { 'content-type': 'application/json' } }),
    serviceBindings: { AUTH_RECOVERY_DELIVERY: async request => { recoveryMessages.push(await request.json()); return new Response(null,{status:204}); }, ...(assets ? { ASSETS: async (request) => {
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      const root = resolve('dist');
      const path = resolve(root, '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
      if (!path.startsWith(root + '/')) return new Response('Forbidden', { status: 403 });
      try {
        const bytes = await readFile(path);
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.csv': 'text/csv', '.webmanifest': 'application/manifest+json' };
        return new Response(bytes, { headers: { 'content-type': types[extname(path)] || 'application/octet-stream' } });
      } catch { return new Response('Not found', { status: 404 }); }
    } } : {}) },
  });
  await mf.ready;
  const db = await mf.getD1Database('CLINICAL_DB');
  for (const path of ['cloudflare/full-migration-schema.sql', 'cloudflare/runtime-schema.sql']) {
    const sql = (await readFile(path, 'utf8')).replace(/^--.*$/gm, '');
    for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
  for (const [id, email] of [[userId, credentials.email], ['audit-other', 'other@example.test']]) {
    await db.prepare('INSERT INTO auth_users(user_id,email,email_confirmed_at,password_reset_required) VALUES(?,?,?,0)').bind(id, email, new Date().toISOString()).run();
    const salt = Buffer.from('local-audit-salt-2026').toString('base64url');
    const hash = pbkdf2Sync(credentials.password, Buffer.from(salt, 'base64url'), 100000, 32, 'sha256').toString('base64url');
    await db.prepare('INSERT INTO auth_credentials(user_id,password_salt,password_hash,password_iterations) VALUES(?,?,?,100000)').bind(id, salt, hash).run();
  }
  return { mf, db, recoveryMessages, close: () => mf.dispose(), async login(email = credentials.email) {
    const r = await mf.dispatchFetch('http://localhost/api/auth/token?grant_type=password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...credentials, email }) });
    if (!r.ok) throw new Error(`Local login ${r.status}: ${await r.text()}`);
    return r.json();
  } };
}
