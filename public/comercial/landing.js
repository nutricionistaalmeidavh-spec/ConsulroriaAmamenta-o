const root = document.documentElement;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function loadCss(href) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

// Visual-only layers. Authentication and checkout remain isolated in app.js.
loadCss('./phase2.css?v=20260907');
loadCss('./real-preview.css?v=20260907c');
loadCss('./logo-motion.css?v=20260907b');
loadCss('./mobile-fixes.css?v=20260907');
root.classList.add('landing-motion-ready', 'phase2-visual');

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const remap01 = (value, start, end) => clamp01((value - start) / Math.max(.0001, end - start));
const easeOutCubic = (value) => 1 - Math.pow(1 - clamp01(value), 3);

function logoSvgMarkup(idSuffix = 'main') {
  const gradientId = `commercial-logo-bg-${idSuffix}`;
  return `
    <svg class="brand-logo-motion" viewBox="0 0 290 290" role="img" aria-label="Marca da plataforma">
      <defs>
        <linearGradient id="${gradientId}" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stop-color="#a99bcf"></stop>
          <stop offset="0.48" stop-color="#c4a3d4"></stop>
          <stop offset="1" stop-color="#f3bfd1"></stop>
        </linearGradient>
      </defs>
      <rect width="290" height="290" fill="url(#${gradientId})"></rect>
      <g fill="#fffaf7">
        <path data-logo-part="mother" d="M 133 33 L 131 35 L 131 38 L 130 39 L 130 42 L 129 43 L 128 50 L 126 53 L 125 58 L 119 70 L 117 72 L 115 76 L 112 79 L 112 80 L 98 94 L 98 95 L 93 100 L 93 101 L 86 109 L 86 110 L 80 118 L 79 121 L 77 123 L 69 139 L 69 141 L 68 142 L 68 144 L 67 145 L 67 147 L 66 148 L 66 150 L 64 154 L 63 164 L 62 165 L 62 191 L 63 192 L 63 197 L 64 198 L 64 201 L 65 202 L 67 210 L 73 222 L 75 224 L 77 228 L 80 231 L 80 232 L 94 245 L 110 254 L 112 254 L 113 255 L 115 255 L 116 256 L 118 256 L 122 258 L 132 259 L 133 260 L 156 260 L 157 259 L 167 258 L 168 257 L 176 255 L 182 252 L 184 250 L 187 249 L 193 244 L 194 244 L 205 233 L 205 232 L 208 229 L 208 228 L 212 223 L 216 215 L 216 213 L 218 210 L 218 208 L 220 204 L 220 201 L 221 200 L 221 197 L 222 196 L 222 190 L 223 189 L 223 172 L 222 171 L 222 165 L 221 164 L 220 157 L 217 151 L 217 149 L 214 143 L 212 141 L 211 138 L 206 132 L 206 131 L 200 125 L 200 124 L 187 112 L 186 112 L 183 109 L 182 109 L 180 107 L 177 106 L 175 104 L 168 100 L 175 106 L 175 107 L 182 114 L 182 115 L 189 123 L 189 124 L 193 129 L 195 134 L 197 136 L 199 140 L 199 142 L 201 145 L 201 147 L 202 148 L 202 150 L 204 154 L 204 157 L 205 158 L 205 163 L 206 164 L 206 183 L 205 184 L 205 189 L 204 190 L 204 193 L 203 194 L 202 199 L 196 211 L 193 214 L 193 215 L 180 228 L 179 228 L 174 232 L 168 235 L 166 235 L 163 237 L 157 238 L 156 239 L 152 239 L 151 240 L 130 240 L 129 239 L 125 239 L 124 238 L 119 237 L 108 231 L 104 227 L 103 227 L 96 219 L 95 216 L 92 212 L 92 210 L 90 206 L 90 203 L 89 202 L 89 188 L 90 187 L 90 184 L 95 174 L 102 166 L 103 166 L 106 163 L 110 161 L 112 161 L 113 160 L 119 160 L 125 163 L 128 163 L 130 162 L 131 160 L 135 156 L 136 156 L 136 154 L 137 153 L 139 153 L 140 152 L 140 150 L 142 148 L 149 148 L 150 147 L 150 136 L 151 135 L 152 130 L 154 128 L 159 118 L 159 114 L 160 113 L 160 103 L 159 102 L 158 96 L 154 88 L 149 81 L 144 71 L 144 69 L 142 66 L 142 64 L 140 61 L 140 59 L 139 58 L 139 56 L 137 52 L 136 44 L 135 43 L 135 39 L 134 38 L 134 35 Z"></path>
        <path data-logo-part="baby" d="M 191 177 L 184 169 L 183 169 L 179 166 L 177 166 L 173 164 L 165 164 L 164 165 L 161 165 L 157 167 L 152 172 L 151 175 L 149 177 L 147 177 L 143 180 L 144 182 L 144 185 L 143 186 L 143 189 L 142 190 L 143 191 L 143 195 L 144 196 L 145 200 L 149 205 L 155 208 L 156 209 L 155 210 L 152 210 L 149 208 L 147 208 L 139 204 L 135 200 L 134 200 L 128 193 L 124 185 L 121 182 L 117 180 L 115 180 L 114 181 L 114 189 L 116 192 L 116 194 L 119 200 L 122 203 L 122 204 L 126 208 L 127 208 L 133 213 L 139 216 L 145 217 L 146 218 L 150 218 L 151 219 L 164 219 L 165 218 L 173 217 L 181 213 L 189 205 L 192 199 L 192 197 L 193 196 L 193 183 L 192 182 Z"></path>
        <path data-logo-part="heart" d="M 195 78 L 191 83 L 191 92 L 193 96 L 202 105 L 203 105 L 208 110 L 209 110 L 223 98 L 227 91 L 227 84 L 225 80 L 222 78 L 215 78 L 213 79 L 211 81 L 209 85 L 203 78 Z"></path>
      </g>
    </svg>`;
}

