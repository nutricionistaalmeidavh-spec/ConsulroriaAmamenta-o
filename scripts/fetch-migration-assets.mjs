import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const target='public/resources/biblioteca-debora-v1-2.zip';
const source='https://consulroriaamamenta-o.nutricionistaalmeidavh.workers.dev/resources/biblioteca-debora-v1-2.zip';

try {
  await access(target);
  console.log('Library asset already present:', target);
} catch {
  console.log('Fetching library asset from current Cloudflare release...');
  const response=await fetch(source);
  if (!response.ok) throw new Error(`Failed to fetch library asset: ${response.status} ${response.statusText}`);
  const bytes=new Uint8Array(await response.arrayBuffer());
  await mkdir(dirname(target), { recursive:true });
  await writeFile(target, bytes);
  console.log(`Library asset saved: ${target} (${bytes.byteLength} bytes)`);
}
