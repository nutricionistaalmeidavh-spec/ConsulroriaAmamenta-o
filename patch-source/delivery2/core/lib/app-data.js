function patientAggregate(mother, babies = []) {
  const list = Array.isArray(babies) ? babies : babies ? [babies] : [];
  return { id: mother.id, mother, babies: list, baby: list[0] || null };
}

function babiesForMother(babies, motherId) {
  return babies.filter((baby) => baby.mother_id === motherId);
}

function normalizeBabies({ babies, baby } = {}) {
  const list = Array.isArray(babies) && babies.length ? babies : baby ? [baby] : [];
  return list.filter((item) => item && String(item.name || '').trim());
}

function requestKey() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function followupDue(label, baseValue) {
  if (!label) return null;
  const due = new Date(baseValue || Date.now());
  if (Number.isNaN(due.getTime())) return null;
  if (label === '24 horas') due.setHours(due.getHours() + 24);
  else if (label === '48 horas') due.setHours(due.getHours() + 48);
  else if (label === '3 dias') due.setDate(due.getDate() + 3);
  else if (label === '7 dias') due.setDate(due.getDate() + 7);
  else return null;
  return due.toISOString();
}

function finalizationWeights(encounter = {}) {
  const ids = Array.isArray(encounter.identification?.babyIds)
    ? encounter.identification.babyIds.filter(Boolean)
    : encounter.baby_id ? [encounter.baby_id] : [];
  const measuredAt = encounter.identification?.startsAt || encounter.occurred_at || new Date().toISOString();
  return ids.map((babyId) => {
    const assessment = encounter.baby_assessment?.byBaby?.[babyId]
      || (ids.length === 1 ? encounter.baby_assessment : {})
      || {};
    const weight = Number(assessment.weightG || 0);
    return weight > 0 ? { baby_id: babyId, weight_g: weight, measured_at: measuredAt } : null;
  }).filter(Boolean);
}

