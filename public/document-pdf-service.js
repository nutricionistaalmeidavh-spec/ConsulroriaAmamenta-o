const CP1252 = new Map([
  ['€',0x80],['‚',0x82],['ƒ',0x83],['„',0x84],['…',0x85],['†',0x86],['‡',0x87],['ˆ',0x88],['‰',0x89],['Š',0x8A],['‹',0x8B],['Œ',0x8C],['Ž',0x8E],['‘',0x91],['’',0x92],['“',0x93],['”',0x94],['•',0x95],['–',0x96],['—',0x97],['˜',0x98],['™',0x99],['š',0x9A],['›',0x9B],['œ',0x9C],['ž',0x9E],['Ÿ',0x9F]
]);

function encodeWinAnsi(text='') {
  const bytes=[];
  for (const ch of String(text)) {
    const code=ch.codePointAt(0);
    if (code <= 0x7f || (code >= 0xa0 && code <= 0xff)) bytes.push(code);
    else if (CP1252.has(ch)) bytes.push(CP1252.get(ch));
    else bytes.push(0x3f);
  }
  return Uint8Array.from(bytes);
}

function escapePdfText(text='') {
  return String(text).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)').replace(/[\r\n]+/g,' ');
}

function wrap(text='', max=82) {
  const words=String(text || '').replace(/\s+/g,' ').trim().split(' ').filter(Boolean);
  if (!words.length) return [''];
  const lines=[];
  let line='';
  for (const word of words) {
    const candidate=line ? `${line} ${word}` : word;
    if (candidate.length > max && line) { lines.push(line); line=word; }
    else line=candidate;
  }
  if (line) lines.push(line);
  return lines;
}

function pdfDate(value=new Date()) {
  const d=value instanceof Date ? value : new Date(value);
  const p=(n)=>String(n).padStart(2,'0');
  return `D:${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function buildPageStream({heading, subheading, sections=[]}) {
  const ops=[];
  const addText=(text,x,y,size=10,font='F1')=>{
    ops.push('BT', `/${font} ${size} Tf`, `${x} ${y} Td`, `(${escapePdfText(text)}) Tj`, 'ET');
  };
  addText('Débora Lactação',54,790,17,'F2');
  addText(heading,54,765,15,'F2');
  if (subheading) addText(subheading,54,747,9,'F1');
  ops.push('0.42 0.25 0.31 RG','54 735 m','541 735 l','S');
  let y=710;
  for (const section of sections) {
    if (y < 92) break;
    if (section.title) {
      addText(section.title,54,y,11,'F2');
      y-=18;
    }
    const paragraphs=Array.isArray(section.body) ? section.body : [section.body];
    for (const paragraph of paragraphs) {
      for (const line of wrap(paragraph || '', 88)) {
        if (y < 72) break;
        addText(line,54,y,9.6,'F1');
        y-=14;
      }
      y-=5;
    }
    y-=4;
  }
  addText('Documento gerado a partir do prontuário da profissional. O registro de consentimento no sistema permanece como fonte de verdade.',54,45,7.5,'F1');
  return ops.join('\n');
}

function buildPdf({title='Documento clínico', heading=title, subheading='', sections=[]}={}) {
  const stream=buildPageStream({heading,subheading,sections});
  const streamBytes=encodeWinAnsi(stream);
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${streamBytes.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Title (${escapePdfText(title)}) /Creator (Débora Lactação) /CreationDate (${pdfDate()}) >>`
  ];
  const chunks=[encodeWinAnsi('%PDF-1.4\n%âãÏÓ\n')];
  const offsets=[0];
  let length=chunks[0].length;
  objects.forEach((obj,index)=>{
    offsets[index+1]=length;
    const chunk=encodeWinAnsi(`${index+1} 0 obj\n${obj}\nendobj\n`);
    chunks.push(chunk); length+=chunk.length;
  });
  const xrefOffset=length;
  const xref=[`xref\n0 ${objects.length+1}\n`,`0000000000 65535 f \n`];
  for(let i=1;i<=objects.length;i++) xref.push(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`);
  xref.push(`trailer\n<< /Size ${objects.length+1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  chunks.push(encodeWinAnsi(xref.join('')));
  const total=chunks.reduce((sum,c)=>sum+c.length,0), merged=new Uint8Array(total);
  let cursor=0; for (const chunk of chunks) { merged.set(chunk,cursor); cursor+=chunk.length; }
  return new Blob([merged], {type:'application/pdf'});
}

function fileName(value='documento') {
  return String(value || 'documento').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').toLowerCase() || 'documento';
}

export function createConsentPdf({motherName='Paciente', consentLabel='Termo', statusLabel='Não informado', acceptedAt='', revokedAt='', version='', evidence=''}={}) {
  const details=[
    `Paciente: ${motherName}`,
    `Status registrado: ${statusLabel}`,
    acceptedAt ? `Aceite registrado em: ${acceptedAt}` : '',
    revokedAt ? `Revogação registrada em: ${revokedAt}` : '',
    version ? `Versão do consentimento: ${version}` : '',
    evidence ? `Evidência registrada: ${evidence}` : ''
  ].filter(Boolean);
  return buildPdf({
    title:`${consentLabel} - ${motherName}`,
    heading:consentLabel,
    subheading:motherName,
    sections:[
      {title:'Registro', body:details},
      {title:'Observação', body:'Este PDF é uma representação documental do consentimento armazenado no prontuário. Alterações futuras de consentimento devem ser realizadas no cadastro da paciente; o PDF não substitui o registro eletrônico.'}
    ]
  });
}

export function pdfFile(blob, name='documento-clinico') {
  return typeof File === 'function' ? new File([blob], `${fileName(name)}.pdf`, {type:'application/pdf'}) : null;
}

export function downloadPdf(blob, name='documento-clinico') {
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=`${fileName(name)}.pdf`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}

export async function sharePdf(blob, name='documento-clinico', title='Documento clínico') {
  const file=pdfFile(blob,name);
  if (file && navigator.share && (!navigator.canShare || navigator.canShare({files:[file]}))) {
    await navigator.share({title,files:[file]});
    return 'shared';
  }
  downloadPdf(blob,name);
  return 'downloaded';
}
