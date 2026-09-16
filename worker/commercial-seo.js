export const COMMERCIAL_CANONICAL_URL = 'https://deboralactacao.com/comercial/';
export const COMMERCIAL_SEO_TITLE = 'Sistema para Consultoras de Amamentação | Débora Lactação';
export const COMMERCIAL_SEO_DESCRIPTION = 'Sistema de gestão para consultoras de amamentação com agenda, prontuário, evolução, documentos e acompanhamento de pacientes. Comece grátis ou use o Pro.';

const COMMERCIAL_LANDING_PATHS = new Set(['/comercial', '/comercial/', '/comercial/index.html']);

export function isCommercialLandingPath(pathname) {
  return COMMERCIAL_LANDING_PATHS.has(pathname || '');
}

const COMMERCIAL_STRUCTURED_DATA = Object.freeze({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'SoftwareApplication',
      '@id': `${COMMERCIAL_CANONICAL_URL}#software`,
      name: 'Gestão para Consultoras de Amamentação',
      url: COMMERCIAL_CANONICAL_URL,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      inLanguage: 'pt-BR',
      description: COMMERCIAL_SEO_DESCRIPTION,
      featureList: [
        'Agenda de atendimentos',
        'Prontuário de mãe e bebê',
        'Evolução clínica',
        'Documentos e materiais',
        'Acompanhamento por paciente',
        'Upload de fotos e vídeos no plano Pro',
      ],
      offers: [
        { '@type': 'Offer', name: 'Freemium', price: '0', priceCurrency: 'BRL', url: COMMERCIAL_CANONICAL_URL, description: 'Plano gratuito para começar com até 3 mães/pacientes.' },
        { '@type': 'Offer', name: 'Pro mensal', price: '49.90', priceCurrency: 'BRL', url: COMMERCIAL_CANONICAL_URL, description: 'Plano Pro mensal com pacientes ilimitados e upload de fotos e vídeos.' },
      ],
    },
    {
      '@type': 'FAQPage',
      '@id': `${COMMERCIAL_CANONICAL_URL}#faq`,
      mainEntity: [
        { '@type': 'Question', name: 'Preciso instalar alguma coisa?', acceptedAnswer: { '@type': 'Answer', text: 'Não para usar a versão web. A plataforma funciona no celular e no computador pelo navegador.' } },
        { '@type': 'Question', name: 'Posso começar sem pagar?', acceptedAnswer: { '@type': 'Answer', text: 'Sim. O Freemium custa R$ 0 e libera o fluxo para até 3 mães/pacientes, sem upload de fotos e vídeos.' } },
        { '@type': 'Question', name: 'Qual é a diferença do Pro?', acceptedAnswer: { '@type': 'Answer', text: 'O Pro remove o limite de pacientes e libera upload de fotos e vídeos, mantendo os recursos do fluxo da plataforma.' } },
      ],
    },
  ],
});

function commercialSeoMarkup() {
  const structuredData = JSON.stringify(COMMERCIAL_STRUCTURED_DATA).replaceAll('<', '\\u003c');
  return [
    '  <!-- commercial-seo: managed at the edge so the sales flow remains untouched -->',
    '  <meta data-commercial-seo="true" name="robots" content="index,follow,max-image-preview:large">',
    `  <link rel="canonical" href="${COMMERCIAL_CANONICAL_URL}">`,
    '  <meta property="og:type" content="website">',
    '  <meta property="og:locale" content="pt_BR">',
    '  <meta property="og:site_name" content="Débora Lactação">',
    `  <meta property="og:title" content="${COMMERCIAL_SEO_TITLE}">`,
    `  <meta property="og:description" content="${COMMERCIAL_SEO_DESCRIPTION}">`,
    `  <meta property="og:url" content="${COMMERCIAL_CANONICAL_URL}">`,
    '  <meta name="twitter:card" content="summary">',
    `  <meta name="twitter:title" content="${COMMERCIAL_SEO_TITLE}">`,
    `  <meta name="twitter:description" content="${COMMERCIAL_SEO_DESCRIPTION}">`,
    '  <link rel="stylesheet" href="/comercial/mobile-sales-v2.css?v=20260915">',
    '  <script src="/comercial/mobile-sales-v2.js?v=20260915" defer></script>',
    `  <script type="application/ld+json">${structuredData}</script>`,
  ].join('\n');
}

export function injectCommercialSeoHtml(source) {
  if (typeof source !== 'string' || !source.includes('</head>')) return source;
  if (source.includes('data-commercial-seo="true"')) return source;

  let html = source.replace(/<title>[\s\S]*?<\/title>/i, `<title>${COMMERCIAL_SEO_TITLE}</title>`);
  html = html.replace(
    /<meta\s+name=["']description["'][^>]*>/i,
    `<meta name="description" content="${COMMERCIAL_SEO_DESCRIPTION}">`,
  );
  return html.replace('</head>', `${commercialSeoMarkup()}\n</head>`);
}

export async function withCommercialSeo(response) {
  if (!response || response.status !== 200) return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('text/html')) return response;

  const html = injectCommercialSeoHtml(await response.text());
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('x-artisys-seo-surface', 'commercial');
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
