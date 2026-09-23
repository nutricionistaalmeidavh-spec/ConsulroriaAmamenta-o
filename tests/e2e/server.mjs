import { createServer } from 'node:http';
import { createLocalRuntime } from '../helpers/cloudflare-local.mjs';

const runtime = await createLocalRuntime({ port: 4173, assets: true });

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function resetClinicalState() {
  await runtime.db.prepare('DROP TRIGGER IF EXISTS fail_patient_consent_e2e').run();
  await runtime.db.prepare('DELETE FROM clinical_idempotency_keys').run();
  await runtime.db.prepare('DELETE FROM supabase_records').run();
  runtime.recoveryMessages.length = 0;
}

const ready = createServer(async (request, response) => {
  try {
    if (request.url === '/recovery-inbox') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(runtime.recoveryMessages));
      return;
    }

    if (request.method === 'POST' && request.url === '/control/reset-clinical') {
      await resetClinicalState();
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (request.method === 'POST' && request.url === '/control/fail-patient-consent') {
      const { enabled } = await readJson(request);
      await runtime.db.prepare('DROP TRIGGER IF EXISTS fail_patient_consent_e2e').run();
      if (enabled) {
        await runtime.db.prepare(`CREATE TRIGGER fail_patient_consent_e2e BEFORE UPDATE ON supabase_records WHEN NEW.table_name='consents' BEGIN SELECT RAISE(ABORT, 'forced_consent_failure_e2e'); END`).run();
      }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ ok: true, enabled: Boolean(enabled) }));
      return;
    }

    response.end('ready');
  } catch (error) {
    response.statusCode = 500;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ error: error?.message || String(error) }));
  }
}).listen(4174, '127.0.0.1');

console.log('Local clinical audit ready at http://127.0.0.1:4173');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  ready.close();
  await runtime.close();
  process.exit(0);
});
