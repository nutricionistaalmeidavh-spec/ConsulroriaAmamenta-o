// Additive date correction UI; clinical identity and persistence remain in the canonical encounter API.
const CLINIC_TZ = 'America/Sao_Paulo';
const DATE_PATH = '/api/clinical/records/clinical_encounters';
const DATE_UUID = /^[0-9a-f-]{36}$/i;

function encounterDateToken() {
  return globalThis.__deboraAccessToken ||
    sessionStorage.getItem('debora-runtime-access-token') ||
    localStorage.getItem('debora-runtime-access-token') || '';
}

async function encounterDateRequest(path, options = {}) {
  const token = encounterDateToken();
  if (!token) throw new Error('Sessão expirada. Entre novamente no aplicativo.');
  const response = await fetch(path, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers },
    cache: 'no-store',
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.message || result?.error || 'Não foi possível corrigir a data.');
  return result;
}

function clinicDateInput(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: CLINIC_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function clinicDateIso(raw) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return '';
  // The clinical system currently works in America/Sao_Paulo (UTC-03).
  const date = new Date(`${raw}:00-03:00`);
  return Number.isFinite(date.getTime()) && clinicDateInput(date) === raw ? date.toISOString() : '';
}

function shortClinicDate(value) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: CLINIC_TZ, dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

async function saveEncounterDate(form, overlay, encounterId) {
  const input = form.querySelector('input');
  const status = form.querySelector('[data-encounter-date-status]');
  const submit = form.querySelector('button[type=submit]');
  const occurredAt = clinicDateIso(input.value);
  if (!occurredAt || Date.parse(occurredAt) > Date.now() + 5 * 60000) {
    status.textContent = 'Informe uma data e hora válidas, não futuras.';
    return;
  }
  submit.disabled = true;
  status.textContent = 'Conferindo prontuário…';
  try {
    const endpoint = `${DATE_PATH}?id=eq.${encodeURIComponent(encounterId)}&select=id,record_version,clinical_note,occurred_at,identification`;
    const rows = await encounterDateRequest(endpoint);
    const record = rows?.[0];
    if (!record || record.id !== encounterId) throw new Error('Prontuário não encontrado.');
    if ((overlay.querySelector('#cn-note')?.value || '') !== String(record.clinical_note || '')) {
      throw new Error('Há texto ainda não sincronizado. Salve o prontuário antes de corrigir a data.');
    }
    const savingLabel = overlay.querySelector('#cn-save-status');
    if (savingLabel && ['saving','error','muted','local'].includes(savingLabel.dataset.tone) &&
      /salvando|pendente|falha|local|erro/i.test(savingLabel.textContent || '')) {
      throw new Error('Conclua o salvamento do prontuário antes de alterar a data.');
    }
    if (Date.parse(record.occurred_at) === Date.parse(occurredAt)) {
      status.textContent = 'A data informada já está registrada.';
      return;
    }
    status.textContent = 'Salvando data e histórico de alteração…';
    await encounterDateRequest(endpoint.split('&select=')[0], {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        _expected_version: Number(record.record_version || 0),
        occurred_at: occurredAt,
        _date_correction_reason: 'Registro retrospectivo ou correção da data real do atendimento',
      }),
    });
    status.textContent = 'Data corrigida e auditada. Atualizando prontuário…';
    // Reload clears the editor's previous optimistic version and refreshes timeline, PDF and agenda.
    window.location.reload();
  } catch (error) {
    status.textContent = error?.message || 'Não foi possível salvar. A data original foi preservada.';
  } finally {
    submit.disabled = false;
  }
}

function mountEncounterDateCorrection() {
  const rawLabel = document.querySelector('[data-encounter-field="startsAt"]')?.closest('label')?.querySelector('span');
  if (rawLabel && rawLabel.textContent === 'Data e hora') rawLabel.textContent = 'Data real do atendimento';
  const overlay = document.querySelector('#cn-overlay');
  const consultation = overlay?.querySelector('.cn-meta > div:nth-child(2)');
  if (!consultation || consultation.querySelector('[data-encounter-date-edit]')) return;
  const encounterId = overlay.querySelector('.cn-patient-main span')?.textContent || '';
  // The header renders only a shortened identifier: use the canonical encounter id
  // exposed by the active wizard or the clicked persisted history card instead.
  const fullId = document.querySelector('[data-screen="appointment"]')?.dataset.encounterId ||
    window.__encounterDateHistoryId || '';
  if (!DATE_UUID.test(fullId)) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'encounter-date-edit';
  button.dataset.encounterDateEdit = '1';
  button.textContent = 'Corrigir data';
  button.setAttribute('aria-label', 'Corrigir a data e hora deste prontuário');
  consultation.appendChild(button);
  button.addEventListener('click', async () => {
    if (consultation.querySelector('[data-encounter-date-form]')) return;
    const form = document.createElement('form');
    form.className = 'encounter-date-form';
    form.dataset.encounterDateForm = '1';
    const label = document.createElement('label');
    label.textContent = 'Data e hora reais da consulta';
    const date = document.createElement('input');
    date.type = 'datetime-local';
    date.required = true;
    date.setAttribute('aria-label', 'Data e hora reais da consulta');
    label.appendChild(date);
    const actions = document.createElement('div');
    const confirm = document.createElement('button');
    confirm.type = 'submit'; confirm.textContent = 'Salvar data';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.textContent = 'Cancelar';
    cancel.addEventListener('click', () => { form.remove(); button.hidden = false; });
    actions.append(confirm, cancel);
    const status = document.createElement('small');
    status.dataset.encounterDateStatus = '1';
    status.setAttribute('role', 'status');
    form.append(label, actions, status);
    consultation.appendChild(form);
    button.hidden = true;
    form.addEventListener('submit', event => {
      event.preventDefault();
      saveEncounterDate(form, overlay, fullId);
    });
    try {
      const rows = await encounterDateRequest(`${DATE_PATH}?id=eq.${encodeURIComponent(fullId)}&select=id,occurred_at`);
      date.value = clinicDateInput(rows?.[0]?.occurred_at);
    } catch (error) {
      status.textContent = error?.message || 'Não foi possível carregar a data.';
    }
  });
}

// History buttons carry the canonical encounter UUID; keep it only in memory,
// never in cache or browser storage.
document.addEventListener('click', (event) => {
  const history = event.target?.closest?.('[data-pf-encounter]');
  if (history && DATE_UUID.test(history.dataset.pfEncounter || '')) {
    window.__encounterDateHistoryId = history.dataset.pfEncounter;
  }
}, true);

new MutationObserver(mountEncounterDateCorrection).observe(document.documentElement, { childList: true, subtree: true });
mountEncounterDateCorrection();
