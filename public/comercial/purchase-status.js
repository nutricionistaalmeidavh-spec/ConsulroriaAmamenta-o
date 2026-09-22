const status = document.querySelector('#purchase-status');
const button = document.querySelector('#check-payment');
let proof;
try { proof = JSON.parse(sessionStorage.getItem('commercial.saas.pending-signup.v2') || 'null'); } catch { proof = null; }
let busy = false;
let attempts = 0;
let timer;

async function checkPayment() {
  if (busy) return;
  clearTimeout(timer);
  if (!proof?.userId || !proof?.signupNonce) {
    status.textContent = 'O pagamento será atualizado automaticamente após a aprovação do Asaas. Entre na sua conta para acompanhar.';
    button.hidden = true;
    return;
  }
  busy = true;
  button.disabled = true;
  try {
    const response = await fetch('/api/asaas/pending-status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(proof),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.status || result.error);

    if (result.status === 'email_confirmed') {
      document.querySelector('#purchase-title').textContent = 'Pagamento e e-mail confirmados';
      status.textContent = 'Seu acesso está liberado. Entre com o e-mail e a senha usados no cadastro para finalizar seu perfil.';
      const steps = document.querySelector('#email-steps');
      if (steps) steps.hidden = true;
      sessionStorage.removeItem('commercial.saas.pending-signup.v2');
      button.hidden = true;
      return;
    }

    if (result.status === 'email_sent') {
      document.querySelector('#purchase-title').textContent = 'Pagamento confirmado';
      status.textContent = 'Pagamento aprovado. Enviamos agora o e-mail de confirmação. Abra o link recebido para liberar o acesso.';
      if (++attempts < 12) timer = setTimeout(checkPayment, 10000);
      return;
    }

    if (result.status === 'email_delivery_unavailable') {
      document.querySelector('#purchase-title').textContent = 'Pagamento confirmado';
      status.textContent = 'O pagamento foi aprovado, mas o envio do e-mail de confirmação está temporariamente indisponível. Use “Verificar pagamento” novamente.';
      return;
    }

    status.textContent = 'Aguardando a aprovação do pagamento. O e-mail de confirmação só será enviado depois da confirmação do Asaas.';
    if (++attempts < 12) timer = setTimeout(checkPayment, 10000);
  } catch {
    status.textContent = 'Ainda não foi possível atualizar a confirmação. Use “Verificar pagamento” novamente em instantes. Sua compra não será repetida.';
  } finally {
    busy = false;
    button.disabled = false;
  }
}

button.addEventListener('click', checkPayment);
checkPayment();
