import test from 'node:test';
import assert from 'node:assert/strict';
import { hardenPatientQuickActionsApp, hardenPatientQuickActionsHtml } from '../scripts/lib/patient-quick-actions-hardening.mjs';

test('patient quick buttons receive semantic actions', () => {
  const source = '<div class="patient-quick"><button>WhatsApp</button><button>Ligar</button><button>Rota</button><button>Registrar peso</button><button>Adicionar foto</button></div>';
  const out = hardenPatientQuickActionsHtml(source);
  for (const action of ['patient-whatsapp','patient-call','patient-route','add-weight','patient-add-media']) assert.match(out, new RegExp(`data-action="${action}"`));
  assert.equal(hardenPatientQuickActionsHtml(out), out);
});

test('patient quick dispatcher reuses canonical flows and WhatsApp can open without preset text', () => {
  const source = `
async function openWhatsApp(patient, message) {
  if (!patient) return;
  if (!(await ensureConsent(patient.mother.id, 'whatsapp'))) { toast('Contato por WhatsApp não está autorizado para esta paciente.', 'error'); return; }
  const phone = phoneForWhatsApp(patient.mother.phone); if (!phone) { toast('Paciente sem telefone cadastrado.', 'error'); return; }
  window.open(\`https://wa.me/\${phone}?text=\${encodeURIComponent(message)}\`, '_blank', 'noopener');
}
    else if (action === 'add-weight') await addWeight();`;
  const out = hardenPatientQuickActionsApp(source);
  assert.match(out, /const url = text \? /);
  assert.match(out, /openWhatsApp\(currentPatientForQuickAction\(\), ''\)/);
  assert.match(out, /window\.DeboraAlbum\.openUploader/);
  assert.match(out, /tel:\+\$\{phone\}/);
  assert.match(out, /item\.mother_id === patient\.mother\.id/);
  assert.equal(hardenPatientQuickActionsApp(out), out);
});
