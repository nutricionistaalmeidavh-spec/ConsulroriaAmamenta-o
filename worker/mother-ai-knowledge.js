// Somente fontes públicas oficiais, com texto-resumo editorial curto.
// Nenhum prontuário ou documento privado é indexado, sincronizado ou enviado ao buscador.
// reviewed indica seleção editorial inicial; homologação clínica humana ainda é gate de produção.
export const BREASTFEEDING_SOURCES = Object.freeze([
  {
    id:'ms-aleitamento', reviewed:true, language:'pt-BR',
    title:'Ministério da Saúde — Amamentação',
    url:'https://www.gov.br/saude/pt-br/assuntos/saude-de-a-a-z/a/aleitamento-materno',
    keywords:['amamentação','aleitamento materno exclusivo','seis meses','6 meses','posicionamento','pega'],
    summary:'O Ministério da Saúde recomenda amamentação exclusiva nos primeiros seis meses. A mãe e o bebê precisam de posicionamento confortável e adequado durante as mamadas.'
  },
  {
    id:'ms-puericultura', reviewed:true, language:'pt-BR',
    title:'Ministério da Saúde — Primeira consulta do recém-nascido',
    url:'https://linhasdecuidado.saude.gov.br/portal/puericultura/unidade-de-atencao-primaria/recem-nascido/',
    keywords:['pega','boca aberta','posicionamento','nariz','queixo','lábios','livre demanda','mamar'],
    summary:'Na pega favorável, o bebê tem boca bem aberta, lábios voltados para fora, queixo junto à mama e nariz livre. As mamadas devem respeitar a demanda do bebê.'
  },
  {
    id:'who-feeding', reviewed:true, language:'pt-BR',
    title:'OMS — Alimentação de lactentes e crianças pequenas',
    url:'https://www.who.int/news-room/fact-sheets/detail/infant-and-young-child-feeding',
    keywords:['aleitamento materno exclusivo','seis meses','6 meses','dois anos','2 anos','alimentação complementar'],
    summary:'A OMS recomenda aleitamento materno exclusivo até seis meses e continuidade com alimentação complementar apropriada até dois anos ou mais.'
  },
  {
    id:'who-breastfeeding', reviewed:true, language:'pt-BR',
    title:'OMS — Perguntas e respostas sobre amamentação',
    url:'https://www.who.int/news-room/questions-and-answers/item/breastfeeding',
    keywords:['quantidade de leite','leite suficiente','fraldas molhadas','amamentar','frequência','produção de leite'],
    summary:'A OMS explica que observar crescimento, eliminação de urina e mamadas pode ajudar a acompanhar a alimentação; dúvidas sobre ganho de peso devem ser avaliadas por profissional de saúde.'
  }
]);

const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toLocaleLowerCase('pt-BR').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const stop = new Set('a as o os e de da do das dos no na por para com um uma em minha meu que qual quais como posso sobre tem ser esta estou tenho bebe'.split(' '));
function words(text) { return normalize(text).split(' ').filter(word=>word.length>=3 && !stop.has(word)); }
export function searchApprovedBreastfeedingSources(query, sources=BREASTFEEDING_SOURCES) {
  const terms=words(query).slice(0,24);
  if(!terms.length) return [];
  return sources.filter(source=>source.reviewed===true && /^https:\/\//.test(source.url) && source.id && source.title)
    .map(source=>{
      const title=normalize(source.title), keys=normalize((source.keywords||[]).join(' ')),summary=normalize(source.summary);
      const score=terms.reduce((sum,term)=>sum+(keys.split(' ').includes(term)?4:0)+(title.split(' ').includes(term)?2:0)+(summary.split(' ').includes(term)?1:0),0);
      return {source,score};
    }).filter(item=>item.score>=2).sort((a,b)=>b.score-a.score)
    .slice(0,3).map(({source})=>({id:source.id,title:source.title,url:source.url,summary:source.summary}));
}