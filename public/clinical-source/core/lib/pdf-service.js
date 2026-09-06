function latin1Bytes(value) {
  const text = String(value ?? '');
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    bytes[i] = code <= 255 ? code : 63;
  }
  return bytes;
}

function byteLength(value) { return latin1Bytes(value).length; }
function pdfEscape(value) { return String(value ?? '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }

function wrapLine(value, limit = 78) {
  const words = String(value ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > limit && line) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function buildPdf(objects, comment = '') {
  let body = `%PDF-1.4\n%âãÏÓ\n${comment ? `%LAYOUT:${comment}\n` : ''}`;
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets[i + 1] = byteLength(body);
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return latin1Bytes(body);
}

export const pdfLayouts = [
  { id: 'acolhedor', label: 'Acolhedor', description: 'Rosa suave e verde, pensado para entregar à família.' },
  { id: 'clinico', label: 'Clínico', description: 'Mais técnico e organizado, com aparência de relatório.' },
  { id: 'minimalista', label: 'Minimalista', description: 'Branco, leve e econômico para impressão.' }
];

export function normalizePdfLayout(value = 'acolhedor') {
  return pdfLayouts.some((layout) => layout.id === value) ? value : 'acolhedor';
}

export function safePdfFilename(label = 'paciente') {
  const slug = String(label || 'paciente').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'paciente';
  return `plano-amamentacao-${slug}.pdf`;
}

function formatDate(value) {
  if (!value) return new Intl.DateTimeFormat('pt-BR').format(new Date());
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(date);
}

function patientNames(patient = {}) {
  const mother = patient.mother?.name || 'Não informado';
  const babies = (patient.babies?.length ? patient.babies : patient.baby ? [patient.baby] : []).map((baby) => baby.name).filter(Boolean);
  return { mother, babies: babies.length ? babies : ['Não informado'] };
}

function structuredSections({ patient = {}, encounter = {}, text = '' } = {}) {
  const names = patientNames(patient);
  if (text && !encounter?.objectives && !encounter?.instructions) {
    return [
      { title: 'Família', lines: [`Mãe: ${names.mother}`, `Bebê(s): ${names.babies.join(' e ')}`] },
      { title: 'Plano de cuidado', lines: String(text).split(/\r?\n/) }
    ];
  }
  const sections = [
    { title: 'Família', lines: [`Mãe: ${names.mother}`, `Bebê(s): ${names.babies.join(' e ')}`, `Data: ${formatDate(encounter.occurredAt)}`] },
    { title: 'Motivo do atendimento', lines: [encounter.complaint || 'Não informado'] },
    { title: 'Objetivos', lines: [encounter.objectives || 'Não informado'] },
    { title: 'Orientações e condutas', lines: [encounter.instructions || 'Não informado'] },
    { title: 'Próximo acompanhamento', lines: [encounter.followup || 'A combinar'] }
  ];
  if (Array.isArray(encounter.babySummaries) && encounter.babySummaries.length) {
    sections.splice(2, 0, ...encounter.babySummaries.map((summary) => ({
      title: `Avaliação - ${summary.name || 'Bebê'}`,
      lines: [summary.details || 'Sem observações específicas.']
    })));
  }
  return sections;
}

const THEMES = {
  acolhedor: {
    headerFill: '0.96 0.86 0.89', headerText: '0.20 0.34 0.27', accent: '0.37 0.55 0.44',
    sectionFill: '0.98 0.95 0.95', text: '0.18 0.18 0.18', line: '0.86 0.78 0.80'
  },
  clinico: {
    headerFill: '0.22 0.37 0.29', headerText: '1 1 1', accent: '0.22 0.37 0.29',
    sectionFill: '0.93 0.95 0.94', text: '0.12 0.16 0.14', line: '0.70 0.76 0.72'
  },
  minimalista: {
    headerFill: '1 1 1', headerText: '0.08 0.08 0.08', accent: '0.08 0.08 0.08',
    sectionFill: '1 1 1', text: '0.12 0.12 0.12', line: '0.78 0.78 0.78'
  }
};

function pageCommands({ title, sections, layout, pageNumber, pageCount }) {
  const theme = THEMES[layout];
  const commands = ['q'];
  if (layout !== 'minimalista') {
    commands.push(`${theme.headerFill} rg`, '0 752 595 90 re f');
  } else {
    commands.push(`${theme.line} RG`, '0.8 w', '44 748 m 551 748 l S');
  }
  commands.push('Q', 'BT', `/F2 22 Tf`, `${theme.headerText} rg`, '52 800 Td', `(${pdfEscape(title)}) Tj`, 'ET');
  commands.push('BT', '/F1 9 Tf', `${theme.headerText} rg`, '52 780 Td', '(Plano de cuidado em amamentação) Tj', 'ET');

  let y = 720;
  for (const section of sections) {
    const wrapped = section.lines.flatMap((line) => wrapLine(line, 82));
    const boxHeight = 30 + Math.max(1, wrapped.length) * 15;
    if (layout !== 'minimalista') {
      commands.push('q', `${theme.sectionFill} rg`, `44 ${y - boxHeight + 10} 507 ${boxHeight} re f`, 'Q');
    }
    commands.push('BT', '/F2 11 Tf', `${theme.accent} rg`, `52 ${y} Td`, `(${pdfEscape(section.title)}) Tj`, 'ET');
    let textY = y - 20;
    for (const line of wrapped) {
      commands.push('BT', '/F1 10 Tf', `${theme.text} rg`, `52 ${textY} Td`, `(${pdfEscape(line)}) Tj`, 'ET');
      textY -= 15;
    }
    if (layout === 'minimalista') commands.push('q', `${theme.line} RG`, '0.5 w', `52 ${textY + 5} m 543 ${textY + 5} l S`, 'Q');
    y -= boxHeight + 12;
  }

  commands.push('BT', '/F1 8 Tf', '0.42 0.42 0.42 rg', '52 28 Td', `(Débora Lactação  |  Documento ${pageNumber}/${pageCount}) Tj`, 'ET');
  return `${commands.join('\n')}\n`;
}

function paginateSections(sections, maxLines = 28) {
  const pages = [];
  let current = [];
  let used = 0;
  for (const section of sections) {
    const lines = section.lines.flatMap((line) => wrapLine(line, 82));
    const cost = Math.max(2, lines.length + 2);
    if (current.length && used + cost > maxLines) { pages.push(current); current = []; used = 0; }
    current.push({ ...section, lines });
    used += cost;
  }
  if (current.length) pages.push(current);
  return pages.length ? pages : [[{ title: 'Plano de cuidado', lines: ['Sem conteúdo informado.'] }]];
}

export function createCarePlanPdf({ title = 'Débora Lactação', text = '', layout = 'acolhedor', patient = {}, encounter = {} } = {}) {
  const selectedLayout = normalizePdfLayout(layout);
  const sections = structuredSections({ patient, encounter, text });
  const pages = paginateSections(sections);
  const pageCount = pages.length;
  const firstPageId = 3;
  const regularFontId = firstPageId + pageCount * 2;
  const boldFontId = regularFontId + 1;
  const objects = new Array(boldFontId);
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  const kids = pages.map((_, index) => `${firstPageId + index * 2} 0 R`).join(' ');
  objects[1] = `<< /Type /Pages /Count ${pageCount} /Kids [ ${kids} ] >>`;

  pages.forEach((pageSections, index) => {
    const pageId = firstPageId + index * 2;
    const contentId = pageId + 1;
    const stream = pageCommands({ title, sections: pageSections, layout: selectedLayout, pageNumber: index + 1, pageCount });
    objects[pageId - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId - 1] = `<< /Length ${byteLength(stream)} >>\nstream\n${stream}endstream`;
  });
  objects[regularFontId - 1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[boldFontId - 1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  return new Blob([buildPdf(objects, selectedLayout)], { type: 'application/pdf' });
}
