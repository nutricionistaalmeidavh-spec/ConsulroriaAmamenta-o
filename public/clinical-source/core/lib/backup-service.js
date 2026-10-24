const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ITERATIONS = 180000;
const BACKUP_FORMAT = 'debora-lactacao-clinical-account-backup';
const BACKUP_VERSION = 2;
const BACKUP_TABLES = [
  'mothers','babies','appointments','appointment_babies','clinical_encounters','clinical_encounter_babies',
  'weights','growth_measurements','followups','financial_entries','consents','library_items','media','clinical_media',
  'clinical_document_templates','clinical_documents','clinical_encounter_addenda','clinical_note_revisions',
  'care_packages','care_package_items','care_package_sessions','care_package_item_usages','professional_profiles',
];

function toBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64'));
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function deriveKey(passphrase, salt, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle) throw new Error('Criptografia segura indisponível neste navegador.');
  if (String(passphrase || '').length < 6) throw new Error('Use uma senha de backup com pelo menos 6 caracteres.');
  const material = await cryptoImpl.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return cryptoImpl.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt','decrypt']
  );
}

export async function encryptBackup(payload, passphrase, { cryptoImpl = globalThis.crypto } = {}) {
  const salt = cryptoImpl.getRandomValues(new Uint8Array(16));
  const iv = cryptoImpl.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, cryptoImpl);
  const plaintext = encoder.encode(JSON.stringify(payload));
  const ciphertext = new Uint8Array(await cryptoImpl.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  return {
    format: 'debora-lactacao-backup',
    version: 1,
    payloadFormat: BACKUP_FORMAT,
    payloadVersion: BACKUP_VERSION,
    kdf: 'PBKDF2-SHA256',
    iterations: ITERATIONS,
    cipher: 'AES-256-GCM',
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext)
  };
}

export async function decryptBackup(envelope, passphrase, { cryptoImpl = globalThis.crypto } = {}) {
  if (envelope?.format !== 'debora-lactacao-backup' || envelope?.version !== 1) throw new Error('Arquivo de backup inválido.');
  try {
    const salt = fromBase64(envelope.salt);
    const iv = fromBase64(envelope.iv);
    const ciphertext = fromBase64(envelope.ciphertext);
    const key = await deriveKey(passphrase, salt, cryptoImpl);
    const clear = await cryptoImpl.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return JSON.parse(decoder.decode(clear));
  } catch (error) {
    if (/pelo menos 6/.test(error?.message || '')) throw error;
    throw new Error('Senha do backup incorreta ou arquivo corrompido.');
  }
}

function assertCurrentBackup(backup) {
  if (backup?.format === BACKUP_FORMAT && backup?.version === BACKUP_VERSION) return backup;
  if (backup?.version === 1 && backup?.data) {
    throw new Error('Este backup legado é incompleto e não pode ser restaurado automaticamente. Gere um novo backup completo nesta versão do sistema.');
  }
  throw new Error('Backup incompatível.');
}

export function createBackupService(client) {
  if (!client?.workerRequest) throw new Error('Cliente de dados é obrigatório.');

  async function exportAll() {
    const backup = await client.workerRequest('/api/clinical/backup/export');
    return assertCurrentBackup(backup);
  }

  async function restoreAll(backup) {
    assertCurrentBackup(backup);
    return client.workerRequest('/api/clinical/backup/restore', { method: 'POST', body: backup });
  }

  return { exportAll, restoreAll, encryptBackup, decryptBackup };
}

export { BACKUP_TABLES as backupTables, BACKUP_FORMAT as backupFormat, BACKUP_VERSION as backupVersion };


// Office Open XML export. ZIP "store" entries keep the browser implementation
// dependency-free; clinical attachments are indexed but deliberately NOT copied
// into the unencrypted spreadsheet.
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SHEET_LABELS = {
  mothers:'Mães',babies:'Bebês',appointments:'Agenda',appointment_babies:'Agenda e bebês',
  clinical_encounters:'Atendimentos',clinical_encounter_babies:'Bebês dos atendimentos',
  weights:'Pesagens',growth_measurements:'Crescimento',followups:'Acompanhamentos',
  financial_entries:'Financeiro',consents:'Consentimentos',library_items:'Biblioteca',
  media:'Mídias',clinical_media:'Mídias clínicas',clinical_document_templates:'Modelos de documentos',
  clinical_documents:'Documentos clínicos',clinical_encounter_addenda:'Adendos',
  clinical_note_revisions:'Revisões dos prontuários',care_packages:'Pacotes',
  care_package_items:'Itens dos pacotes',care_package_sessions:'Sessões dos pacotes',
  care_package_item_usages:'Utilização dos pacotes',professional_profiles:'Profissionais',
};
const XLSX_CELL_LIMIT = 30000;
const XLSX_ROWS_LIMIT = 1048576;
const XLSX_COLS_LIMIT = 16384;

