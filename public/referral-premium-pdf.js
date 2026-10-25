/* Branded PDF. Self-hosted / zero cost, exact logo paths from public/icon.svg. */
const LOGO=["M 191 177 L 184 169 L 183 169 L 179 166 L 177 166 L 173 164 L 165 164 L 164 165 L 161 165 L 157 167 L 152 172 L 151 175 L 149 177 L 147 177 L 143 180 L 144 182 L 144 185 L 143 186 L 143 189 L 142 190 L 143 191 L 143 195 L 144 196 L 145 200 L 149 205 L 155 208 L 156 209 L 155 210 L 152 210 L 149 208 L 147 208 L 139 204 L 135 200 L 134 200 L 128 193 L 124 185 L 121 182 L 117 180 L 115 180 L 114 181 L 114 189 L 116 192 L 116 194 L 119 200 L 122 203 L 122 204 L 126 208 L 127 208 L 133 213 L 139 216 L 145 217 L 146 218 L 150 218 L 151 219 L 164 219 L 165 218 L 173 217 L 181 213 L 189 205 L 192 199 L 192 197 L 193 196 L 193 183 L 192 182 Z","M 195 78 L 191 83 L 191 92 L 193 96 L 202 105 L 203 105 L 208 110 L 209 110 L 223 98 L 227 91 L 227 84 L 225 80 L 222 78 L 215 78 L 213 79 L 211 81 L 209 85 L 203 78 Z","M 133 33 L 131 35 L 131 38 L 130 39 L 130 42 L 129 43 L 128 50 L 126 53 L 125 58 L 119 70 L 117 72 L 115 76 L 112 79 L 112 80 L 98 94 L 98 95 L 93 100 L 93 101 L 86 109 L 86 110 L 80 118 L 79 121 L 77 123 L 69 139 L 69 141 L 68 142 L 68 144 L 67 145 L 67 147 L 66 148 L 66 150 L 64 154 L 63 164 L 62 165 L 62 191 L 63 192 L 63 197 L 64 198 L 64 201 L 65 202 L 67 210 L 73 222 L 75 224 L 77 228 L 80 231 L 80 232 L 94 245 L 110 254 L 112 254 L 113 255 L 115 255 L 116 256 L 118 256 L 122 258 L 132 259 L 133 260 L 156 260 L 157 259 L 167 258 L 168 257 L 176 255 L 182 252 L 184 250 L 187 249 L 193 244 L 194 244 L 205 233 L 205 232 L 208 229 L 208 228 L 212 223 L 216 215 L 216 213 L 218 210 L 218 208 L 220 204 L 220 201 L 221 200 L 221 197 L 222 196 L 222 190 L 223 189 L 223 172 L 222 171 L 222 165 L 221 164 L 220 157 L 217 151 L 217 149 L 214 143 L 212 141 L 211 138 L 206 132 L 206 131 L 200 125 L 200 124 L 187 112 L 186 112 L 183 109 L 182 109 L 180 107 L 177 106 L 175 104 L 168 100 L 175 106 L 175 107 L 182 114 L 182 115 L 189 123 L 189 124 L 193 129 L 195 134 L 197 136 L 199 140 L 199 142 L 201 145 L 201 147 L 202 148 L 202 150 L 204 154 L 204 157 L 205 158 L 205 163 L 206 164 L 206 183 L 205 184 L 205 189 L 204 190 L 204 193 L 203 194 L 202 199 L 196 211 L 193 214 L 193 215 L 180 228 L 179 228 L 174 232 L 168 235 L 166 235 L 163 237 L 157 238 L 156 239 L 152 239 L 151 240 L 130 240 L 129 239 L 125 239 L 124 238 L 119 237 L 108 231 L 104 227 L 103 227 L 96 219 L 95 216 L 92 212 L 92 210 L 90 206 L 90 203 L 89 202 L 89 188 L 90 187 L 90 184 L 95 174 L 102 166 L 103 166 L 106 163 L 110 161 L 112 161 L 113 160 L 119 160 L 125 163 L 128 163 L 130 162 L 131 160 L 135 156 L 136 156 L 136 154 L 137 153 L 139 153 L 140 152 L 140 150 L 142 148 L 149 148 L 150 147 L 150 136 L 151 135 L 152 130 L 154 128 L 159 118 L 159 114 L 160 113 L 160 103 L 159 102 L 158 96 L 154 88 L 149 81 L 144 71 L 144 69 L 142 66 L 142 64 L 140 61 L 140 59 L 139 58 L 139 56 L 137 52 L 136 44 L 135 43 L 135 39 L 134 38 L 134 35 Z"];
const P={purple:[.61,.43,.72],lavender:[.78,.64,.84],pink:[.95,.75,.82],blush:[.976,.953,.987],plum:[.32,.23,.39],ink:[.22,.19,.25],gray:[.48,.44,.51],rule:[.88,.83,.90]};
const f=n=>Number(n).toFixed(2),color=c=>c.map(f).join(' ');
const CP=new Map([['€',128],['…',133],['‘',145],['’',146],['“',147],['”',148],['•',149],['–',150],['—',151]]);
function enc(v){const r=[];for(const c of String(v)){const n=c.codePointAt(0);r.push(n<=127||(n>=160&&n<=255)?n:(CP.get(c)||63))}return Uint8Array.from(r)}
const esc=v=>String(v).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)').replace(/[\r\n]/g,' ');
const txt=(v,x,y,size=10,bold=false,col=P.ink)=>color(col)+' rg\nBT /'+(bold?'F2':'F1')+' '+f(size)+' Tf '+f(x)+' '+f(y)+' Td ('+esc(v)+') Tj ET';
const rect=(x,y,w,h,c)=>color(c)+' rg\n'+[x,y,w,h].map(f).join(' ')+' re f';
const rule=(y)=>color(P.rule)+' RG\n42 '+f(y)+' m 553 '+f(y)+' l S';
function logo(x,y,w){
 const out=[];
 for(let i=0;i<25;i++){
  const t=i/24,a=[.663,.608,.812],b=[.769,.639,.831],c=[.953,.749,.820],q=t<.48?t/.48:(t-.48)/.52,m=t<.48?a:b,n=t<.48?b:c;
  out.push(rect(x+i*w/25,y,w/25+.1,w,m.map((v,j)=>v+(n[j]-v)*q)));
 }
 out.push('.98 .98 .97 rg');
 for(const path of LOGO){
  const tokens=path.match(/[MLZ]|-?\d+(?:\.\d+)?/g)||[];
  let cmd='',i=0;
  while(i<tokens.length){
   if(tokens[i]==='M'||tokens[i]==='L'||tokens[i]==='Z'){cmd=tokens[i++];if(cmd==='Z')out.push('h');continue}
   if(cmd==='M'||cmd==='L'){const vx=+tokens[i++],vy=+tokens[i++];out.push(f(x+vx*w/290)+' '+f(y+w-vy*w/290)+' '+(cmd==='M'?'m':'l'));if(cmd==='M')cmd='L'}
   else i++;
  }
  out.push('f');
 }
 return out.join('\n');
}
const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',bull:'•',mdash:'—',ndash:'–'};
const decode=s=>String(s).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi,(v,k)=>{
 if(k[0]==='#'){const hex=/^#x/i.test(k),n=parseInt(k.slice(hex?2:1),hex?16:10);return n>0&&n<0x110000?String.fromCodePoint(n):v}
 return entities[k.toLowerCase()]??v
});
export function parseReferralHtml(html=''){
 const source=String(html).replace(/<(script|style|iframe|object)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
 const parts=source.match(/<[^>]*>|[^<]+/g)||[],blocks=[],lists=[];
 let type='paragraph',runs=[],bold=0,n=0;
 const flush=()=>{const content=runs.map(r=>r.text).join('').trim();if(content)blocks.push({type,text:content,runs:runs.map(r=>({...r})),index:n});runs=[];type='paragraph';n=0};
 for(const token of parts){
  if(token[0]!=='<'){runs.push({text:decode(token).replace(/[ \t\r]+/g,' '),bold:bold>0});continue}
  const m=token.match(/^<\s*(\/)?\s*([a-z0-9]+)/i);if(!m)continue;
  const closing=!!m[1],tag=m[2].toLowerCase();
  if(tag==='strong'||tag==='b'){bold=Math.max(0,bold+(closing?-1:1));continue}
  if(tag==='br'&&!closing){runs.push({text:'\n',bold:bold>0});continue}
  if(tag==='ol'||tag==='ul'){if(closing)lists.pop();else lists.push({tag,count:0});continue}
  if(tag==='hr'&&!closing){flush();blocks.push({type:'end',text:'',runs:[]});continue}
  if(['h2','h3','p','li','div'].includes(tag)){
   if(closing){flush();continue}
   flush();type=tag==='h2'?'section':tag==='h3'?'subheading':tag==='li'?(lists.at(-1)?.tag==='ol'?'number':'bullet'):'paragraph';
   if(type==='number'&&lists.length){lists.at(-1).count++;n=lists.at(-1).count}
  }
 }
 flush();return blocks;
}
function measure(s,size){let n=0;for(const ch of s)n+=ch===' '?.29:/[ilI|.,:;!']/.test(ch)?.32:/[mwMW@%]/.test(ch)?.83:/[A-ZÁÀÂÃÉÍÓÔÕÚÇ]/.test(ch)?.65:.57;return n*size*1.035}
function linesFor(runs,width,size){
 let result=[[]],used=0;
 const breakLine=()=>{result.push([]);used=0};
 for(const r of runs){
  for(const chunk of r.text.split(/(\s+)/).filter(Boolean)){
   if(chunk.includes('\n')){const pieces=chunk.split('\n');for(let i=0;i<pieces.length;i++){if(i)breakLine();if(pieces[i]){result.at(-1).push({...r,text:pieces[i]});used+=measure(pieces[i],size)}}continue}
   const white=/^\s+$/.test(chunk),len=measure(chunk,size);
   if(white&&!result.at(-1).length)continue;
   if(!white&&used+len>width&&result.at(-1).length)breakLine();
   if(white&&used+len>width){breakLine();continue}
   if(!white&&len>width){for(const ch of chunk){const wc=measure(ch,size);if(used+wc>width&&result.at(-1).length)breakLine();result.at(-1).push({...r,text:ch});used+=wc}continue}
   result.at(-1).push({...r,text:chunk});used+=len;
  }
 }
 return result.filter((l,i)=>l.length||i===0);
}
function drawLine(runs,x,y,size,highlight=false){
 const ops=[];let dx=0,chunk='',bold=null;
 const flush=()=>{if(chunk){ops.push(txt(chunk,x+dx,y,size,!!bold,highlight?P.plum:P.ink));dx+=measure(chunk,size);chunk=''}};
 for(const r of runs){if(bold!==r.bold){flush();bold=r.bold}chunk+=r.text}
 flush();return ops;
}
function makePdf(title,pages){
 const n=pages.length,objs=[],f1=3+2*n,f2=f1+1,info=f2+1;
 objs[1]='<< /Type /Catalog /Pages 2 0 R >>';
 objs[2]='<< /Type /Pages /Kids ['+pages.map((_,i)=>(3+i*2)+' 0 R').join(' ')+'] /Count '+n+' >>';
 pages.forEach((page,i)=>{
  const a=3+2*i,b=a+1;
  const stream=page.concat([rule(65),txt('Gestão de Amamentação  •  Documento clínico',42,43,8,false,P.gray),txt('Página '+(i+1)+' de '+n,480,43,8,false,P.gray)]).join('\n');
  objs[a]='<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 '+f1+' 0 R /F2 '+f2+' 0 R >> >> /Contents '+b+' 0 R >>';
  objs[b]='<< /Length '+enc(stream).length+' >>\nstream\n'+stream+'\nendstream';
 });
 objs[f1]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
 objs[f2]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
 objs[info]='<< /Title ('+esc(title)+') /Creator (Gestão de Amamentação) >>';
 const chunks=[enc('%PDF-1.4\n%âãÏÓ\n')],offset=[0];let total=chunks[0].length;
 for(let i=1;i<=info;i++){offset[i]=total;const c=enc(i+' 0 obj\n'+objs[i]+'\nendobj\n');chunks.push(c);total+=c.length}
 const xs=['xref\n0 '+(info+1)+'\n','0000000000 65535 f \n'];
 for(let i=1;i<=info;i++)xs.push(String(offset[i]).padStart(10,'0')+' 00000 n \n');
 xs.push('trailer\n<< /Size '+(info+1)+' /Root 1 0 R /Info '+info+' 0 R >>\nstartxref\n'+total+'\n%%EOF');
 chunks.push(enc(xs.join('')));const out=new Uint8Array(chunks.reduce((sum,c)=>sum+c.length,0));let j=0;for(const c of chunks){out.set(c,j);j+=c.length}
 return new Blob([out],{type:'application/pdf'});
}
export function createPremiumReferralPdf({specialtyLabel='Encaminhamento',destination='',html='',finalizedAt=''}={}){
 const kind=String(specialtyLabel||'Encaminhamento'),blocks=parseReferralHtml(html),pages=[];
 let ops,y=645,active='';
 const start=()=>{
  ops=[];pages.push(ops);
  ops.push(rect(0,834,595,8,P.lavender));ops.push(rect(382,834,213,8,P.pink));
  ops.push(logo(42,755,42));
  ops.push(txt('GESTÃO DE AMAMENTAÇÃO',95,783,15,true,P.plum));
  ops.push(txt('DOCUMENTO CLÍNICO / ENCAMINHAMENTO PROFISSIONAL',95,769,8,false,P.gray));
  ops.push(rule(744));
  ops.push(txt('Encaminhamento profissional',42,715,19,true));
  ops.push(txt(kind.slice(0,56),42,693,11,true,P.purple));
  if(finalizedAt){const date=new Date(finalizedAt);if(!Number.isNaN(date.getTime()))ops.push(txt('Data: '+new Intl.DateTimeFormat('pt-BR').format(date),464,693,8,false,P.gray))}
  if(destination)ops.push(txt('Destino: '+String(destination).slice(0,85),42,670,9,false,P.gray));
  y=destination?647:665;
 };
 const section=(heading,continuation=false)=>{
  const label=continuation?heading+' (continuação)':heading;
  const headingLines=linesFor([{text:label,bold:true}],471,12.1);
  const height=36+16*(headingLines.length-1);
  ops.push(rect(42,y-height+6,511,height,P.blush));
  ops.push(rect(42,y-height+6,5,height,P.purple));
  headingLines.forEach((l,i)=>ops.push(...drawLine(l,57,y-14-i*16,12.1,true)));
  y-=height+13;
 };
 const ensure=(height)=>{if(y-height<90){start();if(active)section(active,true)}};
 start();
 for(const block of blocks){
  if(block.type==='section'){active=block.text;ensure(75);section(block.text);continue}
  if(block.type==='end'){active='';y-=12;continue}
  if(!block.text.trim())continue;
  const heading=block.type==='subheading',isList=block.type==='bullet'||block.type==='number',size=heading?11:10.1,lineH=heading?17:15;
  const left=active?60:51,indent=isList?18:0;
  const wrapped=linesFor(block.runs,534-left-indent,size);
  for(let i=0;i<wrapped.length;i++){
   ensure(lineH+5);
   if(active)ops.push(rect(48,y-3,2,lineH+1,P.lavender));
   if(i===0&&isList)ops.push(txt(block.type==='number'?block.index+'.':'•',left,y,size,true,P.purple));
   ops.push(...drawLine(wrapped[i],left+indent,y,size,heading));y-=lineH;
  }
  y-=heading?9:8;
 }
 return makePdf('Encaminhamento - '+kind,pages);
}
