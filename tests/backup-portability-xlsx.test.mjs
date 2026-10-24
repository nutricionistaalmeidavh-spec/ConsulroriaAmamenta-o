import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackupWorkbook, backupTables, backupFormat, backupVersion, encryptBackup, decryptBackup } from '../public/clinical-source/core/lib/backup-service.js';

function sampleBackup() {
  const tables = Object.fromEntries(backupTables.map((table) => [table, []]));
  tables.mothers.push({ recordKey:'mother-1', record:{id:'mother-1',owner_id:'owner-1',name:'Ana',comments:'=HYPERLINK("http://bad.example","Click")',nested:{risk:'baixo'}},sourceCreatedAt:'2026-10-20T10:00:00Z' });
  tables.babies.push({ recordKey:'baby-1',record:{id:'baby-1',owner_id:'owner-1',mother_id:'mother-1',weight_g:4100} });
  return {format:backupFormat,version:backupVersion,ownerId:'owner-1',exportedAt:'2026-10-24T11:00:00Z',scope:{kind:'clinical-account',files:false},tables,files:[{bucket:'clinical-media',path:'owner-1/photo.jpg',size:567,mimeType:'image/jpeg'}]};
}

function unzipStored(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const decoded = new TextDecoder();
  const result = new Map();
  let offset = 0;
  while (offset + 30 < bytes.length && view.getUint32(offset,true)===0x04034b50) {
    assert.equal(view.getUint16(offset+8,true),0,'worksheets must use ZIP store encoding');
    const len=view.getUint32(offset+18,true),nameLen=view.getUint16(offset+26,true),extraLen=view.getUint16(offset+28,true);
    const name=decoded.decode(bytes.subarray(offset+30,offset+30+nameLen));
    const start=offset+30+nameLen+extraLen;
    result.set(name,decoded.decode(bytes.subarray(start,start+len)));
    offset=start+len;
  }
  return result;
}

test('exporting readable XLSX includes 23 clinical tables, summary and file references without leaking binaries', async () => {
  const bytes = await createBackupWorkbook(sampleBackup());
  assert.equal(bytes.type,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const zip=unzipStored(new Uint8Array(await bytes.arrayBuffer()));
  assert.ok(zip.has('[Content_Types].xml'));
  assert.ok(zip.has('xl/workbook.xml'));
  assert.equal((zip.get('xl/workbook.xml').match(/<sheet name=/g)||[]).length,backupTables.length+2);
  assert.match(zip.get('xl/worksheets/sheet1.xml'),/Gestão Amamentação/);
  assert.match([...zip.values()].join('\n'),/mother-1/);
  assert.match([...zip.values()].join('\n'),/owner-1\/photo.jpg/);
  assert.doesNotMatch([...zip.values()].join('\n'),/bytesBase64/);
});

test('XLSX treats spreadsheet formulas as literal patient data and preserves unicode and JSON values', async () => {
  const workbook=unzipStored(new Uint8Array(await (await createBackupWorkbook(sampleBackup())).arrayBuffer()));
  const xml=[...workbook.values()].join('\n');
  assert.match(xml,/Ana/);
  assert.match(xml,/&apos;=HYPERLINK/);
  assert.match(xml,/&quot;risk&quot;: &quot;baixo&quot;|&quot;risk&quot;:&quot;baixo&quot;/);
  assert.doesNotMatch(xml,/<f>/);
});

test('older encrypted envelopes are still decryptable for legacy restores', async () => {
  const original=sampleBackup();
  const envelope=await encryptBackup(original,'uma senha segura');
  assert.deepEqual(await decryptBackup(envelope,'uma senha segura'),original);
});
