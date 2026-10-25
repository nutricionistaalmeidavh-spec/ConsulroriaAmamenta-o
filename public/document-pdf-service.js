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

function layoutTextPages({heading,subheading='',sections=[],premiumReferral=false}) {
  const pages=[];
  let page=null,activeCard='';
  const newPage=()=>{
    if(premiumReferral){
      page={ops:[],y:698,premiumReferral:true};
      page.ops.push('0.77 0.64 0.83 rg 0 835 595 7 re f');
      page.ops.push('0.95 0.75 0.82 rg 384 835 211 7 re f');
      page.ops.push(referralLogoPdf(54,765,38));
      page.ops.push('0.35 0.24 0.43 rg');
      page.ops.push(textOp('Débora Lactação',104,791,16,'F2'));
      page.ops.push(textOp('GESTÃO DE AMAMENTAÇÃO | DOCUMENTO CLÍNICO',105,775,8,'F1'));
      page.ops.push('0.76 0.64 0.83 RG\n54 754 m\n541 754 l\nS');
      page.ops.push(textOp(heading,54,733,15,'F2'));
      if(subheading)page.ops.push(textOp(subheading,54,713,9,'F1'));
      pages.push(page);return;
    }
    page={ops:[],y:710};
    page.ops.push(textOp('Débora Lactação',54,790,17,'F2'));
    page.ops.push(textOp(heading,54,765,15,'F2'));
    if(subheading)page.ops.push(textOp(subheading,54,747,9,'F1'));
    page.ops.push('0.42 0.25 0.31 RG\n54 735 m\n541 735 l\nS');
    pages.push(page);
  };
  const ensure=(need=20)=>{
    if(!page)newPage();
    if(page.y-need<82){
      newPage();
      if(premiumReferral&&activeCard)drawCard(activeCard+' (continuação)');
    }
  };
  const drawCard=title=>{
    if(page.y<122)newPage();
    page.ops.push('0.967 0.928 0.975 rg\n54 '+(page.y-28)+' 487 36 re f');
    page.ops.push('0.62 0.44 0.73 rg\n54 '+(page.y-28)+' 5 36 re f');
    page.ops.push('0.35 0.24 0.43 rg');
    page.ops.push(textOp(title.slice(0,81),68,page.y-15,12,'F2'));
    page.y-=47;
  };
  newPage();
  for(const section of sections) {
    if(premiumReferral){
      const kind=section?.kind||'paragraph';
      if(kind==='card'){
        ensure(52);activeCard=String(section.title||'').trim();
        if(activeCard)drawCard(activeCard);continue;
      }
      if(kind==='end'){activeCard='';page.y-=10;continue}
      if(kind==='subheading'){
        const lines=wrap(String(section.title||''),78);
        ensure(lines.length*17+6);
        for(const label of lines){page.ops.push('0.39 0.26 0.48 rg');page.ops.push(textOp(label,activeCard?72:54,page.y,10.8,'F2'));page.y-=17}
        page.y-=6;continue;
      }
      for(const paragraph of bodyParagraphs(section.body)){
        const lines=wrap((kind==='list'?'• ':'')+paragraph,activeCard?76:84);
        for(const item of lines){
          ensure(17);
          if(activeCard)page.ops.push('0.80 0.70 0.87 rg\n58 '+(page.y-3)+' 2 16 re f');
          page.ops.push('0.22 0.19 0.26 rg');
          page.ops.push(textOp(item,activeCard?72:54,page.y,9.8,'F1'));
          page.y-=16;
        }
        page.y-=7;
      }
      continue;
    }
    const title=String(section?.title||'').trim();
    const paragraphs=bodyParagraphs(section?.body);
    if(title){
      ensure(28);
      page.ops.push(textOp(title,54,page.y,11,'F2'));
      page.y-=19;
    }
    for(const paragraph of paragraphs) {
      const lines=wrap(paragraph,88);
      for(const line of lines){
        ensure(16);
        page.ops.push(textOp(line,54,page.y,9.6,'F1'));
        page.y-=14;
      }
      page.y-=5;
    }
    page.y-=5;
  }
  return pages;
}


