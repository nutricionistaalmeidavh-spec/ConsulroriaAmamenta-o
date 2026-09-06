function cleanObject(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

function first(result) {
  return Array.isArray(result) ? result[0] ?? null : result;
}

function createTableRepository(client, table) {
  return {
    async list({ query = 'select=*&order=created_at.desc' } = {}) {
      return client.rest(table, { query });
    },
    async get(id) {
      return first(await client.rest(table, { query: `select=*&id=eq.${encodeURIComponent(id)}&limit=1` }));
    },
    async create(payload) {
      return first(await client.rest(table, {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: cleanObject(payload)
      }));
    },
    async update(id, payload) {
      return first(await client.rest(table, {
        method: 'PATCH',
        query: `id=eq.${encodeURIComponent(id)}`,
        headers: { Prefer: 'return=representation' },
        body: cleanObject(payload)
      }));
    },
    async remove(id) {
      await client.rest(table, { method: 'DELETE', query: `id=eq.${encodeURIComponent(id)}` });
    }
  };
}

export function createRepositories(client) {
  if (!client) throw new Error('Cliente de dados é obrigatório.');
  return {
    client,
    mothers: createTableRepository(client, 'mothers'),
    babies: createTableRepository(client, 'babies'),
    appointments: createTableRepository(client, 'appointments'),
    encounters: createTableRepository(client, 'clinical_encounters'),
    weights: createTableRepository(client, 'weights'),
    followups: createTableRepository(client, 'followups'),
    financial: createTableRepository(client, 'financial_entries'),
    consents: createTableRepository(client, 'consents'),
    library: createTableRepository(client, 'library_items'),
    media: createTableRepository(client, 'media')
  };
}
