import { createServer } from 'node:http';
import { rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createLocalRuntime } from '../helpers/cloudflare-local.mjs';

const legacyWorkerPath = fileURLToPath(new URL('../../dist/legacy-sw-test.js', import.meta.url));
await writeFile(legacyWorkerPath, `
const CACHE_NAME = 'debora-lactacao-v1.14.1-stability';
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.put('/legacy-version-marker', new Response('STALE_VERSION_N'));
    self.skipWaiting();
  })());
});
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
`, 'utf8');

const runtime = await createLocalRuntime({ port: 4173, assets: true });
const ready = createServer((_request, response) => {
  response.end(_request.url === '/recovery-inbox' ? JSON.stringify(runtime.recoveryMessages) : 'ready');
}).listen(4174, '127.0.0.1');

console.log('Local clinical audit ready at http://127.0.0.1:4173');

async function shutdown() {
  ready.close();
  await runtime.close();
  await rm(legacyWorkerPath, { force: true });
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, shutdown);
