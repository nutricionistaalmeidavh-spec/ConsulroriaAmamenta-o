/**
 * Deterministic, offline-safe pre-finalization review. No clinical facts are inferred.
 * The returned html is unchanged. Warning about an empty card is advisory;
 * unresolved template instructions are blockers until edited by the consultora.
 */
const decode = value=>String(value||'').replace(/&(?:nbsp|amp|lt|gt|quot|apos);/gi,entity=>({
  '&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"
})[entity.toLowerCase()]||entity);
const text = html=>decode(String(html||'').replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ')).trim();
const unresolved = /\[(?:\s*)(?:Descreva|Resuma|Preencha|Informe|Insira|Digite|Escreva|Adicionar|Explique|Detalhe|Complete|Substitua|Nome\s+do)[^\]\r\n]{0,260}\]/gi;

export function reviewReferralContent(html=''){
 const raw=String(html||'');
 const blockers=[],warnings=[];
 const found=[...text(raw).matchAll(unresolved)].map(m=>m[0]);
 for(const item of new Set(found))blockers.push('Campo não preenchido: '+item);
 const headings=[...raw.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2\s*>/gi)];
 for(let i=0;i<headings.length;i++){
   const current=headings[i],start=current.index+current[0].length;
   const later=headings[i+1]?.index ?? raw.length;
   const delimiter=/<hr\b[^>]*\/?>/i.exec(raw.slice(start,later));
   const body=raw.slice(start,delimiter?start+delimiter.index:later);
   const title=text(current[1]);
   if(!title){warnings.push('Existe uma seção sem título.');continue}
   const withoutSubhead=body.replace(/<h3\b[^>]*>[\s\S]*?<\/h3\s*>/gi,'');
   if(!text(withoutSubhead))warnings.push('Seção sem conteúdo: '+title);
 }
 if(!text(raw))blockers.push('O encaminhamento está vazio.');
 return {html:raw,blockers,warnings,canFinalize:blockers.length===0};
}
