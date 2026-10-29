import {createPremiumReferralPdf,clinicalPdfHeader,clinicalPdfSection,clinicalPdfFooter} from './referral-premium-pdf.js';
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
  const safe=Number.isNaN(d.getTime())?new Date():d;
  const p=(n)=>String(n).padStart(2,'0');
  return `D:${safe.getFullYear()}${p(safe.getMonth()+1)}${p(safe.getDate())}${p(safe.getHours())}${p(safe.getMinutes())}${p(safe.getSeconds())}`;
}

function plainHtml(html='') {
  const source=String(html||'');
  if (typeof DOMParser === 'function') {
    const doc=new DOMParser().parseFromString(source,'text/html');
    return (doc.body?.innerText||doc.body?.textContent||'').replace(/\n{3,}/g,'\n\n').trim();
  }
  return source
    .replace(/<\s*br\s*\/?\s*>/gi,'\n')
    .replace(/<\/(p|li|div|h[1-6])>/gi,'\n')
    .replace(/<li[^>]*>/gi,'• ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&lt;/gi,'<')
    .replace(/&gt;/gi,'>')
    .replace(/&quot;/gi,'"')
    .replace(/&#39;/gi,"'")
    .replace(/[ \t]+/g,' ')
    .replace(/\n\s+/g,'\n')
    .replace(/\n{3,}/g,'\n\n')
    .trim();
}

function bodyParagraphs(body) {
  const values=Array.isArray(body)?body:[body];
  return values.flatMap(value=>String(value??'').split(/\n{2,}/)).map(value=>value.trim()).filter(Boolean);
}

function textOp(text,x,y,size=10,font='F1') {
  return ['BT',`/${font} ${size} Tf`,`${x} ${y} Td`,`(${escapePdfText(text)}) Tj`,'ET'].join('\n');
}

function layoutTextPages({heading,subheading='',sections=[]}) {
  const pages=[];let page=null;
  const newPage=()=>{
    page={ops:clinicalPdfHeader({heading,subheading,category:'DOCUMENTO CLÍNICO / PRONTUÁRIO'}),y:649};
    pages.push(page);
  };
  const ensure=(need=20)=>{if(!page||page.y-need<90)newPage()};
  newPage();
  for(const section of sections){
    const title=String(section?.title||'').trim(),paragraphs=bodyParagraphs(section?.body);
    if(title){
      let bar=clinicalPdfSection(title,page.y);
      ensure(bar.height+16);
      bar=clinicalPdfSection(title,page.y);
      page.ops.push(...bar.ops);page.y-=bar.height+13;
    }
    for(const paragraph of paragraphs){
      for(const line of wrap(paragraph,78)){
        ensure(16);
        page.ops.push('0.22 0.19 0.25 rg\n'+textOp(line,60,page.y,9.6,'F1'));
        page.y-=15;
      }
      page.y-=5;
    }
    page.y-=6;
  }
  return pages;
}

function concatBytes(parts){
  const total=parts.reduce((sum,part)=>sum+part.length,0),out=new Uint8Array(total);
  let offset=0;for(const part of parts){out.set(part,offset);offset+=part.length}return out;
}

function binaryObject(prefix,bytes,suffix='\nendstream'){
  return {prefix:String(prefix),bytes:bytes instanceof Uint8Array?bytes:new Uint8Array(bytes||[]),suffix:String(suffix)};
}

function objectChunk(ref,object){
  if(typeof object==='string')return encodeWinAnsi(`${ref} 0 obj\n${object}\nendobj\n`);
  return concatBytes([
    encodeWinAnsi(`${ref} 0 obj\n${object.prefix}`),
    object.bytes,
    encodeWinAnsi(`${object.suffix}\nendobj\n`)
  ]);
}

function normalizeImages(images=[]){
  return (Array.isArray(images)?images:[]).filter(item=>item&&item.bytes&&Number(item.width)>0&&Number(item.height)>0).map(item=>({
    bytes:item.bytes instanceof Uint8Array?item.bytes:new Uint8Array(item.bytes),
    width:Math.max(1,Math.round(Number(item.width))),
    height:Math.max(1,Math.round(Number(item.height))),
    caption:String(item.caption||'Imagem clínica')
  }));
}

function buildPagedPdf({title='Documento clínico',heading=title,subheading='',sections=[],images=[]}={}) {
  const textPages=layoutTextPages({heading,subheading,sections});
  const imageItems=normalizeImages(images);
  const pageDescriptors=[...textPages.map(page=>({kind:'text',page})),...imageItems.map(image=>({kind:'image',image}))];
  const pageCount=pageDescriptors.length||1;
  const imageCount=imageItems.length;
  const font1Ref=3+pageCount*2+imageCount;
  const font2Ref=font1Ref+1;
  const infoRef=font2Ref+1;
  const objects=[];
  const kids=[];
  objects[1]='<< /Type /Catalog /Pages 2 0 R >>';
  for(let i=0;i<pageCount;i++)kids.push(`${3+i*2} 0 R`);
  objects[2]=`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} >>`;
  let imageIndex=0;
  pageDescriptors.forEach((descriptor,index)=>{
    const pageRef=3+index*2,contentRef=pageRef+1;
    if(descriptor.kind==='text'){
      const ops=[...descriptor.page.ops,...clinicalPdfFooter(index+1,pageCount)];
      const stream=ops.join('\n'),streamBytes=encodeWinAnsi(stream);
      objects[pageRef]=`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font1Ref} 0 R /F2 ${font2Ref} 0 R >> >> /Contents ${contentRef} 0 R >>`;
      objects[contentRef]=`<< /Length ${streamBytes.length} >>\nstream\n${stream}\nendstream`;
      return;
    }
    const image=descriptor.image,imageRef=3+pageCount*2+imageIndex++;
    const maxW=487,maxH=505,scale=Math.min(maxW/image.width,maxH/image.height);
    const w=Math.max(1,image.width*scale),h=Math.max(1,image.height*scale),x=(595-w)/2,y=118+(maxH-h)/2;
    const caption=wrap(image.caption,78).slice(0,3);
    const ops=[...clinicalPdfHeader({heading:'Álbum clínico',category:'DOCUMENTO CLÍNICO / MÍDIAS'}),`q\n${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im1 Do\nQ`];
    caption.forEach((line,lineIndex)=>ops.push(textOp(line,54,96-lineIndex*13,8.5,'F1')));
    ops.push(...clinicalPdfFooter(index+1,pageCount));
    const stream=ops.join('\n'),streamBytes=encodeWinAnsi(stream);
    objects[pageRef]=`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font1Ref} 0 R /F2 ${font2Ref} 0 R >> /XObject << /Im1 ${imageRef} 0 R >> >> /Contents ${contentRef} 0 R >>`;
    objects[contentRef]=`<< /Length ${streamBytes.length} >>\nstream\n${stream}\nendstream`;
    objects[imageRef]=binaryObject(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`,image.bytes);
  });
  objects[font1Ref]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[font2Ref]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objects[infoRef]=`<< /Title (${escapePdfText(title)}) /Creator (Gestão de Amamentação) /CreationDate (${pdfDate()}) >>`;

  const chunks=[encodeWinAnsi('%PDF-1.4\n%âãÏÓ\n')];
  const offsets=[0];
  let length=chunks[0].length;
  for(let i=1;i<=infoRef;i++){
    offsets[i]=length;
    const chunk=objectChunk(i,objects[i]);
    chunks.push(chunk);length+=chunk.length;
  }
  const xrefOffset=length;
  const xref=[`xref\n0 ${infoRef+1}\n`,`0000000000 65535 f \n`];
  for(let i=1;i<=infoRef;i++)xref.push(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`);
  xref.push(`trailer\n<< /Size ${infoRef+1} /Root 1 0 R /Info ${infoRef} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  chunks.push(encodeWinAnsi(xref.join('')));
  return new Blob([concatBytes(chunks)],{type:'application/pdf'});
}

function fileName(value='documento') {
  return String(value || 'documento').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').toLowerCase() || 'documento';
}

export function createConsentPdf({motherName='Paciente', consentLabel='Termo', statusLabel='Não informado', acceptedAt='', revokedAt='', version='', evidence='', documentSections=[], modelVersion=''}={}) {
  const details=[
    `Paciente: ${motherName}`,
    `Status administrativo registrado: ${statusLabel}`,
    acceptedAt ? `Aceite anteriormente registrado em: ${acceptedAt}` : 'Sem data de aceite registrada.',
    revokedAt ? `Revogação registrada em: ${revokedAt}` : '',
    version ? `Versão do registro de consentimento: ${version}` : 'Versão do registro de consentimento: não informada.',
    modelVersion ? `Versão do modelo documental: ${modelVersion}` : '',
    evidence ? `Evidência administrativa registrada: ${evidence}` : 'Sem evidência de assinatura eletrônica verificada nesta cópia.'
  ].filter(Boolean);
  const sections=Array.isArray(documentSections)?documentSections.filter(section=>section&&section.title&&section.body):[];
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,character=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[character]);
  const allSections=[
    ...sections,
    {title:'Registro administrativo e histórico',body:details},
    {title:'Limites desta representação documental',body:'Este PDF reproduz o modelo informativo atual e o estado administrativo armazenado no prontuário. Não comprova assinatura eletrônica, leitura ou aceite da versão atual pela paciente. Modelos atualizados não alteram autorizações anteriores nem renovam consentimentos automaticamente. Uma autorização que exija assinatura ou manifestação específica deve ser colhida e comprovada no fluxo próprio. Alterações e revogações de permissões continuam sendo realizadas no cadastro da paciente; o PDF não substitui o registro eletrônico.'}
  ];
  const html=allSections.map(section=>[
    `<h2>${escapeHtml(section.title)}</h2>`,
    ...bodyParagraphs(section.body).map(paragraph=>`<p>${escapeHtml(paragraph)}</p>`)
  ].join('')).join('');
  // Reutiliza o MESMO renderizador de encaminhamentos: logo, faixa, seções,
  // tipografia, recuo, continuação, rodapé e paginação; sem layout paralelo.
  return createPremiumReferralPdf({
    specialtyLabel:consentLabel,
    html,
    documentLayout:{
      heading:'Termos e autorizações',
      subheading:consentLabel,
      category:'DOCUMENTO CLÍNICO / TERMOS E AUTORIZAÇÕES',
      pdfTitle:`${consentLabel} - ${motherName}`
    }
  });
}
export function createReferralPdf({motherName='Paciente',babyName='',specialtyLabel='Encaminhamento',destination='',html='',finalizedAt=''}={}) {
  // Canonical API retained; the user-authored referral body is the only source of clinical content.
  return createPremiumReferralPdf({specialtyLabel,destination,html,finalizedAt});
}

export function createRecordPdf({motherName='Paciente',modeLabel='Prontuário completo',subheading='',sections=[],images=[]}={}) {
  return buildPagedPdf({
    title:`${modeLabel} - ${motherName}`,
    heading:modeLabel,
    subheading:subheading||motherName,
    sections,
    images
  });
}

export function pdfFile(blob,name='documento-clinico') {
  return typeof File === 'function' ? new File([blob],`${fileName(name)}.pdf`,{type:'application/pdf'}) : null;
}

export function downloadPdf(blob,name='documento-clinico') {
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`${fileName(name)}.pdf`;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}

/** Open PDF in a separate tab without replacing the authenticated application on iOS. */
export function openPdfInNewTab(blob){
  const url=URL.createObjectURL(blob);
  let tab=null;
  try{
    tab=typeof window?.open==='function'?window.open(url,'_blank'):null;
  }catch(error){
    URL.revokeObjectURL(url);
    throw error;
  }
  if(!tab){
    URL.revokeObjectURL(url);
    throw new Error('O navegador bloqueou a abertura do PDF. Permita novas abas e tente novamente.');
  }
  try{tab.opener=null}catch{/* Some browser viewers restrict window access. */}
  setTimeout(()=>URL.revokeObjectURL(url),120000);
  return 'opened';
}

export async function sharePdf(blob,name='documento-clinico',title='Documento clínico',{preserveAppTab=false}={}){
  const file=pdfFile(blob,name);
  let canShareFiles=false;
  try{canShareFiles=Boolean(file&&navigator.share&&(!navigator.canShare||navigator.canShare({files:[file]})))}catch{/* Safari may reject capability detection. */}
  if(canShareFiles){
    await navigator.share({title,files:[file]});
    return 'shared';
  }
  if(preserveAppTab)return openPdfInNewTab(blob);
  downloadPdf(blob,name);
  return 'downloaded';
}
