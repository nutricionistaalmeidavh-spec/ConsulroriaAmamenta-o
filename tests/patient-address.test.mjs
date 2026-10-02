import test from 'node:test';
import assert from 'node:assert/strict';
import { hardenPatientAddressApp, hardenPatientAddressHtml } from '../scripts/lib/patient-address-hardening.mjs';

test('patient address hardening adds one persisted default address and one appointment override field', () => {
  const html = [
    '<label class="field"><span>Telefone</span><input name="motherPhone" inputmode="tel" autocomplete="tel" placeholder="(16) 99999-9999"></label>',
    '<label class="field"><span>Valor</span><div class="unit-input"><b>R$</b><input type="number" min="0" step="0.01" value="0" data-encounter-field="value" data-section="identification"></div></label>',
    '<div><dt>Telefone</dt><dd data-mother-phone>—</dd></div>',
  ].join('');
  const out = hardenPatientAddressHtml(html);
  assert.match(out, /name="motherAddress"/);
  assert.match(out, /data-encounter-field="address"/);
  assert.match(out, /data-mother-address/);
  assert.equal((out.match(/name="motherAddress"/g) || []).length, 1);
  assert.equal(hardenPatientAddressHtml(out), out);
});

test('patient address hardening persists, prefills and preserves per-appointment override', () => {
  const source = `
  val('motherName', patient?.mother?.name); val('motherPhone', patient?.mother?.phone); val('motherBirthDate', patient?.mother?.birth_date);
      name: get('motherName').trim(), phone: get('motherPhone').trim(), birth_date: get('motherBirthDate') || null,
  setText('[data-mother-phone]', patient.mother.phone || 'Não informado');
  renderBabyTargetSelect(select.value || selectedMotherId);
}
  const value = document.querySelector('[data-encounter-field="value"]'); if (value) value.value = '0';
  const value = document.querySelector('[data-encounter-field="value"]'); if (value) value.value = String(Number(appointment.value_cents || 0) / 100);
  const format = prompt('Formato: Domiciliar, Presencial ou Online', 'Domiciliar') || 'Domiciliar';
  const value = Number((prompt('Valor em R$ (opcional)', '0') || '0').replace(',', '.'));
  await appData.scheduleAppointment({
    p_mother_id: patient.mother.id,
    p_baby_ids: selectedBabies.map((item) => item.id),
    p_starts_at: clinicInputToIso(when),
    p_duration_min: 60,
    p_appointment_type: type,
    p_format: format,
    p_value_cents: Math.max(0, Math.round(value * 100)),
    p_payment_status: value > 0 ? 'Pendente' : 'Sem cobrança',
    p_address: patient.mother.address || '',
  currentPatientId = event.target.value || null;
  renderBabyTargetSelect(currentPatientId);
      address: patient.mother.address || ''
    p_address: patient.mother.address || '',
    payment_status: valueCents ? 'Pendente' : 'Sem cobrança',
    notes: selectedBabies.length > 1
`;
  const out = hardenPatientAddressApp(source);
  assert.match(out, /val\('motherAddress'/);
  assert.match(out, /address: get\('motherAddress'\)\.trim\(\)/);
  assert.match(out, /syncEncounterAddressFromPatient\(\{ force: true \}\)/);
  assert.match(out, /appointment\.address \|\| patient\.mother\.address/);
  assert.match(out, /p_address: address/);
  assert.match(out, /String\(ident\.address \|\| patient\.mother\.address \|\| ''\)\.trim\(\)/);
  assert.equal(hardenPatientAddressApp(out), out);
});
