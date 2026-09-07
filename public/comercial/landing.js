const root = document.documentElement;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Phase 2 is deliberately isolated from app.js so authentication and checkout
// keep their existing contracts and event flow.
const phase2Styles = document.createElement('link');
phase2Styles.rel = 'stylesheet';
phase2Styles.href = './phase2.css?v=20260907';
document.head.appendChild(phase2Styles);

const realPreviewStyles = document.createElement('link');
realPreviewStyles.rel = 'stylesheet';
realPreviewStyles.href = './real-preview.css?v=20260907b';
document.head.appendChild(realPreviewStyles);

root.classList.add('landing-motion-ready', 'phase2-visual');

const previewUrl = (screen) => `./product-preview.html?screen=${encodeURIComponent(screen)}&v=20260907b`;
const previewIframe = (screen, title, className = 'product-preview-frame') => `
  <iframe
    class="${className}"
    src="${previewUrl(screen)}"
    title="${title}"
    loading="lazy"
    tabindex="-1"
    aria-hidden="true"
    sandbox="allow-scripts allow-same-origin"
  ></iframe>
`;

// Replace the illustrative hero mockup with the real clinical UI structure/styles.
const heroVisual = document.querySelector('.hero-visual');
if (heroVisual) {
  heroVisual.innerHTML = `
    <div class="real-product-frame hero-real-preview" data-real-product-preview="home">
      <div class="real-window-bar" aria-hidden="true">
        <span class="real-window-dots"><i></i><i></i><i></i></span>
        <span class="real-window-address">app / visão do dia</span>
        <span class="real-window-status">online</span>
      </div>
      ${previewIframe('home', 'Prévia real do painel clínico')}
    </div>
  `;
}

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
  }, { threshold: 0.14, rootMargin: '0px 0px -6% 0px' });

  revealItems.forEach((element) => observer.observe(element));
}

const progress = document.querySelector('[data-scroll-progress]');
const updateProgress = () => {
  if (!progress) return;
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const value = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
  progress.style.transform = `scaleX(${value})`;
};
updateProgress();
window.addEventListener('scroll', updateProgress, { passive: true });
window.addEventListener('resize', updateProgress);

// Product story: every stage now points to a real screen from the clinical UI,
// rendered with demo-safe data inside product-preview.html.
const productStory = document.querySelector('.product-story');
const storyStage = document.querySelector('.story-stage');
const storySteps = [...document.querySelectorAll('.story-step')];
const stageLabels = [
  'Agenda e visão do dia',
  'Paciente, mãe e bebê',
  'Prontuário no atendimento',
  'Evolução e continuidade',
];
const previewScreenByStage = ['home', 'patients', 'appointment', 'patient'];

let activeStage = 0;
let stageCaption = null;
let storyPreview = null;
let storyPreviewTimer = null;

if (storyStage && storySteps.length) {
  storyStage.innerHTML = `
    <div class="real-story-window" data-real-story-window>
      ${previewIframe(previewScreenByStage[0], 'Prévia real do fluxo clínico')}
    </div>
  `;
  storyPreview = storyStage.querySelector('.product-preview-frame');
  if (storyPreview) storyPreview.dataset.previewScreen = previewScreenByStage[0];

  stageCaption = document.createElement('div');
  stageCaption.className = 'stage-caption';
  stageCaption.setAttribute('aria-live', 'polite');
  storyStage.prepend(stageCaption);

  storySteps.forEach((step, index) => {
    step.setAttribute('role', 'button');
    step.tabIndex = 0;
    step.dataset.storyIndex = String(index);
    step.setAttribute('aria-label', `${index + 1}. ${step.querySelector('strong')?.textContent || 'Etapa do fluxo'}`);

    const activateFromControl = () => setStoryStage(index);
    step.addEventListener('click', activateFromControl);
    step.addEventListener('focus', activateFromControl);
    step.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activateFromControl();
      }
    });
  });

  setStoryStage(0, false);
}

function setPreviewScreen(screen) {
  if (!storyPreview || !storyStage) return;
  if (storyPreview.dataset.previewScreen === screen) return;

  if (storyPreviewTimer) window.clearTimeout(storyPreviewTimer);
  storyStage.classList.add('is-changing');

  const commitChange = () => {
    storyPreview.src = previewUrl(screen);
    storyPreview.dataset.previewScreen = screen;
    storyStage.classList.remove('is-changing');
  };

  if (reduceMotion) {
    commitChange();
  } else {
    storyPreviewTimer = window.setTimeout(commitChange, 90);
  }
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
    window.scrollTo({
      top: sectionTop + available * ratio,
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
  }
}

storySteps.forEach((step, index) => {
  step.addEventListener('pointerdown', () => setStoryStage(index, true));
});

const updateStoryFromScroll = () => {
  if (!productStory || !storyStage || !storySteps.length) return;
  if (!window.matchMedia('(min-width: 1021px)').matches) return;

  const rect = productStory.getBoundingClientRect();
  const available = productStory.offsetHeight - window.innerHeight;
  if (available <= 0 || rect.top > 0 || rect.bottom < window.innerHeight * .45) return;

  const passed = Math.min(available, Math.max(0, -rect.top));
  const progressInside = passed / available;
  const nextStage = Math.min(
    storySteps.length - 1,
    Math.floor(progressInside * storySteps.length),
  );

  if (nextStage !== activeStage) setStoryStage(nextStage, false);
};
window.addEventListener('scroll', updateStoryFromScroll, { passive: true });
window.addEventListener('resize', updateStoryFromScroll);
updateStoryFromScroll();

// Put real product crops inside two Bento cards without changing their sales copy.
const featureCards = [...document.querySelectorAll('.feature-card')];
const featurePreviewMap = [
  { index: 0, screen: 'agenda', label: 'Agenda real' },
  { index: 3, screen: 'patient', label: 'Evolução real' },
];
featurePreviewMap.forEach(({ index, screen, label }) => {
  const card = featureCards[index];
  if (!card) return;
  card.classList.add('has-real-preview');
  const preview = document.createElement('div');
  preview.className = 'feature-real-preview';
  preview.innerHTML = `${previewIframe(screen, `${label} da plataforma`)}<span class="feature-preview-label">${label}</span>`;
  card.appendChild(preview);
});

// Pro is one product. Monthly and annual are billing choices inside the same card.
const proCard = document.querySelector('.price-card.pro');
if (proCard) {
  const priceStrong = proCard.querySelector('.price strong');
  const priceSuffix = proCard.querySelector('.price span');
  const proActions = proCard.querySelector('.pro-actions');
  const monthlyCta = proCard.querySelector('[data-plan="pro_monthly"]');
  const annualCta = proCard.querySelector('[data-plan="pro_annual"]');

  if (priceStrong && priceSuffix && proActions && monthlyCta && annualCta) {
    const billingSwitch = document.createElement('div');
    billingSwitch.className = 'billing-switch';
    billingSwitch.setAttribute('role', 'group');
    billingSwitch.setAttribute('aria-label', 'Forma de cobrança do plano Pro');
    billingSwitch.innerHTML = `
      <button type="button" data-billing="monthly">Mensal</button>
      <button type="button" data-billing="annual">Anual · economize</button>
    `;
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

    billingButtons.forEach((button) => {
      button.addEventListener('click', () => setBilling(button.dataset.billing || 'monthly'));
    });

    setBilling('monthly');
  }
}
