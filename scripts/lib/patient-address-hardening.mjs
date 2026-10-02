const MOTHER_PHONE_FIELD = '<label class="field"><span>Telefone</span><input name="motherPhone" inputmode="tel" autocomplete="tel" placeholder="(16) 99999-9999"></label>';
const MOTHER_ADDRESS_FIELD = '<label class="field"><span>Endereço padrão</span><input name="motherAddress" autocomplete="street-address" placeholder="Rua, número, bairro, cidade"></label>';
const APPOINTMENT_VALUE_FIELD = '<label class="field"><span>Valor</span><div class="unit-input"><b>R$</b><input type="number" min="0" step="0.01" value="0" data-encounter-field="value" data-section="identification"></div></label>';
const APPOINTMENT_ADDRESS_FIELD = '<label class="field"><span>Endereço do atendimento</span><input data-encounter-field="address" data-section="identification" autocomplete="street-address" placeholder="Preenchido com o endereço padrão da paciente"></label>';
const MOTHER_PHONE_DETAIL = '<div><dt>Telefone</dt><dd data-mother-phone>—</dd></div>';
const MOTHER_ADDRESS_DETAIL = '<div><dt>Endereço</dt><dd data-mother-address>—</dd></div>';

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`patient-address: trecho ausente: ${label}`);
  return source.replace(before, after);
}

export function hardenPatientAddressHtml(source) {
  source = replaceOnce(source, MOTHER_PHONE_FIELD, `${MOTHER_PHONE_FIELD}${MOTHER_ADDRESS_FIELD}`, 'mother-address-field');
  source = replaceOnce(source, APPOINTMENT_VALUE_FIELD, `${APPOINTMENT_VALUE_FIELD}${APPOINTMENT_ADDRESS_FIELD}`, 'appointment-address-field');
  source = replaceOnce(source, MOTHER_PHONE_DETAIL, `${MOTHER_PHONE_DETAIL}${MOTHER_ADDRESS_DETAIL}`, 'mother-address-detail');
  return source;
}

