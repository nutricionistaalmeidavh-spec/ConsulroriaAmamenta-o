export const SEARCH_CONSOLE_READONLY_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

const API_BASE = 'https://www.googleapis.com/webmasters/v3';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} is required`);
  return value.trim();
}

function asScopeList(scopes) {
  if (scopes === undefined || scopes === null) return [];
  if (typeof scopes === 'string') return scopes.split(/\s+/).filter(Boolean);
  if (!Array.isArray(scopes)) throw new TypeError('scopes must be an array or space-delimited string');
  return scopes.map((scope) => requireText(scope, 'scope'));
}

export function withSearchConsoleReadonlyScope(scopes = []) {
  return [...new Set([...asScopeList(scopes), SEARCH_CONSOLE_READONLY_SCOPE])];
}

export function normalizeSearchConsoleSiteUrl(value) {
  const text = requireText(value, 'siteUrl');
  if (text.startsWith('sc-domain:')) {
    const domain = text.slice('sc-domain:'.length).trim().replace(/\/$/, '').toLowerCase();
    if (!domain || domain.includes('/') || /\s/.test(domain)) throw new TypeError('siteUrl domain property is invalid');
    return `sc-domain:${domain}`;
  }

  if (/^https?:\/\//i.test(text)) {
    let url;
    try {
      url = new URL(text);
    } catch {
      throw new TypeError('siteUrl URL-prefix property is invalid');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new TypeError('siteUrl URL-prefix property is invalid');
    }
    return url.href;
  }

  let domainUrl;
  try {
    domainUrl = new URL(`https://${text}`);
  } catch {
    throw new TypeError('siteUrl domain property is invalid');
  }
  if (domainUrl.pathname !== '/' || domainUrl.search || domainUrl.hash || domainUrl.username || domainUrl.password || /\s/.test(domainUrl.hostname)) {
    throw new TypeError('siteUrl domain property is invalid');
  }
  return `sc-domain:${domainUrl.hostname.toLowerCase()}`;
}

export class SearchConsoleApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'SearchConsoleApiError';
    this.status = status;
    this.body = body;
  }
}

function validateDate(value, label) {
  const text = requireText(value, label);
  if (!DATE_RE.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) throw new TypeError(`${label} must use YYYY-MM-DD`);
  return text;
}

function validateQuery(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('query input must be an object');
  const startDate = validateDate(input.startDate, 'startDate');
  const endDate = validateDate(input.endDate, 'endDate');
  if (startDate > endDate) throw new RangeError('startDate cannot be after endDate');

  const dimensions = input.dimensions === undefined ? ['query'] : input.dimensions;
  if (!Array.isArray(dimensions) || dimensions.some((value) => typeof value !== 'string' || value.trim() === '')) {
    throw new TypeError('dimensions must be an array of non-empty strings');
  }

  const rowLimit = input.rowLimit === undefined ? 1000 : input.rowLimit;
  if (!Number.isInteger(rowLimit) || rowLimit < 1 || rowLimit > 25000) throw new RangeError('rowLimit must be an integer between 1 and 25000');
  const startRow = input.startRow === undefined ? 0 : input.startRow;
  if (!Number.isInteger(startRow) || startRow < 0) throw new RangeError('startRow must be a non-negative integer');

  const body = {
    startDate,
    endDate,
    dimensions: dimensions.map((value) => value.trim()),
    type: input.type === undefined ? 'web' : requireText(input.type, 'type'),
    rowLimit,
    startRow
  };
  for (const key of ['aggregationType', 'dataState']) {
    if (input[key] !== undefined) body[key] = requireText(input[key], key);
  }
  if (input.dimensionFilterGroups !== undefined) {
    if (!Array.isArray(input.dimensionFilterGroups)) throw new TypeError('dimensionFilterGroups must be an array');
    body.dimensionFilterGroups = input.dimensionFilterGroups;
  }
  return body;
}

async function readResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function createSearchConsoleClient(options) {
  if (!options || typeof options !== 'object') throw new TypeError('options must be an object');
  if (typeof options.getAccessToken !== 'function') throw new TypeError('getAccessToken must be a function');
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch must be a function');

  async function request(url, init = {}) {
    const token = requireText(await options.getAccessToken(), 'access token');
    const headers = {
      Accept: 'application/json',
      ...init.headers,
      Authorization: `Bearer ${token}`
    };
    const response = await fetchImpl(url, { ...init, headers });
    const body = await readResponse(response);
    if (!response.ok) {
      const message = body?.error?.message || body?.message || `Search Console API request failed with HTTP ${response.status}`;
      throw new SearchConsoleApiError(message, { status: response.status, body });
    }
    return body;
  }

  return Object.freeze({
    async listSites() {
      const data = await request(`${API_BASE}/sites`, { method: 'GET' });
      return Array.isArray(data?.siteEntry) ? data.siteEntry : [];
    },

    async querySearchAnalytics(input) {
      if (!input || typeof input !== 'object') throw new TypeError('query input must be an object');
      const siteUrl = normalizeSearchConsoleSiteUrl(input.siteUrl);
      const body = validateQuery(input);
      const data = await request(`${API_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return { ...(data || {}), rows: Array.isArray(data?.rows) ? data.rows : [] };
    }
  });
}
