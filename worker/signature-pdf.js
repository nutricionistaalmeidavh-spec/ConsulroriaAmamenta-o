import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export const MAX_SIGNATURE_PDF_BYTES = 4 * 1024 * 1024;
const enc=new TextEncoder();
const text=v=>String(v??'').trim();

export async function digestHex(bytes) {
  const raw=typeof bytes==='string'?enc.encode(bytes):bytes;
  const hash=await crypto.subtle.digest('SHA-256',raw);
  return Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');
}
export async function hmacHex(secret,message) {
  if(!text(secret))throw new Error('signature_seal_secret_missing');
  const k=await crypto.subtle.importKey('raw',enc.encode('sig-evidence-v1:'+secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const result=await crypto.subtle.sign('HMAC',k,enc.encode(message));
  return Array.from(new Uint8Array(result),x=>x.toString(16).padStart(2,'0')).join('');
}
export async function checkPdf(bytes) {
  const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  if(data.length<64||data.length>MAX_SIGNATURE_PDF_BYTES || new TextDecoder().decode(data.slice(0,5))!=='%PDF-')
    throw new TypeError('invalid_signature_pdf');
  const pdf=await PDFDocument.load(data,{updateMetadata:false});
  if(pdf.isEncrypted||!pdf.getPageCount()||pdf.getPageCount()>60)throw new TypeError('invalid_signature_pdf');
  return pdf;
}
export function parseSignature(input,expectedName) {
  if(!input||input.accepted!==true||input.read_document!==true)
    throw new TypeError('signature_explicit_consent_required');
  const legalName=text(input.full_name).replace(/\s+/g,' ');
  const expected=text(expectedName).replace(/\s+/g,' ');
  if(!legalName || legalName.length>130 || !expected || legalName.toLocaleLowerCase('pt-BR')!==expected.toLocaleLowerCase('pt-BR'))
    throw new TypeError('signature_name_mismatch');
  if(input.signature_mode==='typed') {
    if(text(input.signature_value)!==legalName)throw new TypeError('signature_typed_name_mismatch');
    return {mode:'typed',legalName,value:legalName,image:null};
  }
  if(input.signature_mode!=='drawn')throw new TypeError('signature_mode_invalid');
  const raw=text(input.signature_value);
  if(!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(raw)||raw.length>180000)
    throw new TypeError('signature_image_invalid');
  const buffer=Uint8Array.from(atob(raw.slice('data:image/png;base64,'.length)),c=>c.charCodeAt(0));
  if(buffer.length<100 || ![137,80,78,71,13,10,26,10].every((n,i)=>buffer[i]===n))
    throw new TypeError('signature_image_invalid');
  return {mode:'drawn',legalName,value:'',image:buffer};
}
export async function appendSignatureAnnex(pdfBytes,{requestId,documentTitle,signerName,role,isoTime,signature,sourceHash}) {
  const doc=await checkPdf(pdfBytes);
  const page=doc.addPage([595.28,841.89]);
  const brand=rgb(0.443,0.247,0.349),gray=rgb(0.37,0.35,0.39),muted=rgb(0.53,0.51,0.54);
  const regular=await doc.embedFont(StandardFonts.Helvetica);
  const bold=await doc.embedFont(StandardFonts.HelveticaBold);
  page.drawRectangle({x:0,y:815,width:595.28,height:26,color:brand});
  page.drawText('GESTAO AMAMENTACAO  /  REGISTRO DE ASSINATURA',{x:44,y:779,font:bold,size:12,color:brand});
  page.drawLine({start:{x:44,y:764},end:{x:550,y:764},thickness:0.7,color:muted});
  const line=(label,value,y)=>{page.drawText(label,{x:44,y,font:bold,size:10,color:brand});page.drawText(text(value).slice(0,91),{x:44,y:y-18,font:regular,size:11,color:gray})};
  line('Documento',documentTitle,728);
  line('Responsavel pela assinatura',signerName,671);
  line('Papel',role==='mother'?'Mae / responsavel':'Consultora',614);
  line('Data e hora do servidor (UTC)',isoTime,557);
  line('Identificador do documento',requestId,500);
  page.drawText('Assinatura eletronica declarada',{x:44,y:424,font:bold,size:11,color:brand});
  page.drawRectangle({x:44,y:290,width:507,height:118,borderColor:muted,borderWidth:0.8,color:rgb(1,1,1)});
  if(signature.mode==='drawn') {
    const image=await doc.embedPng(signature.image);
    const fit=image.scaleToFit(450,90);
    page.drawImage(image,{x:64,y:303,width:fit.width,height:fit.height});
  }else{
    page.drawText(signature.legalName.slice(0,75),{x:65,y:342,font:regular,size:19,color:brand});
    page.drawText('Assinatura por digitacao de nome',{x:65,y:312,font:regular,size:9,color:muted});
  }
  page.drawText('Integridade do documento recebido antes desta assinatura:',{x:44,y:247,font:regular,size:9,color:gray});
  page.drawText(sourceHash,{x:44,y:230,font:regular,size:8,color:gray});
  page.drawText('Registro vinculado a comprovantes e eventos de auditoria no sistema.',{x:44,y:185,font:regular,size:9,color:gray});
  page.drawText('Este anexo nao constitui, por si so, assinatura qualificada ICP-Brasil.',{x:44,y:167,font:regular,size:9,color:gray});
  page.drawLine({start:{x:44,y:100},end:{x:550,y:100},thickness:.6,color:muted});
  page.drawText('GESTAO AMAMENTACAO  |  Documento clinico',{x:44,y:82,font:regular,size:9,color:brand});
  const out=new Uint8Array(await doc.save({useObjectStreams:false}));
  if(out.length>MAX_SIGNATURE_PDF_BYTES*2)throw new TypeError('signature_pdf_too_large');
  return out;
}
