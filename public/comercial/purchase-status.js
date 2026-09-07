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
    status.textContent = 'O pagamento será atualizado na sua conta após a aprovação. O e-mail de confirmação será enviado depois disso. Entre na sua conta para acompanhar.';
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
    const sent = ['email_sent', 'legacy_confirmation', 'email_confirmed'].includes(result.status);
    if (sent) {
      document.querySelector('#purchase-title').textContent = 'Pagamento confirmado';
      status.textContent = result.status === 'email_confirmed'
        ? 'Pagamento e e-mail confirmados. Entre para finalizar seu perfil.'
        : 'Pagamento confirmado. Confira sua caixa de entrada para confirmar o e-mail e liberar seu acesso.';
      document.querySelector('#email-steps').hidden = result.status === 'email_confirmed';
      button.hidden = true;
      return;
    }
    status.textContent = 'Aguardando a aprovação do pagamento. A confirmação de e-mail será enviada depois da aprovação.';
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
