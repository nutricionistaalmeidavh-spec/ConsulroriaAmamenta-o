import { createServer } from 'node:http';
import { createLocalRuntime } from '../helpers/cloudflare-local.mjs';
const runtime = await createLocalRuntime({ port: 4173, assets: true });
const ready = createServer((_request, response) => { response.end(_request.url === '/recovery-inbox' ? JSON.stringify(runtime.recoveryMessages) : 'ready'); }).listen(4174, '127.0.0.1');
console.log('Local clinical audit ready at http://127.0.0.1:4173');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { ready.close(); await runtime.close(); process.exit(0); });