export function createAppData(repos) {
  if (!repos) throw new Error('Repositórios são obrigatórios.');

  const encounterWriteChains = new Map();
  const encounterLifecycle = new Map();
  const pendingAppointmentFinalization = new Map();
  let startAttempt = null;

  async function listPatients() {
    const [mothers, babies] = await Promise.all([repos.mothers.list(), repos.babies.list({ query: 'select=*&order=created_at.asc' })]);
    return mothers.map((mother) => patientAggregate(mother, babiesForMother(babies, mother.id)));
  }

  async function createPatient({ mother = {}, babies, baby } = {}) {
    if (!String(mother.name || '').trim()) throw new Error('Nome da mãe é obrigatório.');
    const babyList = normalizeBabies({ babies, baby });
    if (!babyList.length) throw new Error('Cadastre pelo menos um bebê.');
    const savedMother = await repos.mothers.create(mother);
    const savedBabies = [];
    for (const item of babyList) savedBabies.push(await repos.babies.create({ ...item, mother_id: savedMother.id }));
    return patientAggregate(savedMother, savedBabies);
  }

  async function updatePatient({ mother = {}, babies, baby } = {}) {
    if (!mother.id) throw new Error('Paciente incompleta para edição.');
    const babyList = normalizeBabies({ babies, baby });
    if (!babyList.length) throw new Error('Cadastre pelo menos um bebê.');
    const savedMother = await repos.mothers.update(mother.id, mother);
    const savedBabies = [];
    for (const item of babyList) {
      if (item.id) savedBabies.push(await repos.babies.update(item.id, { ...item, mother_id: mother.id }));
      else savedBabies.push(await repos.babies.create({ ...item, mother_id: mother.id }));
    }
    return patientAggregate(savedMother, savedBabies);
  }

  async function getPatient(motherId) {
    const [mother, babies] = await Promise.all([
      repos.mothers.get(motherId),
      repos.babies.list({ query: `select=*&mother_id=eq.${encodeURIComponent(motherId)}&order=created_at.asc` })
    ]);
    if (!mother) return null;
    return patientAggregate(mother, babies);
  }

  async function startClinicalEncounter(payload = {}) {
    const unsigned = { ...payload };
    delete unsigned.p_request_key;
    const signature = JSON.stringify(unsigned);
    if (!startAttempt || startAttempt.signature !== signature) {
      startAttempt = { signature, key: payload.p_request_key || requestKey() };
    }
    try {
      const result = await repos.client.rpc('start_clinical_encounter', {
        ...unsigned,
        p_request_key: payload.p_request_key || startAttempt.key,
      });
      startAttempt = null;
      return result;
    } catch (error) {
      throw error;
    }
  }

  function queueEncounterWrite(id, work) {
    const previous = encounterWriteChains.get(id) || Promise.resolve();
    const next = previous.catch(() => null).then(work);
    encounterWriteChains.set(id, next.finally(() => {
      if (encounterWriteChains.get(id) === next) encounterWriteChains.delete(id);
    }));
    return next;
  }

  async function updateEncounter(id, payload = {}) {
    const wantsFinalize = String(payload.status || '').toLowerCase() === 'finalized';
    const lifecycle = encounterLifecycle.get(id);
    if (!wantsFinalize && (lifecycle === 'finalizing' || lifecycle === 'finalized')) {
      throw new Error('Este atendimento já está em finalização e não aceita um rascunho anterior.');
    }
    if (wantsFinalize) encounterLifecycle.set(id, 'finalizing');

    return queueEncounterWrite(id, async () => {
      if (!wantsFinalize) return repos.encounters.update(id, payload);
      const appointmentId = String(payload.appointment_id || '');
      if (!appointmentId) {
        encounterLifecycle.delete(id);
        throw new Error('Agendamento do prontuário não encontrado para finalizar.');
      }
      const appointmentPatch = pendingAppointmentFinalization.get(appointmentId) || {};
      const startsAt = payload.identification?.startsAt || appointmentPatch.starts_at || new Date().toISOString();
      const followupAt = followupDue(payload.care_plan?.followup, startsAt);
      const amountCents = Math.max(0, Math.round(Number(payload.identification?.value || 0) * 100));
      const result = await repos.client.rpc('finalize_clinical_encounter_atomic', {
        p_request_key: `encounter:${id}:finalize`,
        p_appointment_id: appointmentId,
        p_encounter_id: id,
        p_appointment_patch: appointmentPatch,
        p_encounter_patch: payload,
        p_weights: finalizationWeights(payload),
        p_followup: followupAt ? {
          baby_id: payload.baby_id || null,
          due_at: followupAt,
          notes: 'Acompanhamento após atendimento',
        } : null,
        p_financial: amountCents > 0 ? {
          description: payload.identification?.appointmentType || 'Atendimento',
          amount_cents: amountCents,
          due_at: String(startsAt).slice(0, 10),
        } : null,
      });
      pendingAppointmentFinalization.delete(appointmentId);
      encounterLifecycle.set(id, 'finalized');
      return { id, ...payload, ...(result || {}) };
    }).catch((error) => {
      if (wantsFinalize && encounterLifecycle.get(id) === 'finalizing') encounterLifecycle.delete(id);
      throw error;
    });
  }

  async function updateAppointment(id, payload = {}) {
    if (String(payload.status || '') === 'Realizado') {
      pendingAppointmentFinalization.set(id, { ...(pendingAppointmentFinalization.get(id) || {}), ...payload });
      return { id, ...payload };
    }
    return repos.appointments.update(id, payload);
  }

  async function addWeight(payload = {}) {
    if (!payload.encounter_id || !payload.baby_id) return repos.weights.create(payload);
    const existing = await repos.weights.list({
      query: `select=*&encounter_id=eq.${encodeURIComponent(payload.encounter_id)}&baby_id=eq.${encodeURIComponent(payload.baby_id)}&limit=1`
    });
    if (existing[0]?.id) return repos.weights.update(existing[0].id, payload);
    return repos.weights.create(payload);
  }

  return {
    repos,
    listPatients,
    getPatient,
    createPatient,
    updatePatient,
    createAppointment: (payload) => repos.appointments.create(payload),
    scheduleAppointment: (payload) => repos.client.rpc('schedule_clinical_appointment', payload),
    startClinicalEncounter,
    startClinicalEncounterFromAppointment: (appointmentId) => repos.client.rpc('start_clinical_encounter_from_appointment', { p_appointment_id: appointmentId }),
    deleteScheduledAppointment: (appointmentId, confirmation = 'EXCLUIR') => repos.client.rpc('delete_scheduled_appointment', { p_appointment_id: appointmentId, p_confirmation: confirmation }),
    createEncounter: (payload) => repos.encounters.create(payload),
    getEncounter: (id) => repos.encounters.get(id),
    updateEncounter,
    addWeight,
    listWeights: (babyId) => repos.weights.list({ query: `select=*&baby_id=eq.${encodeURIComponent(babyId)}&order=measured_at.asc` }),
    createFollowup: (payload) => repos.followups.create(payload),
    createOrSupersedeFollowup: (payload) => repos.client.rpc('create_or_supersede_followup', {
      p_mother_id: payload.mother_id,
      p_baby_id: payload.baby_id || null,
      p_encounter_id: payload.encounter_id,
      p_due_at: payload.due_at,
      p_notes: payload.notes || ''
    }),
    listFollowups: ({ status } = {}) => repos.followups.list({ query: `select=*&order=due_at.asc${status ? `&status=eq.${encodeURIComponent(status)}` : ''}` }),
    completeFollowup: (id, completedAt = new Date().toISOString()) => repos.followups.update(id, { status: 'Concluído', completed_at: completedAt }),
    createFinancialEntry: (payload) => repos.financial.create(payload),
    ensureFinancialEntryForEncounter: (payload) => repos.client.rpc('ensure_financial_entry_for_encounter', {
      p_mother_id: payload.mother_id,
      p_appointment_id: payload.appointment_id || null,
      p_encounter_id: payload.encounter_id,
      p_description: payload.description || 'Atendimento',
      p_amount_cents: Number(payload.amount_cents || 0),
      p_due_at: payload.due_at
    }),
    setFinancialPaymentState: (id, paid, paymentMethod = 'Pix') => repos.client.rpc('set_financial_payment_state', {
      p_entry_id: id,
      p_paid: Boolean(paid),
      p_payment_method: paymentMethod || ''
    }),
    listFinalizedEncounters: () => repos.client.rest('clinical_encounters', {
      query: 'select=id,mother_id,baby_id,appointment_id,status,occurred_at,created_at&status=eq.finalized&order=occurred_at.desc'
    }),
    listAppointments: async ({ from, to } = {}) => {
      const filters = ['select=*', 'order=starts_at.asc'];
      if (from) filters.push(`starts_at=gte.${encodeURIComponent(from)}`);
      if (to) filters.push(`starts_at=lt.${encodeURIComponent(to)}`);
      const appointments = await repos.appointments.list({ query: filters.join('&') });
      if (!appointments.length) return appointments;
      const [babyLinks, encounters] = await Promise.all([
        repos.client.rest('appointment_babies', { query: 'select=appointment_id,baby_id,is_primary&order=created_at.asc' }),
        repos.client.rest('clinical_encounters', { query: 'select=id,appointment_id,status,created_at&appointment_id=not.is.null&order=created_at.desc' })
      ]);
      const linksByAppointment = new Map();
      for (const link of babyLinks || []) {
        if (!linksByAppointment.has(link.appointment_id)) linksByAppointment.set(link.appointment_id, []);
        linksByAppointment.get(link.appointment_id).push(link);
      }
      const encounterByAppointment = new Map();
      for (const encounter of encounters || []) {
        if (!encounterByAppointment.has(encounter.appointment_id)) encounterByAppointment.set(encounter.appointment_id, encounter);
      }
      return appointments.map((appointment) => {
        const links = linksByAppointment.get(appointment.id) || [];
        const encounter = encounterByAppointment.get(appointment.id) || null;
        const babyIds = links.map((link) => link.baby_id);
        if (!babyIds.length && appointment.baby_id) babyIds.push(appointment.baby_id);
        return {
          ...appointment,
          baby_ids: babyIds,
          encounter_id: encounter?.id || null,
          encounter_status: encounter?.status || null
        };
      });
    },
    updateAppointment,
    listEncounters: (motherId) => repos.encounters.list({ query: `select=*&mother_id=eq.${encodeURIComponent(motherId)}&order=occurred_at.desc` }),
    listEncounterIdsForBaby: async (babyId) => {
      const rows = await repos.client.rest('clinical_encounter_babies', { query: `select=encounter_id&baby_id=eq.${encodeURIComponent(babyId)}&order=created_at.desc` });
      return rows.map((row) => row.encounter_id);
    },
    listConsents: (motherId) => repos.consents.list({ query: `select=*&mother_id=eq.${encodeURIComponent(motherId)}&order=consent_type.asc` }),
    saveConsents: async (motherId, consentMap = {}) => {
      const rows = Object.entries(consentMap).map(([consent_type, granted]) => ({ mother_id: motherId, consent_type, granted: Boolean(granted), accepted_at: granted ? new Date().toISOString() : null, revoked_at: granted ? null : new Date().toISOString() }));
      if (!rows.length) return [];
      return repos.client.rest('consents', { method: 'POST', query: 'on_conflict=owner_id,mother_id,consent_type', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: rows });
    },
    listFinancialEntries: () => repos.financial.list({ query: 'select=*&order=created_at.desc' }),
    markFinancialPaid: (id, paymentMethod = 'Pix') => repos.client.rpc('set_financial_payment_state', { p_entry_id: id, p_paid: true, p_payment_method: paymentMethod || 'Pix' }),
    undoFinancialPaid: (id) => repos.client.rpc('set_financial_payment_state', { p_entry_id: id, p_paid: false, p_payment_method: '' })
  };
}