function xmlEscape(value) {
  return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&apos;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
}

function excelCol(index) {
  let letters = '';
  do { letters = String.fromCharCode(65 + index % 26) + letters; index = Math.floor(index / 26) - 1; }
  while (index >= 0);
  return letters;
}

function normalizeCell(value) {
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  return String(value);
}

function safeCell(value) {
  // Explicit inline strings plus apostrophe prevent spreadsheet formula injection,
  // including values later copied into a CSV by a recipient.
  const content = normalizeCell(value);
  return /^[\s]*[=+\-@\t\r]/u.test(content) ? "'" + content : content;
}

function buildCells(rowNumber, columns, style = 0) {
  let xml = '<row r="' + rowNumber + '">';
  for (let i=0;i<columns.length;i++) {
    const content = safeCell(columns[i]);
    if (content === '') continue;
    if (content.length > 32767) throw new Error('Uma célula excede o limite do Excel.');
    const loc = excelCol(i) + rowNumber;
    xml += '<c r="' + loc + '" t="inlineStr"' + (style ? ' s="' + style + '"' : '') + '><is><t xml:space="preserve">' + xmlEscape(content) + '</t></is></c>';
  }
  return xml + '</row>';
}

function buildColumns(records, reserved) {
  const fields = new Map(reserved.map((key) => [key,1]));
  for (const entry of records) {
    for (const [key,value] of Object.entries(entry.record || {})) {
      const size = Math.max(1,Math.ceil(normalizeCell(value).length / XLSX_CELL_LIMIT));
      fields.set(key,Math.max(fields.get(key)||0,size));
    }
  }
  const names=[];
  for (const [field,count] of fields) {
    for (let part=0;part<count;part++) names.push({key:field,part,count,name:count===1?field:field+' (parte '+(part+1)+')'});
  }
  if (names.length > XLSX_COLS_LIMIT) throw new Error('Número de colunas acima do limite permitido pelo Excel.');
  return names;
}