function setLogoPart(element, amount, scaleFrom, xFrom = 0, yFrom = 0) {
  if (!element) return;
  const eased = easeOutCubic(amount);
  const scale = scaleFrom + (1 - scaleFrom) * eased;
  element.style.opacity = String(eased);
  element.style.transform = `translate(${xFrom * (1 - eased)}px, ${yFrom * (1 - eased)}px) scale(${scale})`;
}

function mountLogoMotion(mark, { complete = false, suffix = 'mark' } = {}) {
  if (!mark) return null;
  mark.setAttribute('data-logo-motion', 'true');
  mark.innerHTML = logoSvgMarkup(suffix);
  const refs = {
    mark,
    mother: mark.querySelector('[data-logo-part="mother"]'),
    baby: mark.querySelector('[data-logo-part="baby"]'),
    heart: mark.querySelector('[data-logo-part="heart"]'),
    complete,
  };
  if (complete || reduceMotion) {
    setLogoPart(refs.mother, 1, 1);
    setLogoPart(refs.baby, 1, 1);
    setLogoPart(refs.heart, 1, 1);
    mark.dataset.logoStage = 'heart';
  }
  return refs;
}

const headerLogo = mountLogoMotion(document.querySelector('.site-header .brand-mark'), { suffix: 'header' });
mountLogoMotion(document.querySelector('.footer-brand .brand-mark'), { complete: true, suffix: 'footer' });
let logoMotionProgress = reduceMotion ? 1 : 0;
let logoMotionFrame = 0;

function updateLogoMotion() {
  if (!headerLogo || reduceMotion) return;
  const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  logoMotionProgress = clamp01(window.scrollY / max);

  // Keep the mother/drop present at the top; baby and heart arrive over the full page.
  setLogoPart(headerLogo.mother, 1, .92, 0, 4);
  setLogoPart(headerLogo.baby, remap01(logoMotionProgress, .08, .48), .58, 10, 10);
  setLogoPart(headerLogo.heart, remap01(logoMotionProgress, .44, .82), .38, -2, 8);

  headerLogo.mark.dataset.logoStage = logoMotionProgress < .25 ? 'mother' : logoMotionProgress < .62 ? 'baby' : 'heart';
}

function scheduleLogoMotion() {
  if (logoMotionFrame) return;
  logoMotionFrame = window.requestAnimationFrame(() => {
    logoMotionFrame = 0;
    updateLogoMotion();
  });
}
updateLogoMotion();
window.addEventListener('scroll', scheduleLogoMotion, { passive: true });
window.addEventListener('resize', scheduleLogoMotion);

