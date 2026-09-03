import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const target='public/resources/biblioteca-debora-v1-2.zip';
const source='https://debora-lactacao-ze2xeo.v2.appdeploy.ai/resources/biblioteca-debora-v1-2.zip';

try {
  await access(target);
  console.log('Migration asset already present:', target);
} catch {
  console.log('Fetching migration asset from current AppDeploy release...');
  const response=await fetch(source);
  if (!response.ok) throw new Error(`Failed to fetch migration asset: ${response.status} ${response.statusText}`);
  const bytes=new Uint8Array(await response.arrayBuffer());
  await mkdir(dirname(target), { recursive:true });
  await writeFile(target, bytes);
  console.log(`Migration asset saved: ${target} (${bytes.byteLength} bytes)`);
}