export function hardenPatientAddressApp(source) {
  source = replaceOnce(
    source,
    "  val('motherName', patient?.mother?.name); val('motherPhone', patient?.mother?.phone); val('motherBirthDate', patient?.mother?.birth_date);",
    "  val('motherName', patient?.mother?.name); val('motherPhone', patient?.mother?.phone); val('motherAddress', patient?.mother?.address); val('motherBirthDate', patient?.mother?.birth_date);",
    'edit-form-prefill'
  );

  source = replaceOnce(
    source,
    "      name: get('motherName').trim(), phone: get('motherPhone').trim(), birth_date: get('motherBirthDate') || null,",
    "      name: get('motherName').trim(), phone: get('motherPhone').trim(), address: get('motherAddress').trim(), birth_date: get('motherBirthDate') || null,",
    'patient-payload'
  );

  source = replaceOnce(
    source,
    "  setText('[data-mother-phone]', patient.mother.phone || 'Não informado');",
    "  setText('[data-mother-phone]', patient.mother.phone || 'Não informado');\n  setText('[data-mother-address]', patient.mother.address || 'Não informado');",
    'patient-detail'
  );

  source = replaceOnce(
    source,
    "  renderBabyTargetSelect(select.value || selectedMotherId);\n}",
    "  renderBabyTargetSelect(select.value || selectedMotherId);\n}\nfunction normalizedEncounterFormat(format) {\n  return String(format || '').trim().toLocaleLowerCase('pt-BR');\n}\nfunction isHomeVisitFormat(format) {\n  return /domiciliar/.test(normalizedEncounterFormat(format));\n}\nfunction isOnlineFormat(format) {\n  return /online/.test(normalizedEncounterFormat(format));\n}\nfunction encounterAddressForFormat(format, enteredAddress, patient) {\n  const entered = String(enteredAddress || '').trim();\n  if (isOnlineFormat(format)) return '';\n  if (isHomeVisitFormat(format)) return entered || String(patient?.mother?.address || '').trim();\n  return entered;\n}\nfunction routeAddressForAppointment(appointment, patient) {\n  if (!appointment) return String(patient?.mother?.address || '').trim();\n  const format = appointment.format || 'Domiciliar';\n  if (isOnlineFormat(format)) return '';\n  if (isHomeVisitFormat(format)) return String(appointment.address || patient?.mother?.address || '').trim();\n  return String(appointment.address || '').trim();\n}\nfunction selectedEncounterFormat() {\n  return document.querySelector('[data-encounter-choice][data-field=\"format\"][aria-pressed=\"true\"]')?.dataset.value || 'Domiciliar';\n}\nfunction syncEncounterAddressFromPatient({ force = false, format = null } = {}) {\n  const field = document.querySelector('[data-encounter-field=\"address\"]');\n  if (!field) return;\n  const patient = selectedWizardPatient();\n  const selectedFormat = format || selectedEncounterFormat();\n  const fallback = String(patient?.mother?.address || '').trim();\n  const current = String(field.value || '').trim();\n  if (isOnlineFormat(selectedFormat)) { field.value = ''; return; }\n  if (isHomeVisitFormat(selectedFormat)) { if (force || !current) field.value = fallback; return; }\n  if (force && current === fallback) field.value = '';\n}",
    'address-format-helpers'
  );

  source = replaceOnce(
    source,
    "  const value = document.querySelector('[data-encounter-field=\"value\"]'); if (value) value.value = '0';",
    "  const value = document.querySelector('[data-encounter-field=\"value\"]'); if (value) value.value = '0';\n  syncEncounterAddressFromPatient({ force: true });",
    'new-encounter-default'
  );

  source = replaceOnce(
    source,
    "  const value = document.querySelector('[data-encounter-field=\"value\"]'); if (value) value.value = String(Number(appointment.value_cents || 0) / 100);",
    "  const value = document.querySelector('[data-encounter-field=\"value\"]'); if (value) value.value = String(Number(appointment.value_cents || 0) / 100);\n  const address = document.querySelector('[data-encounter-field=\"address\"]'); if (address) address.value = encounterAddressForFormat(appointment.format || 'Domiciliar', appointment.address, patient);",
    'scheduled-encounter-address'
  );

  source = replaceOnce(
    source,
    "  const format = prompt('Formato: Domiciliar, Presencial ou Online', 'Domiciliar') || 'Domiciliar';\n  const value = Number((prompt('Valor em R$ (opcional)', '0') || '0').replace(',', '.'));",
    "  const format = prompt('Formato: Domiciliar, Presencial ou Online', 'Domiciliar') || 'Domiciliar';\n  let address = '';\n  if (isHomeVisitFormat(format)) {\n    const informedAddress = prompt('Endereço do atendimento', String(patient.mother.address || '').trim());\n    if (informedAddress == null) return;\n    address = String(informedAddress).trim();\n  } else if (!isOnlineFormat(format)) {\n    const informedAddress = prompt('Local do atendimento (opcional)', '');\n    if (informedAddress == null) return;\n    address = String(informedAddress).trim();\n  }\n  const value = Number((prompt('Valor em R$ (opcional)', '0') || '0').replace(',', '.'));",
    'schedule-address-by-format'
  );

  source = replaceOnce(
    source,
    "  await appData.scheduleAppointment({\n    p_mother_id: patient.mother.id,\n    p_baby_ids: selectedBabies.map((item) => item.id),\n    p_starts_at: clinicInputToIso(when),\n    p_duration_min: 60,\n    p_appointment_type: type,\n    p_format: format,\n    p_value_cents: Math.max(0, Math.round(value * 100)),\n    p_payment_status: value > 0 ? 'Pendente' : 'Sem cobrança',\n    p_address: patient.mother.address || '',",
    "  await appData.scheduleAppointment({\n    p_mother_id: patient.mother.id,\n    p_baby_ids: selectedBabies.map((item) => item.id),\n    p_starts_at: clinicInputToIso(when),\n    p_duration_min: 60,\n    p_appointment_type: type,\n    p_format: format,\n    p_value_cents: Math.max(0, Math.round(value * 100)),\n    p_payment_status: value > 0 ? 'Pendente' : 'Sem cobrança',\n    p_address: address,",
    'schedule-address-persist'
  );

  source = replaceOnce(
    source,
    "  currentPatientId = event.target.value || null;\n  renderBabyTargetSelect(currentPatientId);",
    "  currentPatientId = event.target.value || null;\n  renderBabyTargetSelect(currentPatientId);\n  syncEncounterAddressFromPatient({ force: true });",
    'patient-change-address'
  );

  source = replaceOnce(
    source,
    "      const selected = multiple ? choice.getAttribute('aria-pressed') !== 'true' : true;\n      choice.classList.toggle('selected', selected); choice.setAttribute('aria-pressed', String(selected));\n    }",
    "      const selected = multiple ? choice.getAttribute('aria-pressed') !== 'true' : true;\n      choice.classList.toggle('selected', selected); choice.setAttribute('aria-pressed', String(selected));\n      if (selected && choice.dataset.field === 'format') syncEncounterAddressFromPatient({ force: true, format: choice.dataset.value });\n    }",
    'format-choice-address-sync'
  );

  const canonicalAddress = "encounterAddressForFormat(ident.format || 'Domiciliar', ident.address, patient)";
  source = replaceOnce(source, "      address: patient.mother.address || ''", `      address: ${canonicalAddress}`, 'existing-appointment-address');
  source = replaceOnce(source, "    p_address: patient.mother.address || '',", `    p_address: ${canonicalAddress},`, 'new-encounter-address');
  source = replaceOnce(
    source,
    "    payment_status: valueCents ? 'Pendente' : 'Sem cobrança',\n    notes: selectedBabies.length > 1",
    `    payment_status: valueCents ? 'Pendente' : 'Sem cobrança',\n    address: ${canonicalAddress},\n    notes: selectedBabies.length > 1`,
    'finalized-appointment-address'
  );

  source = replaceOnce(
    source,
    "  const address = next?.address || patient.mother?.address || '';\n  if (!address) { toast('Nenhum endereço cadastrado para esta paciente ou próximo atendimento.', 'error'); return; }\n  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`, '_blank', 'noopener');",
    "  const address = routeAddressForAppointment(next, patient);\n  if (!address) {\n    if (next && isOnlineFormat(next.format)) toast('O próximo atendimento é online e não possui rota.', 'error');\n    else toast('Nenhum endereço de atendimento disponível para abrir a rota.', 'error');\n    return;\n  }\n  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`, '_blank', 'noopener');",
    'patient-route-by-format'
  );

  source = replaceOnce(
    source,
    "      const address = next?.address || patient?.mother?.address || '';\n      if (!address) toast('Este atendimento não possui endereço cadastrado.', 'error');\n      else window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`, '_blank', 'noopener');",
    "      const address = routeAddressForAppointment(next, patient);\n      if (!address) {\n        if (next && isOnlineFormat(next.format)) toast('O próximo atendimento é online e não possui rota.', 'error');\n        else toast('Este atendimento não possui local disponível para rota.', 'error');\n      } else window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`, '_blank', 'noopener');",
    'dashboard-route-by-format'
  );

  return source;
}