function previewUrl(screen) {
  if (screen === 'library') return './product-preview-library.html?v=20260907';
  if (screen === 'media') return './product-preview-media.html?v=20260907';
  return `./product-preview.html?screen=${encodeURIComponent(screen)}&v=20260907c`;
}

function previewIframe(screen, title, className = 'product-preview-frame') {
  return `<iframe class="${className}" data-preview-screen="${screen}" src="${previewUrl(screen)}" title="${title}" loading="lazy" tabindex="-1" aria-hidden="true" sandbox="allow-scripts allow-same-origin"></iframe>`;
}

function injectCompactCrop(frame, screen) {
  const apply = () => {
    try {
      const doc = frame.contentDocument;
      if (!doc || doc.getElementById('commercial-card-crop')) return;
      const style = doc.createElement('style');
      style.id = 'commercial-card-crop';
      style.textContent = `
        body{overflow:hidden!important}
        .lactation-topbar,.lactation-bottom-nav,.preview-demo-note{display:none!important}
        .template-page.lactation-page{padding:16px 18px 28px!important}
        .page-heading{margin-bottom:10px!important;gap:10px!important}
        .page-heading h1{font-size:26px!important;margin-bottom:2px!important}
        .page-heading p{font-size:12px!important;margin-top:4px!important}
        .page-heading .ui-button-primary{min-height:34px!important;padding:7px 10px!important;font-size:11px!important}
        .patient-header{padding-top:0!important}
        .patient-title-row h1{font-size:25px!important}
        .preview-screen[data-preview-screen="agenda"] .agenda-card:nth-child(n+2){display:none!important}
        .preview-screen[data-preview-screen="patients"] .patient-card:nth-child(n+3){display:none!important}
        .preview-screen[data-preview-screen="appointment"] .final-actions{display:none!important}
        .preview-screen[data-preview-screen="patient"] .baby-selector-wrap{display:none!important}
        .preview-screen[data-preview-screen="patient"] .patient-detail-grid{margin-top:10px!important}
        .preview-screen[data-preview-screen="library"] .library-card:nth-child(n+3){display:none!important}
        .preview-screen[data-preview-screen="media"] .af-thumb:nth-child(n+3){display:none!important}
      `;
      doc.head.appendChild(style);
      doc.documentElement.dataset.commercialCrop = screen;
    } catch (_) {
      // Same-origin preview is expected; if unavailable, the unclipped fallback still renders.
    }
  };
  frame.addEventListener('load', apply, { once: true });
  if (frame.contentDocument?.readyState === 'complete') apply();
}

// Hero: rotate several distinct real screens instead of repeating the same screenshot.
const heroPreviewScreens = [
  { screen: 'home', label: 'Visão do dia', address: 'app / visão do dia' },
  { screen: 'agenda', label: 'Agenda', address: 'app / agenda' },
  { screen: 'patients', label: 'Pacientes', address: 'app / pacientes' },
  { screen: 'appointment', label: 'Prontuário', address: 'app / atendimento' },
  { screen: 'library', label: 'Materiais', address: 'app / biblioteca' },
  { screen: 'media', label: 'Fotos e vídeos Pro', address: 'app / mídias clínicas' },
];
const heroVisual = document.querySelector('.hero-visual');
let heroPreviewIndex = 0;
let heroPreviewTimer = null;
let heroPreviewFrame = null;
let heroPreviewMeta = null;
let heroPreviewAddress = null;
let heroPreviewControls = [];
let heroPointerStartX = null;