/* Only the referral PDF uses this renderer. All existing exports stay unchanged. */
const OFFICIAL_REFERRAL_LOGO_PATHS=["M 191 177 L 184 169 L 183 169 L 179 166 L 177 166 L 173 164 L 165 164 L 164 165 L 161 165 L 157 167 L 152 172 L 151 175 L 149 177 L 147 177 L 143 180 L 144 182 L 144 185 L 143 186 L 143 189 L 142 190 L 143 191 L 143 195 L 144 196 L 145 200 L 149 205 L 155 208 L 156 209 L 155 210 L 152 210 L 149 208 L 147 208 L 139 204 L 135 200 L 134 200 L 128 193 L 124 185 L 121 182 L 117 180 L 115 180 L 114 181 L 114 189 L 116 192 L 116 194 L 119 200 L 122 203 L 122 204 L 126 208 L 127 208 L 133 213 L 139 216 L 145 217 L 146 218 L 150 218 L 151 219 L 164 219 L 165 218 L 173 217 L 181 213 L 189 205 L 192 199 L 192 197 L 193 196 L 193 183 L 192 182 Z","M 195 78 L 191 83 L 191 92 L 193 96 L 202 105 L 203 105 L 208 110 L 209 110 L 223 98 L 227 91 L 227 84 L 225 80 L 222 78 L 215 78 L 213 79 L 211 81 L 209 85 L 203 78 Z","M 133 33 L 131 35 L 131 38 L 130 39 L 130 42 L 129 43 L 128 50 L 126 53 L 125 58 L 119 70 L 117 72 L 115 76 L 112 79 L 112 80 L 98 94 L 98 95 L 93 100 L 93 101 L 86 109 L 86 110 L 80 118 L 79 121 L 77 123 L 69 139 L 69 141 L 68 142 L 68 144 L 67 145 L 67 147 L 66 148 L 66 150 L 64 154 L 63 164 L 62 165 L 62 191 L 63 192 L 63 197 L 64 198 L 64 201 L 65 202 L 67 210 L 73 222 L 75 224 L 77 228 L 80 231 L 80 232 L 94 245 L 110 254 L 112 254 L 113 255 L 115 255 L 116 256 L 118 256 L 122 258 L 132 259 L 133 260 L 156 260 L 157 259 L 167 258 L 168 257 L 176 255 L 182 252 L 184 250 L 187 249 L 193 244 L 194 244 L 205 233 L 205 232 L 208 229 L 208 228 L 212 223 L 216 215 L 216 213 L 218 210 L 218 208 L 220 204 L 220 201 L 221 200 L 221 197 L 222 196 L 222 190 L 223 189 L 223 172 L 222 171 L 222 165 L 221 164 L 220 157 L 217 151 L 217 149 L 214 143 L 212 141 L 211 138 L 206 132 L 206 131 L 200 125 L 200 124 L 187 112 L 186 112 L 183 109 L 182 109 L 180 107 L 177 106 L 175 104 L 168 100 L 175 106 L 175 107 L 182 114 L 182 115 L 189 123 L 189 124 L 193 129 L 195 134 L 197 136 L 199 140 L 199 142 L 201 145 L 201 147 L 202 148 L 202 150 L 204 154 L 204 157 L 205 158 L 205 163 L 206 164 L 206 183 L 205 184 L 205 189 L 204 190 L 204 193 L 203 194 L 202 199 L 196 211 L 193 214 L 193 215 L 180 228 L 179 228 L 174 232 L 168 235 L 166 235 L 163 237 L 157 238 L 156 239 L 152 239 L 151 240 L 130 240 L 129 239 L 125 239 L 124 238 L 119 237 L 108 231 L 104 227 L 103 227 L 96 219 L 95 216 L 92 212 L 92 210 L 90 206 L 90 203 L 89 202 L 89 188 L 90 187 L 90 184 L 95 174 L 102 166 L 103 166 L 106 163 L 110 161 L 112 161 L 113 160 L 119 160 L 125 163 L 128 163 L 130 162 L 131 160 L 135 156 L 136 156 L 136 154 L 137 153 L 139 153 L 140 152 L 140 150 L 142 148 L 149 148 L 150 147 L 150 136 L 151 135 L 152 130 L 154 128 L 159 118 L 159 114 L 160 113 L 160 103 L 159 102 L 158 96 L 154 88 L 149 81 L 144 71 L 144 69 L 142 66 L 142 64 L 140 61 L 140 59 L 139 58 L 139 56 L 137 52 L 136 44 L 135 43 L 135 39 L 134 38 L 134 35 Z"];
function referralLogoPdf(x,y,w){
  const commands=[];
  const anchors=[[.663,.608,.812],[.769,.639,.831],[.953,.749,.820]];
  const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
  for(let i=0;i<18;i++){
    const t=i/17,c=t<.48?mix(anchors[0],anchors[1],t/.48):mix(anchors[1],anchors[2],(t-.48)/.52);
    commands.push(c.map(n=>n.toFixed(3)).join(' ')+' rg '+(x+i*w/18).toFixed(2)+' '+y+' '+(w/18+.12).toFixed(2)+' '+w+' re f');
  }
  commands.push('.98 .98 .97 rg');
  for(const path of OFFICIAL_REFERRAL_LOGO_PATHS){
    const tokens=path.match(/[MLZ]|-?\d+(?:\.\d+)?/g)||[];let i=0,mode='';
    while(i<tokens.length){
      if(['M','L','Z'].includes(tokens[i])){
        mode=tokens[i++];if(mode==='Z')commands.push('h');
      }else if(mode==='M'||mode==='L'){
        const px=Number(tokens[i++]),py=Number(tokens[i++]);
        commands.push((x+w*px/290).toFixed(3)+' '+(y+w*(290-py)/290).toFixed(3)+(mode==='M'?' m':' l'));
        if(mode==='M')mode='L';
      }else i++;
    }
    commands.push('f');
  }
  return commands.join('\n');
}
function decodeReferralEntities(value){
  const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',bull:'•',mdash:'—',ndash:'–'};
  return String(value).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi,(m,key)=>{
    if(key[0]==='#'){
      const isHex=key[1].toLowerCase()==='x',value=parseInt(key.slice(isHex?2:1),isHex?16:10);
      return Number.isFinite(value)&&value>0&&value<=0x10ffff?String.fromCodePoint(value):m;
    }
    return named[key.toLowerCase()]??m;
  });
}
function referralParagraphText(value){
  return decodeReferralEntities(String(value).replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,'')).replace(/[ \t]+/g,' ').trim();
}
export function referralLayoutBlocks(html=''){
  const safe=String(html).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
  const matches=/<(h2|h3|p|li)\b[^>]*>([\s\S]*?)<\/\1\s*>|<hr\b[^>]*\/?>/gi;
  const sections=[];
  const addText=(segment)=>{
    const value=referralParagraphText(segment);
    if(value)sections.push({kind:'paragraph',body:value});
  };
  let last=0,m;
  while((m=matches.exec(safe))){
    addText(safe.slice(last,m.index));
    if(/^<hr/i.test(m[0]))sections.push({kind:'end'});
    else{
      const body=referralParagraphText(m[2]);
      if(body)sections.push(m[1].toLowerCase()==='h2'?{kind:'card',title:body}:
        m[1].toLowerCase()==='h3'?{kind:'subheading',title:body}:
        m[1].toLowerCase()==='li'?{kind:'list',body:body}:{kind:'paragraph',body:body});
    }
    last=matches.lastIndex;
  }
  addText(safe.slice(last));
  return sections;
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

function buildPagedPdf({title='Documento clínico',heading=title,subheading='',sections=[],images=[],premiumReferral=false}={}) {
  const textPages=layoutTextPages({heading,subheading,sections,premiumReferral});
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
      const ops=[...descriptor.page.ops,textOp(`Página ${index+1} de ${pageCount}`,488,45,7.5,'F1'),textOp(premiumReferral?'Débora Lactação | Documento clínico':'Documento clínico gerado pelo prontuário Débora Lactação.',54,45,7.5,'F1')];
      const stream=ops.join('\n'),streamBytes=encodeWinAnsi(stream);
      objects[pageRef]=`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font1Ref} 0 R /F2 ${font2Ref} 0 R >> >> /Contents ${contentRef} 0 R >>`;
      objects[contentRef]=`<< /Length ${streamBytes.length} >>\nstream\n${stream}\nendstream`;
      return;
    }
    const image=descriptor.image,imageRef=3+pageCount*2+imageIndex++;
    const maxW=487,maxH=590,scale=Math.min(maxW/image.width,maxH/image.height);
    const w=Math.max(1,image.width*scale),h=Math.max(1,image.height*scale),x=(595-w)/2,y=118+(maxH-h)/2;
    const caption=wrap(image.caption,78).slice(0,3);
    const ops=[textOp('Débora Lactação',54,790,17,'F2'),textOp('Álbum clínico',54,765,15,'F2'),'0.42 0.25 0.31 RG\n54 735 m\n541 735 l\nS',`q\n${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im1 Do\nQ`];
    caption.forEach((line,lineIndex)=>ops.push(textOp(line,54,96-lineIndex*13,8.5,'F1')));
    ops.push(textOp(`Página ${index+1} de ${pageCount}`,488,45,7.5,'F1'));
    const stream=ops.join('\n'),streamBytes=encodeWinAnsi(stream);
    objects[pageRef]=`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font1Ref} 0 R /F2 ${font2Ref} 0 R >> /XObject << /Im1 ${imageRef} 0 R >> >> /Contents ${contentRef} 0 R >>`;
    objects[contentRef]=`<< /Length ${streamBytes.length} >>\nstream\n${stream}\nendstream`;
    objects[imageRef]=binaryObject(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`,image.bytes);
  });
  objects[font1Ref]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[font2Ref]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objects[infoRef]=`<< /Title (${escapePdfText(title)}) /Creator (Débora Lactação) /CreationDate (${pdfDate()}) >>`;

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

export function createConsentPdf({motherName='Paciente', consentLabel='Termo', statusLabel='Não informado', acceptedAt='', revokedAt='', version='', evidence=''}={}) {
  const details=[
    `Paciente: ${motherName}`,
    `Status registrado: ${statusLabel}`,
    acceptedAt ? `Aceite registrado em: ${acceptedAt}` : '',
    revokedAt ? `Revogação registrada em: ${revokedAt}` : '',
    version ? `Versão do consentimento: ${version}` : '',
    evidence ? `Evidência registrada: ${evidence}` : ''
  ].filter(Boolean);
  return buildPagedPdf({
    title:`${consentLabel} - ${motherName}`,
    heading:consentLabel,
    subheading:motherName,
    sections:[
      {title:'Registro',body:details},
      {title:'Observação',body:'Este PDF é uma representação documental do consentimento armazenado no prontuário. Alterações futuras de consentimento devem ser realizadas no cadastro da paciente; o PDF não substitui o registro eletrônico.'}
    ]
  });
}

export function createReferralPdf({motherName='Paciente',babyName='',specialtyLabel='Encaminhamento',destination='',html='',finalizedAt=''}={}) {
  // motherName/babyName remain accepted for backward compatibility, but are
  // NOT injected into the body unless the consultora selected them in the editor.
  const date=finalizedAt?new Date(finalizedAt):null;
  const formatted=date&&!Number.isNaN(date.getTime())?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short'}).format(date):'';
  const details=[specialtyLabel,destination?'Destino: '+destination:'',formatted?'Emitido em '+formatted:''].filter(Boolean).join(' | ');
  return buildPagedPdf({
    title:'Encaminhamento - '+specialtyLabel,
    heading:'Encaminhamento profissional',
    subheading:details,
    sections:referralLayoutBlocks(html),
    premiumReferral:true
  });
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

export async function sharePdf(blob,name='documento-clinico',title='Documento clínico') {
  const file=pdfFile(blob,name);
  if(file&&navigator.share&&(!navigator.canShare||navigator.canShare({files:[file]}))){
    await navigator.share({title,files:[file]});
    return 'shared';
  }
  downloadPdf(blob,name);
  return 'downloaded';
}
