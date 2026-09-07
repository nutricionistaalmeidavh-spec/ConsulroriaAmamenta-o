const root = document.documentElement;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
root.classList.add('landing-motion-ready');

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

const tilt = document.querySelector('[data-tilt]');
const finePointer = window.matchMedia('(pointer: fine)').matches;
if (tilt && finePointer && !reduceMotion) {
  tilt.addEventListener('pointermove', (event) => {
    const rect = tilt.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    tilt.style.setProperty('--tilt-x', `${(-y * 2.2).toFixed(2)}deg`);
    tilt.style.setProperty('--tilt-y', `${(x * 3).toFixed(2)}deg`);
  });
  tilt.addEventListener('pointerleave', () => {
    tilt.style.setProperty('--tilt-x', '0deg');
    tilt.style.setProperty('--tilt-y', '0deg');
  });
}
