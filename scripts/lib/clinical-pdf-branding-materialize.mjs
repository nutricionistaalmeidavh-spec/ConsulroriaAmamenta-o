// Canonical materialization overlay: retain weekly plan and D1 persistence.
const PDF_PAGE_RENDERER="function pageCommands({ title, sections, layout, pageNumber, pageCount }) {\n  // Layout choices remain saved; clinical PDF branding is shared with referrals.\n  const commands=clinicalPdfHeader({heading:title,subheading:'Orientações de amamentação',\n    category:'DOCUMENTO CLÍNICO / PLANO DE CUIDADOS'});\n  let y=648;\n  for(const section of sections){\n    const bar=clinicalPdfSection(section.title,y);\n    commands.push(...bar.ops);y-=bar.height+12;\n    const lines=section.lines.flatMap(line=>wrapLine(line,78));\n    for(const line of lines){\n      commands.push('0.22 0.19 0.25 rg','BT','/F1 10 Tf','60 '+y+' Td','('+pdfEscape(line)+') Tj','ET');\n      y-=15;\n    }\n    y-=10;\n  }\n  commands.push(...clinicalPdfFooter(pageNumber,pageCount,{detail:'Documento '+pageNumber+'/'+pageCount}));\n  return commands.join('\\n')+'\\n';\n}\n";
const IOS_PLAN_ACTION="\n  // The clinical shell is loaded from a blob: module; use a fully qualified\n  // runtime URL rather than a relative static import.\n  const {isIosPdfViewer,showSavedIosReferralPdf}=await import(new URL('/referral-ios-pdf.js',globalThis.location.origin).href);\n  if(isIosPdfViewer()){\n    showSavedIosReferralPdf({pdf:blob,fileName:filename.replace(/\\.pdf$/i,''),\n      documentTitle:'Plano de cuidados pronto',\n      description:'Plano gerado. Toque para visualizar, salvar ou compartilhar sem sair do atendimento.',\n      shareTitle:'Plano de cuidados'});\n    toast('PDF pronto para visualizar ou compartilhar.', 'success');\n    return;\n  }";
function replaceExactlyOnce(source,needle,replacement,label){
  if(String(source).split(needle).length!==2)throw new Error('clinical-pdf-branding: noncanonical '+label);
  return source.replace(needle,replacement);
}
export function transformClinicalPdfBranding(source){
  let text=replaceExactlyOnce(String(source),
    'function latin1Bytes(value) {',
    "import {clinicalPdfHeader,clinicalPdfSection,clinicalPdfFooter} from '../../../referral-premium-pdf.js';\n\nfunction latin1Bytes(value) {",
    'pdf-import');
  const from=text.indexOf('function pageCommands(');
  const to=text.indexOf('\nfunction paginateSections(',from);
  if(from<0||to<=from)throw new Error('clinical-pdf-branding: missing page renderer');
  text=text.slice(0,from)+PDF_PAGE_RENDERER+text.slice(to);
  return replaceExactlyOnce(text,"title = 'Débora Lactação'","title = 'Plano de cuidados'",'pdf-title');
}
export function transformClinicalShellBranding(source){
  let text=String(source);
  text=replaceExactlyOnce(text,
    "createCarePlanPdf({ title: 'Débora Lactação',",
    "createCarePlanPdf({ title: 'Plano de cuidados',",
    'shell-title');
  const filename="  const filename = safePdfFilename(patient ? patientLabel(patient) : 'paciente');";
  return replaceExactlyOnce(text,filename,filename+IOS_PLAN_ACTION,'shell-ios');
}
export function applyClinicalPdfBranding(resolved,sourceByPath){
  for(const [path,transform] of [
    ['core/lib/pdf-service.js',transformClinicalPdfBranding],
    ['core/app-shell.js',transformClinicalShellBranding]
  ]){
    const existing=resolved.get(path);
    if(!existing)throw new Error('clinical-pdf-branding: missing '+path);
    const result=transform(Buffer.from(existing).toString('utf8'));
    resolved.set(path,new Uint8Array(Buffer.from(result,'utf8')));
    sourceByPath.set(path,sourceByPath.get(path)+'+clinical-pdf-branding');
  }
}
