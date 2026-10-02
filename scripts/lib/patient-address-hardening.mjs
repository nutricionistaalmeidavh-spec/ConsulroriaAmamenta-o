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
    "  renderBabyTargetSelect(select.value || selectedMotherId);\n}\nfunction syncEncounterAddressFromPatient({ force = false } = {}) {\n  const field = document.querySelector('[data-encounter-field=\"address\"]');\n  if (!field) return;\n  const patient = selectedWizardPatient();\n  const fallback = String(patient?.mother?.address || '').trim();\n  if (force || !String(field.value || '').trim()) field.value = fallback;\n}",
    'address-sync-helper'
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
    "  const value = document.querySelector('[data-encounter-field=\"value\"]'); if (value) value.value = String(Number(appointment.value_cents || 0) / 100);\n  const address = document.querySelector('[data-encounter-field=\"address\"]'); if (address) address.value = String(appointment.address || patient.mother.address || '');",
    'scheduled-encounter-address'
  );

  source = replaceOnce(
    source,
    "  const format = prompt('Formato: Domiciliar, Presencial ou Online', 'Domiciliar') || 'Domiciliar';\n  const value = Number((prompt('Valor em R$ (opcional)', '0') || '0').replace(',', '.'));",
    "  const format = prompt('Formato: Domiciliar, Presencial ou Online', 'Domiciliar') || 'Domiciliar';\n  let address = String(patient.mother.address || '').trim();\n  if (/domiciliar/i.test(format)) {\n    const informedAddress = prompt('Endereço do atendimento', address);\n    if (informedAddress == null) return;\n    address = String(informedAddress).trim();\n  }\n  const value = Number((prompt('Valor em R$ (opcional)', '0') || '0').replace(',', '.'));",
    'schedule-address-override'
  );

  source = replaceOnce(source, "    p_address: patient.mother.address || '',", "    p_address: address,", 'schedule-address-persist');

  source = replaceOnce(
    source,
    "  currentPatientId = event.target.value || null;\n  renderBabyTargetSelect(currentPatientId);",
    "  currentPatientId = event.target.value || null;\n  renderBabyTargetSelect(currentPatientId);\n  syncEncounterAddressFromPatient({ force: true });",
    'patient-change-address'
  );

  const canonicalAddress = "String(ident.address || patient.mother.address || '').trim()";
  source = replaceOnce(source, "      address: patient.mother.address || ''", `      address: ${canonicalAddress}`, 'existing-appointment-address');
  source = replaceOnce(source, "    p_address: patient.mother.address || '',", `    p_address: ${canonicalAddress},`, 'new-encounter-address');
  source = replaceOnce(
    source,
    "    payment_status: valueCents ? 'Pendente' : 'Sem cobrança',\n    notes: selectedBabies.length > 1",
    `    payment_status: valueCents ? 'Pendente' : 'Sem cobrança',\n    address: ${canonicalAddress},\n    notes: selectedBabies.length > 1`,
    'finalized-appointment-address'
  );
  return source;
}
