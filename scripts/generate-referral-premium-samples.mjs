import {mkdir,writeFile} from 'node:fs/promises';
import {createReferralPdf} from '../public/document-pdf-service.js';

const dir='artifacts/referral-premium';
await mkdir(dir,{recursive:true});
const scenarios=[
 {file:'encaminhamento-pediatria.pdf',specialtyLabel:'Pediatria',destination:'Serviço de Pediatria (fictício)',html:[
  '<p>Prezada equipe,</p>',
  '<h2>Identificação selecionada</h2><p>Nome completo: Mariana Oliveira Fernandes</p>',
  '<h2>Queixa principal</h2><p>A mãe relata dificuldades ocasionais de pega e desconforto materno durante o início das mamadas.</p>',
  '<h3>Observação da mamada</h3><ul><li>Posicionamento ajustado com apoio de tronco e nuca.</li><li>Sucção e deglutição observadas na consulta.</li></ul>',
  '<hr><p>Solicito avaliação da equipe de Pediatria e agradeço a continuidade assistencial.</p>'
 ].join('')},
 {file:'encaminhamento-personalizado.pdf',specialtyLabel:'Fonoaudiologia',html:[
  '<p>Prezada colega,</p><h2>Observações escolhidas pela profissional</h2>',
  '<p>Registro de exemplo: sucção e coordenação observadas na avaliação fictícia.</p>',
  '<hr><p>O trecho final está fora da seção por escolha da consultora.</p>',
  '<h2>Objetivo da avaliação</h2><p>Solicito avaliação especializada conforme necessidade clínica relatada.</p>'
 ].join('')},
 {file:'encaminhamento-multipagina.pdf',specialtyLabel:'Outro',html:
  '<h2>Histórico detalhado</h2>'+
  Array.from({length:52},(_,i)=>'<p>Observação fictícia '+(i+1)+': texto clínico de exemplo para testar paginação e integridade. '.repeat(4)+'</p>').join('')+
  '<hr><h2>Considerações finais</h2><p>Última linha preservada.</p>'}
];
for(const {file,...opts} of scenarios){
 const pdf=createReferralPdf({...opts,finalizedAt:'2026-10-25T12:30:00-03:00'});
 const data=Buffer.from(await pdf.arrayBuffer());
 if(data.subarray(0,5).toString('latin1')!=='%PDF-')throw new Error('PDF inválido '+file);
 await writeFile(dir+'/'+file,data);
 console.log(file,data.length,'bytes');
}