if (heroVisual) {
  heroVisual.innerHTML = `
    <div class="real-product-frame hero-real-preview" data-real-product-preview="home">
      <div class="real-window-bar" aria-hidden="true">
        <span class="real-window-dots"><i></i><i></i><i></i></span>
        <span class="real-window-address">app / visão do dia</span>
        <span class="real-window-status">online</span>
      </div>
      <div class="hero-preview-viewport">${previewIframe('home', 'Prévia real do painel clínico')}</div>
      <span class="hero-preview-meta">Visão do dia</span>
      <div class="hero-preview-controls" aria-label="Telas da plataforma">
        ${heroPreviewScreens.map((item, index) => `<button type="button" data-hero-preview="${index}" aria-label="Mostrar ${item.label}"${index === 0 ? ' class="is-active" aria-current="true"' : ''}></button>`).join('')}
      </div>
    </div>`;
  const shell = heroVisual.querySelector('.hero-real-preview');
  heroPreviewFrame = shell?.querySelector('.product-preview-frame') || null;
  heroPreviewMeta = shell?.querySelector('.hero-preview-meta') || null;
  heroPreviewAddress = shell?.querySelector('.real-window-address') || null;
  heroPreviewControls = [...(shell?.querySelectorAll('[data-hero-preview]') || [])];

  heroPreviewControls.forEach((button) => button.addEventListener('click', () => {
    setHeroPreview(Number(button.dataset.heroPreview || 0));
    startHeroPreviewRotation();
  }));

  shell?.addEventListener('pointerdown', (event) => {
    heroPointerStartX = event.clientX;
    stopHeroPreviewRotation();
  });
  shell?.addEventListener('pointerup', (event) => {
    if (heroPointerStartX == null) return;
    const delta = event.clientX - heroPointerStartX;
    heroPointerStartX = null;
    if (Math.abs(delta) > 36) setHeroPreview(heroPreviewIndex + (delta < 0 ? 1 : -1));
    startHeroPreviewRotation();
  });
  shell?.addEventListener('pointercancel', () => { heroPointerStartX = null; startHeroPreviewRotation(); });
  shell?.addEventListener('mouseenter', stopHeroPreviewRotation);
  shell?.addEventListener('mouseleave', startHeroPreviewRotation);
}

function setHeroPreview(index) {
  if (!heroPreviewFrame || !heroPreviewScreens.length) return;
  const nextIndex = (index + heroPreviewScreens.length) % heroPreviewScreens.length;
  const item = heroPreviewScreens[nextIndex];
  heroPreviewIndex = nextIndex;
  const shell = heroPreviewFrame.closest('.hero-real-preview');
  shell?.classList.add('is-changing');

  const commit = () => {
    heroPreviewFrame.src = previewUrl(item.screen);
    heroPreviewFrame.dataset.previewScreen = item.screen;
    if (heroPreviewMeta) heroPreviewMeta.textContent = item.label;
    if (heroPreviewAddress) heroPreviewAddress.textContent = item.address;
    heroPreviewControls.forEach((button, buttonIndex) => {
      const active = buttonIndex === nextIndex;
      button.classList.toggle('is-active', active);
      button.toggleAttribute('aria-current', active);
    });
    shell?.classList.remove('is-changing');
  };

  if (reduceMotion) commit(); else window.setTimeout(commit, 100);
}

function stopHeroPreviewRotation() {
  if (heroPreviewTimer) window.clearInterval(heroPreviewTimer);
  heroPreviewTimer = null;
}
function startHeroPreviewRotation() {
  stopHeroPreviewRotation();
  if (reduceMotion || document.hidden || !heroPreviewFrame) return;
  heroPreviewTimer = window.setInterval(() => setHeroPreview(heroPreviewIndex + 1), 4200);
}
document.addEventListener('visibilitychange', () => document.hidden ? stopHeroPreviewRotation() : startHeroPreviewRotation());
startHeroPreviewRotation();

// Reveal motion.
const revealItems = [...document.querySelectorAll('[data-reveal]')];
if (reduceMotion || !('IntersectionObserver' in window)) {
  revealItems.forEach((element) => element.classList.add('is-visible'));
} else {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const delay = Number(entry.target.dataset.revealDelay || 0);
      window.setTimeout(() => entry.target.classList.add('is-visible'), delay);
      observer.unobserve(entry.target);
    });
  }, { threshold: .14, rootMargin: '0px 0px -6% 0px' });
  revealItems.forEach((element) => observer.observe(element));
}

// Scroll progress.
const progress = document.querySelector('[data-scroll-progress]');
function updateProgress() {
  if (!progress) return;
  const max = document.documentElement.scrollHeight - window.innerHeight;
  progress.style.transform = `scaleX(${max > 0 ? clamp01(window.scrollY / max) : 0})`;
}
updateProgress();
window.addEventListener('scroll', updateProgress, { passive: true });
window.addEventListener('resize', updateProgress);

