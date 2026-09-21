(() => {
  const FINANCE_DEMO_PATIENT = 'Mariana Alves';
  const SCREEN_ASSETS = [
    ['Dashboard', '/comercial/assets/screens/dashboard.webp'],
    ['Agenda', '/comercial/assets/screens/agenda.webp'],
    ['Financeiro', null],
    ['Cadastro da paciente', '/comercial/assets/screens/nova-paciente.webp'],
    ['Dados do bebê', '/comercial/assets/screens/bebe.webp'],
    ['Ações rápidas', '/comercial/assets/screens/acoes-rapidas.webp'],
  ];

  function financeDemoMarkup() {
    return `
      <div class="sales-finance-demo" role="img" aria-label="Tela demonstrativa do financeiro com dados inteiramente fictícios">
        <div class="sales-finance-demo__top">
          <span><small>Financeiro</small><strong>Visão financeira</strong></span>
          <span class="sales-finance-demo__badge">DADOS FICTÍCIOS</span>
        </div>
        <div class="sales-finance-demo__metrics">
          <div><small>Recebido no mês</small><strong>R$ 2.480,00</strong></div>
          <div><small>Pendente</small><strong>R$ 350,00</strong></div>
        </div>
        <div class="sales-finance-demo__section">
          <div class="sales-finance-demo__section-head"><strong>Pagamentos recentes</strong><small>Setembro</small></div>
          <div class="sales-finance-demo__payment">
            <span class="sales-finance-demo__avatar" aria-hidden="true">MA</span>
            <span class="sales-finance-demo__payment-copy"><strong>${FINANCE_DEMO_PATIENT}</strong><small>Consulta de amamentação</small></span>
            <strong class="sales-finance-demo__amount">R$ 280,00</strong>
          </div>
          <div class="sales-finance-demo__payment">
            <span class="sales-finance-demo__avatar" aria-hidden="true">FC</span>
            <span class="sales-finance-demo__payment-copy"><strong>Fernanda Costa</strong><small>Retorno de acompanhamento</small></span>
            <strong class="sales-finance-demo__amount">R$ 180,00</strong>
          </div>
          <p class="sales-finance-demo__privacy">Prévia comercial reconstruída com nomes e valores demonstrativos. Nenhum dado de paciente real é exibido.</p>
        </div>
      </div>`;
  }

  function applyAssetFixes() {
    document.querySelectorAll('.sales-brand-mark img').forEach((img) => {
      img.src = '/icon.svg';
    });

    const hero = document.querySelector('.sales-hero-shot img');
    if (hero) hero.src = '/comercial/assets/screens/dashboard.webp';

    document.querySelectorAll('.sales-screen-card').forEach((card, index) => {
      const asset = SCREEN_ASSETS[index];
      const media = card.querySelector('.sales-screen-media');
      if (!asset || !media) return;

      if (asset[0] === 'Financeiro') {
        card.dataset.privacySafe = 'true';
        media.innerHTML = financeDemoMarkup();
        return;
      }

      const img = media.querySelector('img');
      if (!img || !asset[1]) return;
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
