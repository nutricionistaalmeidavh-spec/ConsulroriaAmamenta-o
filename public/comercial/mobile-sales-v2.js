(() => {
  const PLAN_KEY = 'commercial.saas.plan-intent.v1';
  const screens = [
    ['Dashboard', 'Visão rápida do dia com atendimentos, follow-ups e financeiro.'],
    ['Agenda', 'Organize atendimentos presenciais, domiciliares e online.'],
    ['Financeiro', 'Acompanhe recebimentos, pendências e ticket médio.'],
    ['Cadastro da paciente', 'Mãe e bebê dentro do mesmo contexto de acompanhamento.'],
    ['Dados do bebê', 'Nascimento, peso, alimentação e informações do acompanhamento.'],
    ['Ações rápidas', 'Novo atendimento, paciente, follow-up e pagamento em poucos toques.'],
  ];

  function sourceTrigger(view, plan = '') {
    const selector = plan
      ? `[data-legacy-commercial] [data-open="${view}"][data-plan="${plan}"]`
      : `[data-legacy-commercial] [data-open="${view}"]`;
    return document.querySelector(selector);
  }

  function openCommercial(view, plan = '') {
    if (plan) sessionStorage.setItem(PLAN_KEY, plan);
    const exact = sourceTrigger(view, plan);
    const fallback = sourceTrigger(view);
    (exact || fallback)?.click();
  }

  function purchaseCard({ eyebrow, title, text, price, plan, cta, secondary = false }) {
    return `
      <article class="sales-purchase-card${secondary ? ' is-secondary' : ''}" data-purchase-card>
        <span class="sales-kicker">${eyebrow}</span>
        <h3>${title}</h3>
        <p>${text}</p>
        <div class="sales-purchase-row">
          <strong>${price}</strong>
          <button class="sales-button" type="button" data-sales-open="signup" data-plan="${plan}">${cta}<span aria-hidden="true">→</span></button>
        </div>
      </article>`;
  }

  function render() {
    if (document.querySelector('.sales-v2')) return;
    const legacyHeader = document.querySelector('.site-header');
    const legacyMain = document.querySelector('main');
    const legacyFooter = document.querySelector('.site-footer');
    [legacyHeader, legacyMain, legacyFooter].forEach((node) => node?.setAttribute('data-legacy-commercial', 'true'));

    const shell = document.createElement('div');
    shell.className = 'sales-v2';
    shell.innerHTML = `
      <header class="sales-header">
        <a class="sales-brand" href="#inicio" aria-label="Débora Lactação — início">
          <span class="sales-brand-mark"><img src="../icon.svg" alt=""></span>
          <span><strong>Débora Lactação</strong><small>Sistema para Consultoras</small></span>
        </a>
        <button class="sales-login" type="button" data-sales-open="login">Entrar</button>
      </header>

      <main class="sales-main">
        <section class="sales-hero" id="inicio">
          <div class="sales-hero-copy">
            <span class="sales-kicker">Sistema para consultoras de amamentação</span>
            <h1>Seu atendimento mais <em>organizado, simples e profissional.</em></h1>
            <p>Agenda, pacientes, prontuário, acompanhamento, documentos e financeiro em um só lugar — pensado para a rotina de consultoras de amamentação.</p>
            <div class="sales-hero-actions">
              <button class="sales-button sales-button--primary" type="button" data-sales-open="signup" data-plan="freemium">Começar grátis <span aria-hidden="true">→</span></button>
              <a class="sales-button sales-button--ghost" href="#planos">Ver planos <span aria-hidden="true">↓</span></a>
            </div>
            <div class="sales-trust-row" aria-label="Benefícios principais">
              <span>Funciona no celular</span><span>Plano gratuito</span><span>Pro sem limite de pacientes</span>
            </div>
          </div>
          <figure class="sales-hero-shot">
            <img src="./assets/screens/dashboard.webp" width="430" height="775" alt="Tela inicial real do sistema para consultoras de amamentação com agenda, follow-ups e financeiro">
            <figcaption>Tela real do sistema · dados demonstrativos</figcaption>
          </figure>
        </section>

        <section class="sales-proof" id="produto">
          <div class="sales-section-head">
            <span class="sales-kicker">Conheça o sistema</span>
            <h2>Telas reais. Rotina real. Sem mockup antigo.</h2>
            <p>Veja como agenda, pacientes, prontuário e financeiro aparecem hoje na plataforma.</p>
          </div>
          <div class="sales-screen-strip" role="list">
            ${screens.map(([title, text, image]) => `
              <figure class="sales-screen-card" role="listitem">
                <div class="sales-screen-media"><img src="./assets/screens/${image}" alt="${title} real do sistema de gestão para consultoras de amamentação" loading="lazy" decoding="async"></div>
                <figcaption><strong>${title}</strong><span>${text}</span></figcaption>
              </figure>`).join('')}
          </div>
        </section>

        <section class="sales-buy-band">
          ${purchaseCard({
            eyebrow: 'Plano Pro',
            title: 'Pronta para deixar planilhas e informações espalhadas para trás?',
            text: 'Pacientes ilimitados, fotos e vídeos e todos os recursos da plataforma.',
            price: 'R$ 49,90/mês',
            plan: 'pro_monthly',
            cta: 'Quero o Pro',
          })}
        </section>

        <section class="sales-features" id="recursos">
          <div class="sales-section-head">
            <span class="sales-kicker">Funcionalidades em destaque</span>
            <h2>Feito para a rotina de quem acompanha mãe e bebê.</h2>
          </div>
          <div class="sales-feature-grid">
            <article><span>01</span><div><h3>Agenda inteligente</h3><p>Atendimentos presenciais, domiciliares e online organizados no mesmo fluxo.</p></div></article>
            <article><span>02</span><div><h3>Cadastro de mãe e bebê</h3><p>Informações relacionadas no mesmo contexto, sem fragmentar o acompanhamento.</p></div></article>
            <article><span>03</span><div><h3>Prontuário e evolução</h3><p>Registre atendimentos e consulte o histórico quando precisar.</p></div></article>
            <article><span>04</span><div><h3>Follow-ups</h3><p>Acompanhe retornos e contatos que precisam acontecer depois da consulta.</p></div></article>
            <article><span>05</span><div><h3>Financeiro</h3><p>Recebimentos, pendências e ticket médio de forma direta.</p></div></article>
            <article><span>06</span><div><h3>Documentos e materiais</h3><p>Mantenha arquivos e orientações associados à paciente correta.</p></div></article>
            <article><span>PRO</span><div><h3>Fotos e vídeos</h3><p>Registre mídias clínicas junto ao histórico no plano Pro.</p></div></article>
          </div>
        </section>

        <section class="sales-buy-band sales-buy-band--split">
          ${purchaseCard({
            eyebrow: 'Comece sem pagar',
            title: 'Teste com sua própria rotina.',
            text: 'Use agenda, cadastro, prontuário, follow-ups, financeiro e documentos com até 3 mães/pacientes.',
            price: 'R$ 0',
            plan: 'freemium',
            cta: 'Criar conta grátis',
            secondary: true,
          })}
          ${purchaseCard({
            eyebrow: 'Mais escolhido',
            title: 'Cresça sem limite de pacientes.',
            text: 'Todos os recursos do Freemium, pacientes ilimitados e upload de fotos e vídeos.',
            price: 'R$ 49,90/mês',
            plan: 'pro_monthly',
            cta: 'Assinar Pro',
          })}
        </section>

        <section class="sales-flow">
          <div class="sales-section-head">
            <span class="sales-kicker">Como funciona</span>
            <h2>Da primeira paciente ao acompanhamento contínuo.</h2>
          </div>
          <ol class="sales-steps">
            <li><span>1</span><div><strong>Cadastre a paciente</strong><p>Registre mãe, bebê e informações iniciais.</p></div></li>
            <li><span>2</span><div><strong>Agende o atendimento</strong><p>Organize data, horário e formato da consulta.</p></div></li>
            <li><span>3</span><div><strong>Registre o atendimento</strong><p>Prontuário, evolução e documentos no mesmo contexto.</p></div></li>
            <li><span>4</span><div><strong>Continue acompanhando</strong><p>Consulte histórico, follow-ups e financeiro nos retornos.</p></div></li>
          </ol>
        </section>

        <section class="sales-plans" id="planos">
          <div class="sales-section-head">
            <span class="sales-kicker">Planos</span>
            <h2>Escolha o ponto de entrada e comece agora.</h2>
            <p>Sem esconder o plano gratuito. O Pro existe para quem precisa crescer.</p>
          </div>
          <div class="sales-plan-grid">
            <article class="sales-plan-card" data-purchase-card>
              <span>Freemium</span><h3>R$ 0</h3><p>Para conhecer o sistema com até 3 mães/pacientes.</p>
              <ul><li>Agenda</li><li>Cadastro de mãe e bebê</li><li>Prontuário e evolução</li><li>Follow-ups</li><li>Financeiro</li><li>Documentos</li></ul>
              <button class="sales-button sales-button--ghost" type="button" data-sales-open="signup" data-plan="freemium">Começar grátis →</button>
            </article>
            <article class="sales-plan-card is-featured" data-purchase-card>
              <span>Pro mensal · mais escolhido</span><h3>R$ 49,90<small>/mês</small></h3><p>Para usar sem limite de pacientes.</p>
              <ul><li>Todos os recursos do Freemium</li><li>Pacientes ilimitados</li><li>Upload de fotos</li><li>Upload de vídeos</li></ul>
              <button class="sales-button sales-button--primary" type="button" data-sales-open="signup" data-plan="pro_monthly">Quero o Pro →</button>
            </article>
            <article class="sales-plan-card" data-purchase-card>
              <span>Pro anual</span><h3>R$ 499<small>/ano</small></h3><p>O mesmo Pro, com economia em relação a 12 mensalidades.</p>
              <ul><li>Pacientes ilimitados</li><li>Fotos e vídeos</li><li>Todos os recursos</li><li>Pagamento anual</li></ul>
              <button class="sales-button sales-button--ghost" type="button" data-sales-open="signup" data-plan="pro_annual">Quero o anual →</button>
            </article>
          </div>
        </section>

        <section class="sales-faq" id="faq">
          <div class="sales-section-head"><span class="sales-kicker">Perguntas frequentes</span><h2>Antes de começar.</h2></div>
          <div class="sales-faq-list">
            <details><summary>O que é um sistema para consultoras de amamentação?</summary><p>É uma plataforma que reúne agenda, cadastro de mãe e bebê, prontuário, acompanhamento, follow-ups, documentos e financeiro.</p></details>
            <details><summary>O sistema funciona no celular?</summary><p>Sim. A plataforma é responsiva e funciona pelo navegador no celular e no computador.</p></details>
            <details><summary>Preciso instalar algum programa?</summary><p>Não para usar a versão web. O acesso pode ser feito diretamente pelo navegador.</p></details>
            <details><summary>Posso cadastrar mãe e bebê juntos?</summary><p>Sim. O cadastro foi estruturado para manter mãe e bebê associados ao mesmo acompanhamento.</p></details>
            <details><summary>Existe controle financeiro?</summary><p>Sim. Você acompanha pagamentos recebidos, pendências e informações financeiras ligadas aos atendimentos.</p></details>
            <details><summary>Posso começar gratuitamente?</summary><p>Sim. O Freemium permite começar com até 3 mães/pacientes.</p></details>
            <details><summary>Qual a diferença do plano Pro?</summary><p>O Pro remove o limite de pacientes e libera upload de fotos e vídeos.</p></details>
          </div>
        </section>

        <section class="sales-final-cta">
          ${purchaseCard({
            eyebrow: 'Comece hoje',
            title: 'Sua próxima paciente pode entrar em uma rotina mais organizada.',
            text: 'Reúna agenda, pacientes, prontuário, acompanhamento e financeiro em um só lugar.',
            price: 'Grátis para começar',
            plan: 'freemium',
            cta: 'Criar conta grátis',
          })}
          <button class="sales-text-link" type="button" data-sales-open="signup" data-plan="pro_monthly">Prefiro começar direto no Pro →</button>
        </section>
      </main>

      <footer class="sales-footer">
        <div class="sales-brand"><span class="sales-brand-mark"><img src="../icon.svg" alt=""></span><span><strong>Débora Lactação</strong><small>Sistema para Consultoras</small></span></div>
        <nav><a href="#produto">Sistema</a><a href="#recursos">Recursos</a><a href="#planos">Planos</a><a href="#faq">Perguntas</a></nav>
        <p>© 2026 Débora Lactação.</p>
      </footer>
    `;

    document.body.classList.add('sales-v2-active');
    (legacyHeader || legacyMain || document.body.firstChild)?.before(shell);

    shell.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-sales-open]');
      if (!trigger) return;
      openCommercial(trigger.dataset.salesOpen || 'signup', trigger.dataset.plan || '');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render, { once: true });
  else render();
})();

