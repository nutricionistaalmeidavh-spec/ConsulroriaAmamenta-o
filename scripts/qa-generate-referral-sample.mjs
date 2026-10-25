import {mkdir,writeFile} from 'node:fs/promises';
import {createReferralPdf} from '../public/document-pdf-service.js';
const root='artifacts/referral-phase34';
await mkdir(root,{recursive:true});
const html=[
  '<p>Prezada equipe de Pediatria,</p>',
  '<h2>Identificação selecionada pela consultora</h2>',
  '<p>Nome completo: Marina Oliveira Fernandes</p>',
  '<p>Nome do bebê: Elisa Oliveira Fernandes</p>',
  '<h2>Queixa e contexto</h2>',
  '<p>Família relata dificuldade de pega em algumas mamadas e desconforto materno no início da sucção. Informações fictícias utilizadas apenas para homologação do documento.</p>',
  '<h3>Observação da mamada</h3>',
  '<p>Durante a avaliação houve melhora do posicionamento e do conforto relatado após os ajustes.</p>',
  '<h2>Motivo do encaminhamento</h2>',
  '<p>Solicito avaliação profissional para investigação dos sinais relatados e acompanhamento individualizado.</p>',
  '<h3>Pontos para observação</h3>',
  '<ul><li>Revisar crescimento e evolução ponderal</li><li>Avaliar sinais clínicos conforme necessidade</li></ul>',
  '<hr>',
  '<p>Permaneço à disposição para esclarecimentos sobre o acompanhamento.</p>'
].join('');
const blob=createReferralPdf({motherName:'Paciente omitida do cabeçalho',specialtyLabel:'Pediatria',destination:'Dra. Sofia - Pediatria',html,finalizedAt:'2026-10-25T14:00:00-03:00'});
await writeFile(root+'/Encaminhamento_Exemplo_Premium.pdf',Buffer.from(await blob.arrayBuffer()));
console.log(JSON.stringify({bytes:blob.size,source:'fake QA fixture',path:root+'/Encaminhamento_Exemplo_Premium.pdf'}));