function worksheet(name, records, { metadata = false } = {}) {
  const fieldNames = metadata ? Object.keys(records[0] || {}) : ['recordKey','sourceCreatedAt','sourceUpdatedAt'];
  const columns = metadata ? fieldNames.map((key)=>({key,part:0,count:1,name:key})) : buildColumns(records,fieldNames);
  const header = columns.map((item)=>item.name);
  let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  xml += '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
  xml += '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
  xml += '<sheetFormatPr defaultRowHeight="18"/><cols>';
  for(let j=0;j<columns.length;j++) xml += '<col min="'+(j+1)+'" max="'+(j+1)+'" width="'+(j===0?24:22)+'" customWidth="1"/>';
  xml += '</cols><sheetData>'+buildCells(1,header,1);
  for (let i=0;i<records.length;i++) {
    const entry=records[i];
    const row=columns.map(({key,part,count})=>{
      const value = metadata ? entry[key] : (key in entry ? entry[key] : entry.record?.[key]);
      const text=normalizeCell(value);
      return count===1 ? text : text.slice(part*XLSX_CELL_LIMIT,(part+1)*XLSX_CELL_LIMIT);
    });
    xml += buildCells(i+2,row);
  }
  xml += '</sheetData><autoFilter ref="A1:'+excelCol(columns.length-1)+Math.max(1,records.length+1)+'"/>';
  xml += '<sheetPr><tabColor rgb="FFEC92B0"/></sheetPr></worksheet>';
  return xml;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i=0;i<bytes.length;i++) {
    crc ^= bytes[i];
    for (let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  return (crc^0xffffffff)>>>0;
}

function zip32(view,pos,value) { view.setUint32(pos,value,true); }
function zip16(view,pos,value) { view.setUint16(pos,value,true); }

function storedZip(entries) {
  const parts=[], directory=[];
  let offset=0;
  for(const [name,xml] of entries) {
    const filename=encoder.encode(name), bytes=encoder.encode(xml);
    if (bytes.length > 0xffffffff || offset > 0xffffffff) throw new Error('Planilha grande demais para exportar.');
    const crc=crc32(bytes);
    const head=new Uint8Array(30+filename.length),v=new DataView(head.buffer);
    zip32(v,0,0x04034b50);zip16(v,4,20);zip16(v,6,0x0800);zip16(v,8,0);
    zip32(v,14,crc);zip32(v,18,bytes.length);zip32(v,22,bytes.length);zip16(v,26,filename.length);
    head.set(filename,30);
    parts.push(head,bytes);
    const central=new Uint8Array(46+filename.length),c=new DataView(central.buffer);
    zip32(c,0,0x02014b50);zip16(c,4,20);zip16(c,6,20);zip16(c,8,0x0800);zip16(c,10,0);
    zip32(c,16,crc);zip32(c,20,bytes.length);zip32(c,24,bytes.length);zip16(c,28,filename.length);
    zip32(c,42,offset);central.set(filename,46);directory.push(central);
    offset += head.length+bytes.length;
  }
  const centralSize=directory.reduce((size,item)=>size+item.length,0);
  if (offset+centralSize > 0xffffffff || entries.length>65535) throw new Error('Planilha grande demais para exportar.');
  const tail=new Uint8Array(22),end=new DataView(tail.buffer);
  zip32(end,0,0x06054b50);zip16(end,8,entries.length);zip16(end,10,entries.length);
  zip32(end,12,centralSize);zip32(end,16,offset);
  return new Blob([...parts,...directory,tail],{type:XLSX_MIME});
}

function xlsxEntries(sheets) {
  const contentTypes=[
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    ...sheets.map((_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'),
    '</Types>'
  ].join('');
  const rootRels='<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const workbook='<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+sheets.map((sheet,i)=>'<sheet name="'+xmlEscape(sheet.name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+'</sheets></workbook>';
  const rels='<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+sheets.map((_,i)=>'<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+'<Relationship Id="rId'+(sheets.length+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
  const styles='<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFBE638C"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>';
  return [
    ['[Content_Types].xml',contentTypes],['_rels/.rels',rootRels],
    ['xl/workbook.xml',workbook],['xl/_rels/workbook.xml.rels',rels],['xl/styles.xml',styles],
    ...sheets.map((sheet,i)=>['xl/worksheets/sheet'+(i+1)+'.xml',sheet.xml])
  ];
}

export async function createBackupWorkbook(backup) {
  if (backup?.format !== BACKUP_FORMAT || backup?.version !== BACKUP_VERSION) throw new Error('Dados incompatíveis com a planilha.');
  if (!backup.tables || typeof backup.tables !== 'object') throw new Error('Os dados de exportação estão incompletos.');
  const count=BACKUP_TABLES.reduce((total,table)=>total+(backup.tables[table]||[]).length,0);
  const sheets=[];
  const resume=[
    {campo:'Produto',valor:'Gestão Amamentação'},
    {campo:'Exportação',valor:backup.exportedAt||new Date().toISOString()},
    {campo:'Identificador da conta',valor:backup.ownerId||''},
    {campo:'Total de registros',valor:count},
    {campo:'Arquivos vinculados',valor:(backup.files||[]).length},
    {campo:'Proteção',valor:'ATENÇÃO: esta planilha não é criptografada. Guarde em local seguro.'},
    {campo:'Restauração',valor:'Para restaurar os dados no sistema, use o backup criptografado.'},
    ...BACKUP_TABLES.map((table)=>({campo:SHEET_LABELS[table],valor:(backup.tables[table]||[]).length}))
  ];
  sheets.push({name:'Resumo',xml:worksheet('Resumo',resume,{metadata:true})});
  for (const table of BACKUP_TABLES) {
    if (!Array.isArray(backup.tables[table])) throw new Error('Categoria ausente no backup: '+table);
    const rows=backup.tables[table];
    for(let start=0,page=1;start<Math.max(rows.length,1);start+=XLSX_ROWS_LIMIT-1,page++) {
      const items=rows.slice(start,start+XLSX_ROWS_LIMIT-1);
      const name=page===1?SHEET_LABELS[table]:(SHEET_LABELS[table].slice(0,26)+' '+page);
      sheets.push({name,xml:worksheet(name,items)});
    }
  }
  const files=(backup.files||[]).map((file)=>({
    bucket:file.bucket,path:file.path,size:file.size,mimeType:file.mimeType,
    sourceCreatedAt:file.sourceCreatedAt,sourceUpdatedAt:file.sourceUpdatedAt
  }));
  sheets.push({name:'Arquivos',xml:worksheet('Arquivos',files.length?files:[{bucket:'',path:'',size:'',mimeType:'',sourceCreatedAt:'',sourceUpdatedAt:''}],{metadata:true})});
  return storedZip(xlsxEntries(sheets));
}
