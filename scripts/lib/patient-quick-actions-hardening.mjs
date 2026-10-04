const QUICK_ACTIONS_OLD = '<div class="patient-quick"><button>WhatsApp</button><button>Ligar</button><button>Rota</button><button>Registrar peso</button><button>Adicionar foto</button></div>';
const QUICK_ACTIONS_NEW = '<div class="patient-quick"><button type="button" data-action="patient-whatsapp">WhatsApp</button><button type="button" data-action="patient-call">Ligar</button><button type="button" data-action="patient-route">Rota</button><button type="button" data-action="add-weight">Registrar peso</button><button type="button" data-action="patient-add-media">Adicionar foto</button></div>';

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`patient-quick-actions: trecho ausente: ${label}`);
  return source.replace(before, after);
}

export function hardenPatientQuickActionsHtml(source) {
  return replaceOnce(source, QUICK_ACTIONS_OLD, QUICK_ACTIONS_NEW, 'patient-quick');
}

export function hardenPatientQuickActionsApp(source) {
  source = replaceOnce(
    source,
    "  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');\n}",
    "  const text = String(message || '').trim();\n  const url = text ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : `https://wa.me/${phone}`;\n  window.open(url, '_blank', 'noopener');\n}\nfunction currentPatientForQuickAction() {\n  return patientByMotherId(currentPatientId);\n}\nfunction callCurrentPatient() {\n  const patient = currentPatientForQuickAction();\n  const phone = phoneForWhatsApp(patient?.mother?.phone);\n  if (!phone) { toast('Paciente sem telefone cadastrado.', 'error'); return; }\n  window.open(`tel:+${phone}`, '_self');\n}\nfunction openCurrentPatientRoute() {\n  const patient = currentPatientForQuickAction();\n  if (!patient) { toast('Paciente não encontrada.', 'error'); return; }\n  const now = Date.now();\n  const next = state.appointments\n    .filter((item) => item.mother_id === patient.mother.id && new Date(item.starts_at).getTime() >= now && isScheduledStatus(item.status))\n    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())[0];\n  const address = next?.address || patient.mother?.address || '';\n  if (!address) { toast('Nenhum endereço cadastrado para esta paciente ou próximo atendimento.', 'error'); return; }\n  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`, '_blank', 'noopener');\n}",
    'quick-action helpers'
  );

  source = replaceOnce(
    source,
    "    else if (action === 'add-weight') await addWeight();",
    "    else if (action === 'patient-whatsapp') await openWhatsApp(currentPatientForQuickAction(), '');\n    else if (action === 'patient-call') callCurrentPatient();\n    else if (action === 'patient-route') openCurrentPatientRoute();\n    else if (action === 'patient-add-media') {\n      const patient = currentPatientForQuickAction();\n      if (!patient) toast('Paciente não encontrada.', 'error');\n      else if (!window.DeboraAlbum?.openUploader) toast('Biblioteca clínica ainda está carregando. Tente novamente em instantes.', 'error');\n      else await window.DeboraAlbum.openUploader(patient.mother.id, actionEl);\n    }\n    else if (action === 'add-weight') await addWeight();",
    'quick-action dispatcher'
  );
  return source;
}