// Product story: stateful real-screen progression.
const productStory = document.querySelector('.product-story');
const storyStage = document.querySelector('.story-stage');
const storySteps = [...document.querySelectorAll('.story-step')];
const stageLabels = ['Agenda e visão do dia', 'Paciente, mãe e bebê', 'Prontuário no atendimento', 'Evolução e continuidade'];
const previewScreenByStage = ['home', 'patients', 'appointment', 'patient'];
let activeStage = 0;
let stageCaption = null;
let storyPreview = null;
let storyPreviewTimer = null;

if (storyStage && storySteps.length) {
  storyStage.innerHTML = `<div class="real-story-window" data-real-story-window>${previewIframe(previewScreenByStage[0], 'Prévia real do fluxo clínico')}</div>`;
  storyPreview = storyStage.querySelector('.product-preview-frame');
  stageCaption = document.createElement('div');
  stageCaption.className = 'stage-caption';
  stageCaption.setAttribute('aria-live', 'polite');
  storyStage.prepend(stageCaption);

  storySteps.forEach((step, index) => {
    step.setAttribute('role', 'button');
    step.tabIndex = 0;
    step.dataset.storyIndex = String(index);
    const activate = () => setStoryStage(index);
    step.addEventListener('click', activate);
    step.addEventListener('focus', activate);
    step.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); }
    });
    step.addEventListener('pointerdown', () => setStoryStage(index, true));
  });
  setStoryStage(0, false);
}

function setPreviewScreen(screen) {
  if (!storyPreview || !storyStage || storyPreview.dataset.previewScreen === screen) return;
  if (storyPreviewTimer) window.clearTimeout(storyPreviewTimer);
  storyStage.classList.add('is-changing');
  const commit = () => {
    storyPreview.src = previewUrl(screen);
    storyPreview.dataset.previewScreen = screen;
    storyStage.classList.remove('is-changing');
  };
  if (reduceMotion) commit(); else storyPreviewTimer = window.setTimeout(commit, 90);
}

function setStoryStage(index, scrollToStage = false) {
  if (!storyStage || !storySteps.length) return;
  const safeIndex = Math.max(0, Math.min(storySteps.length - 1, index));
  activeStage = safeIndex;
  storyStage.setAttribute('data-stage', String(safeIndex + 1));
  storySteps.forEach((step, stepIndex) => {
    const active = stepIndex === safeIndex;
    step.classList.toggle('is-active', active);
    step.setAttribute('aria-current', active ? 'step' : 'false');
  });
  if (stageCaption) stageCaption.textContent = stageLabels[safeIndex] || '';
  setPreviewScreen(previewScreenByStage[safeIndex] || 'home');

  if (scrollToStage && productStory && window.matchMedia('(min-width: 1021px)').matches) {
    const sectionTop = window.scrollY + productStory.getBoundingClientRect().top;
    const available = Math.max(0, productStory.offsetHeight - window.innerHeight);
    const ratio = storySteps.length > 1 ? safeIndex / (storySteps.length - 1) : 0;
    window.scrollTo({ top: sectionTop + available * ratio, behavior: reduceMotion ? 'auto' : 'smooth' });
  }
}

function updateStoryFromScroll() {
  if (!productStory || !storyStage || !storySteps.length || !window.matchMedia('(min-width: 1021px)').matches) return;
  const rect = productStory.getBoundingClientRect();
  const available = productStory.offsetHeight - window.innerHeight;
  if (available <= 0 || rect.top > 0 || rect.bottom < window.innerHeight * .45) return;
  const passed = Math.min(available, Math.max(0, -rect.top));
  const nextStage = Math.min(storySteps.length - 1, Math.floor((passed / available) * storySteps.length));
  if (nextStage !== activeStage) setStoryStage(nextStage, false);
}
window.addEventListener('scroll', updateStoryFromScroll, { passive: true });
window.addEventListener('resize', updateStoryFromScroll);
updateStoryFromScroll();

