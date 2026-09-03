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

export function createAppData(repos) {
  if (!repos) throw new Error('Repositórios são obrigatórios.');

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

  return {
    repos,
    listPatients,
    getPatient,
    createPatient,
    updatePatient,
    createAppointment: (payload) => repos.appointments.create(payload),
    startClinicalEncounter: (payload) => repos.client.rpc('start_clinical_encounter', payload),
    createEncounter: (payload) => repos.encounters.create(payload),
    getEncounter: (id) => repos.encounters.get(id),
    updateEncounter: (id, payload) => repos.encounters.update(id, payload),
    addWeight: (payload) => repos.weights.create(payload),
    listWeights: (babyId) => repos.weights.list({ query: `select=*&baby_id=eq.${encodeURIComponent(babyId)}&order=measured_at.asc` }),
    createFollowup: (payload) => repos.followups.create(payload),
    listFollowups: ({ status } = {}) => repos.followups.list({ query: `select=*&order=due_at.asc${status ? `&status=eq.${encodeURIComponent(status)}` : ''}` }),
    completeFollowup: (id, completedAt = new Date().toISOString()) => repos.followups.update(id, { status: 'Concluído', completed_at: completedAt }),
    createFinancialEntry: (payload) => repos.financial.create(payload),
    listAppointments: ({ from, to } = {}) => {
      const filters = ['select=*', 'order=starts_at.asc'];
      if (from) filters.push(`starts_at=gte.${encodeURIComponent(from)}`);
      if (to) filters.push(`starts_at=lt.${encodeURIComponent(to)}`);
      return repos.appointments.list({ query: filters.join('&') });
    },
    updateAppointment: (id, payload) => repos.appointments.update(id, payload),
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
    markFinancialPaid: (id, paymentMethod, paidAt = new Date().toISOString()) => repos.financial.update(id, { status: 'Pago', payment_method: paymentMethod, paid_at: paidAt })
  };
}
