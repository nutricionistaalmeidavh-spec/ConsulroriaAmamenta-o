const RESEND_ENDPOINT = 'https://api.resend.com/emails';

function text(value) {
  return String(value ?? '').trim();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[character]);
}

function layout(title, content, action = null) {
  const button = action ? `<p style="margin:28px 0"><a href="${escapeHtml(action.url)}" style="background:#713f59;color:#fff;text-decoration:none;padding:13px 20px;border-radius:8px;display:inline-block;font-weight:700">${escapeHtml(action.label)}</a></p>` : '';
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f8f5f6;font-family:Arial,sans-serif;color:#30272b"><div style="max-width:600px;margin:0 auto;padding:32px 20px"><div style="background:#fff;border-radius:14px;padding:32px;border:1px solid #eadfe4"><p style="color:#713f59;font-weight:700;margin:0 0 24px">Gestão Amamentação</p><h1 style="font-size:24px;margin:0 0 18px">${escapeHtml(title)}</h1>${content}${button}<p style="font-size:13px;color:#766a70;margin:28px 0 0">Se você não reconhece esta mensagem, pode ignorá-la.</p></div></div></body></html>`;
}

export function transactionalTemplate(kind, data = {}) {
  if (kind === 'password_recovery') {
    const minutes = Math.max(1, Math.round(Number(data.expiresInSeconds || 1800) / 60));
    return {
      subject: 'Redefina sua senha — Gestão Amamentação',
      text: `Recebemos uma solicitação para redefinir sua senha. Acesse ${data.recoveryUrl}. O link expira em ${minutes} minutos.`,
      html: layout('Redefina sua senha', `<p>Recebemos uma solicitação para criar uma nova senha.</p><p>Este link expira em ${minutes} minutos e só pode ser usado uma vez.</p>`, { label: 'Criar nova senha', url: data.recoveryUrl }),
    };
  }
  if (kind === 'welcome') return {
    subject: 'Boas-vindas à Gestão Amamentação',
    text: 'Sua conta foi criada com sucesso. Você já pode acessar a plataforma.',
    html: layout('Boas-vindas!', '<p>Sua conta foi criada com sucesso. Você já pode acessar a plataforma e começar a organizar seus atendimentos.</p>', data.appUrl ? { label: 'Acessar a plataforma', url: data.appUrl } : null),
  };
  if (kind === 'purchase_confirmed') {
    const plan = text(data.planName) || 'Plano contratado';
    return {
      subject: 'Pagamento confirmado — Gestão Amamentação',
      text: `Pagamento confirmado. ${plan} está ativo em sua conta.`,
      html: layout('Pagamento confirmado', `<p>Recebemos a confirmação da sua compra.</p><p><strong>${escapeHtml(plan)}</strong> já está ativo em sua conta.</p>`, data.appUrl ? { label: 'Acessar a plataforma', url: data.appUrl } : null),
    };
  }
  throw new TypeError('unsupported_transactional_email');
}

export async function sendTransactionalEmail(env, message) {
  const to = text(message?.to).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || to.length > 254) throw new TypeError('invalid_email_recipient');
  const template = transactionalTemplate(message.kind, message.data);
  if (env.EMAIL?.send) {
    const from = text(env.TRANSACTIONAL_EMAIL_FROM) || 'Débora Lactação <welcome@deboralactacao.com>';
    await env.EMAIL.send({ to, from, subject: template.subject, html: template.html, text: template.text });
    return { provider: 'cloudflare' };
  }
  const delivery = env.TRANSACTIONAL_EMAIL_DELIVERY || (message.kind === 'password_recovery' ? env.AUTH_RECOVERY_DELIVERY : null);
  if (delivery?.fetch) {
    const legacyRecovery = message.kind === 'password_recovery' && !env.TRANSACTIONAL_EMAIL_DELIVERY;
    const body = legacyRecovery
      ? { to, recoveryUrl: message.data.recoveryUrl, expiresInSeconds: message.data.expiresInSeconds }
      : { to, kind: message.kind, ...template };
    const response = await delivery.fetch(new Request('https://transactional-email.internal/send', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }));
    if (!response.ok) throw new Error('transactional_email_delivery_failed');
    return { provider: 'service_binding' };
  }

  const apiKey = text(env.RESEND_API_KEY);
  const from = text(env.TRANSACTIONAL_EMAIL_FROM);
  if (!apiKey || !from) throw new Error('transactional_email_not_configured');
  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject: template.subject, text: template.text, html: template.html }),
  });
  if (!response.ok) throw new Error(`transactional_email_provider_${response.status}`);
  return { provider: 'resend' };
}

export async function sendBestEffortTransactionalEmail(env, message) {
  try {
    return await sendTransactionalEmail(env, message);
  } catch (error) {
    console.error('transactional_email_failed', message?.kind, error instanceof Error ? error.message : 'unknown');
    return null;
  }
}