// Every Bento card receives a distinct real product screen.
const featureCards = [...document.querySelectorAll('.feature-card')];
const featurePreviewMap = [
  { index: 0, screen: 'agenda', label: 'Agenda real' },
  { index: 1, screen: 'patients', label: 'Pacientes reais' },
  { index: 2, screen: 'appointment', label: 'Prontuário real' },
  { index: 3, screen: 'patient', label: 'Evolução real' },
  { index: 4, screen: 'library', label: 'Biblioteca real' },
  { index: 5, screen: 'media', label: 'Mídia clínica real' },
];
featurePreviewMap.forEach(({ index, screen, label }) => {
  const card = featureCards[index];
  if (!card) return;
  card.classList.add('has-real-preview');
  card.querySelectorAll('.feature-visual, .feature-real-preview').forEach((node) => node.remove());
  const preview = document.createElement('div');
  preview.className = 'feature-real-preview';
  preview.dataset.previewScreen = screen;
  preview.innerHTML = `${previewIframe(screen, `${label} da plataforma`)}<span class="feature-preview-label">${label}</span>`;
  card.appendChild(preview);
  const frame = preview.querySelector('.product-preview-frame');
  if (frame) injectCompactCrop(frame, screen);
});

// Pro is one product; monthly and annual are billing choices inside it.
const proCard = document.querySelector('.price-card.pro');
if (proCard) {
  const priceStrong = proCard.querySelector('.price strong');
  const priceSuffix = proCard.querySelector('.price span');
  const proActions = proCard.querySelector('.pro-actions');
  const monthlyCta = proCard.querySelector('[data-plan="pro_monthly"]');
  const annualCta = proCard.querySelector('[data-plan="pro_annual"]');
  if (priceStrong && priceSuffix && proActions && monthlyCta && annualCta) {
    const oldSwitch = proCard.querySelector('.billing-switch');
    oldSwitch?.remove();
    const billingSwitch = document.createElement('div');
    billingSwitch.className = 'billing-switch';
    billingSwitch.setAttribute('role', 'group');
    billingSwitch.setAttribute('aria-label', 'Forma de cobrança do plano Pro');
    billingSwitch.innerHTML = '<button type="button" data-billing="monthly">Mensal</button><button type="button" data-billing="annual">Anual · economize</button>';
    proActions.before(billingSwitch);
    const billingButtons = [...billingSwitch.querySelectorAll('[data-billing]')];

    const setBilling = (mode) => {
      const annual = mode === 'annual';
      proCard.dataset.billing = annual ? 'annual' : 'monthly';
      priceStrong.textContent = annual ? 'R$ 499' : 'R$ 49,90';
      priceSuffix.textContent = annual ? '/ ano' : '/ mês';
      monthlyCta.hidden = annual;
      annualCta.hidden = !annual;
      if (annual) {
        annualCta.querySelector('strong').textContent = 'Assinar anual — R$ 499';
        annualCta.querySelector('small').textContent = 'até 12x no cartão';
      }
      billingButtons.forEach((button) => {
        const active = button.dataset.billing === mode;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    };
    billingButtons.forEach((button) => button.addEventListener('click', () => setBilling(button.dataset.billing || 'monthly')));
    setBilling('monthly');
  }
}

// Replace the horizontally clipped comparison with stacked plan cards on mobile.
const comparisonTable = document.querySelector('.comparison-table');
if (comparisonTable && !document.querySelector('.comparison-mobile')) {
  const rows = [...comparisonTable.querySelectorAll('.comparison-row')];
  const dataRows = rows.slice(1).map((row) => {
    const cells = [...row.children];
    return { label: cells[0]?.textContent.trim() || '', free: cells[1]?.textContent.trim() || '', pro: cells[2]?.textContent.trim() || '' };
  });
  const comparisonMobile = document.createElement('div');
  comparisonMobile.className = 'comparison-mobile';
  comparisonMobile.setAttribute('aria-label', 'Comparação dos planos no celular');
  comparisonMobile.innerHTML = [
    { name: 'Freemium', key: 'free', badge: 'R$ 0', className: 'free' },
    { name: 'Pro', key: 'pro', badge: 'Ilimitado', className: 'pro' },
  ].map((plan) => `
    <article class="comparison-mobile-card ${plan.className}">
      <header><h3>${plan.name}</h3><span>${plan.badge}</span></header>
      <dl>${dataRows.map((row) => `<div><dt>${row.label}</dt><dd>${row[plan.key]}</dd></div>`).join('')}</dl>
    </article>`).join('');
  comparisonTable.insertAdjacentElement('afterend', comparisonMobile);
}
