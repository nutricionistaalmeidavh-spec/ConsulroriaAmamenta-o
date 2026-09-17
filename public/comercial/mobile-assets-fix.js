(() => {
  const SCREEN_ASSETS = [
    ['Dashboard', '/comercial/assets/screens/dashboard.webp'],
    ['Agenda', '/comercial/assets/screens/agenda.webp'],
    ['Financeiro', '/comercial/assets/screens/financeiro.webp'],
    ['Cadastro da paciente', '/comercial/assets/screens/nova-paciente.webp'],
    ['Dados do bebê', '/comercial/assets/screens/bebe.webp'],
    ['Ações rápidas', '/comercial/assets/screens/acoes-rapidas.webp'],
  ];

  function applyAssetFixes() {
    document.querySelectorAll('.sales-brand-mark img').forEach((img) => {
      img.src = '/icon.svg';
    });

    const hero = document.querySelector('.sales-hero-shot img');
    if (hero) hero.src = '/comercial/assets/screens/dashboard.webp';

    document.querySelectorAll('.sales-screen-card').forEach((card, index) => {
      const asset = SCREEN_ASSETS[index];
      const img = card.querySelector('.sales-screen-media img');
      if (!asset || !img) return;
      img.src = asset[1];
      img.alt = `${asset[0]} real do sistema de gestão para consultoras de amamentação`;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(applyAssetFixes), { once: true });
  } else {
    requestAnimationFrame(applyAssetFixes);
  }
})();
