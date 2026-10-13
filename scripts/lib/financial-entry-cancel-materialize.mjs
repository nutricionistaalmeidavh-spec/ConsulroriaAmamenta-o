// Keep the financial card action on the generated clinical shell.
// The archived app shell is regenerated on each build; this is the canonical overlay.
const SHELL = 'core/app-shell.js';
function replaceOnce(source, needle, replacement, title) {
  const count = source.split(needle).length - 1;
  if (count !== 1) throw new Error(`financial cancel materialization: ${title}, found ${count}`);
  return source.replace(needle, replacement);
}
export function transformFinancialEntryCancellation(source) {
  let text = String(source);
  if (text.includes("else if (action === 'cancel-finance')")) return text;
  text = replaceOnce(text, 'let encounterAutosaveBusy = false;',
    'let encounterAutosaveBusy = false;\nconst financialCancellationPending = new Set();', 'operation state');
  const dueMarker = "    const due = f.due_at ? `<small>${overdue ? 'Venceu' : 'Vencimento'}: ${escapeHTML(dateLabel(f.due_at))}</small>` : '';";
  text = replaceOnce(text, dueMarker,
    "    const removeAction = `<button type=\"button\" class=\"finance-remove-action\" data-action=\"cancel-finance\" data-finance-id=\"${escapeHTML(f.id)}\" aria-label=\"Excluir lançamento de ${escapeHTML(p?.mother?.name || 'paciente')}, ${escapeHTML(currency(f.amount_cents))}\">Excluir</button>`;\n" + dueMarker,
    'financial card action');
  text = replaceOnce(text, '<div class="agenda-actions">${actions}</div></article>`;',
    '<div class="agenda-actions">${actions}${removeAction}</div></article>`;', 'action slot');
  text = replaceOnce(text, "    else if (action === 'mark-paid') {", "    else if (action === 'cancel-finance') {\n      const id = actionEl.dataset.financeId;\n      if (!id || financialCancellationPending.has(id)) return;\n      const finance = state.financial.find((item) => item.id === id && item.status !== 'Cancelado');\n      if (!finance) throw new Error('Este lançamento não está mais disponível. Atualize o Financeiro.');\n      if (finance.status === 'Pago' || finance.paid === true || finance.paid_at) {\n        toast('Desfaça primeiro a confirmação de pagamento antes de excluir este lançamento.');\n        return;\n      }\n      if (finance.status !== 'Pendente') throw new Error('Somente lançamentos pendentes podem ser excluídos.');\n      const patient = patientByMotherId(finance.mother_id);\n      const label = patient?.mother?.name || 'Paciente';\n      const packageWarning = finance.package_id\n        ? '\\n\\nEste lançamento está vinculado a um plano/pacote. Excluí-lo não cancela o plano e não desfaz pagamentos externos.'\n        : '';\n      if (!window.confirm(`Excluir o lançamento de ${label} no valor de ${currency(finance.amount_cents)}?\\n\\nEle sairá do Financeiro, mas ficará registrado para auditoria.${packageWarning}`)) return;\n      financialCancellationPending.add(id);\n      const originalLabel = actionEl.textContent;\n      actionEl.disabled = true;\n      actionEl.textContent = 'Excluindo…';\n      try {\n        const result = await appData.cancelFinancialEntry(id);\n        if (result?.status !== 'Cancelado' || String(result.id) !== String(id)) {\n          throw new Error('O banco não confirmou a exclusão do lançamento.');\n        }\n        const current = state.financial.find((item) => item.id === id);\n        if (current) current.status = 'Cancelado';\n        renderFinance();\n        try {\n          await refreshData();\n          toast(`Lançamento de ${label} excluído do Financeiro.`, 'success');\n        } catch (reloadError) {\n          console.warn('Financeiro: atualização após exclusão falhou', reloadError);\n          toast('Lançamento excluído. Atualize a tela para conferir os demais totais.', 'success');\n        }\n      } finally {\n        financialCancellationPending.delete(id);\n        if (actionEl.isConnected) {\n          actionEl.disabled = false;\n          actionEl.textContent = originalLabel;\n        }\n      }\n    }\n" + "\n    else if (action === 'mark-paid') {", 'cancel action handler');
  return text;
}
export function applyFinancialEntryCancellation(resolved, sourceByPath) {
  const old = resolved.get(SHELL);
  if (!old) throw new Error('financial cancel materialization: clinical shell unavailable');
  const next = transformFinancialEntryCancellation(Buffer.from(old).toString('utf8'));
  resolved.set(SHELL, new Uint8Array(Buffer.from(next,'utf8')));
  sourceByPath.set(SHELL, `${sourceByPath.get(SHELL)}+finance-cancel`);
}
