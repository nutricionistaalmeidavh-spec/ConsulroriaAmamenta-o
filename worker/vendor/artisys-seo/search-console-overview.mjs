import { normalizeSearchConsoleSiteUrl } from './search-console.mjs';

function required(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} is required`);
  return value.trim();
}

function asMetricRow(row) {
  if (!row) return { clicks: 0, impressions: 0, ctr: 0, position: null };
  return {
    clicks: Number.isFinite(row.clicks) ? row.clicks : 0,
    impressions: Number.isFinite(row.impressions) ? row.impressions : 0,
    ctr: Number.isFinite(row.ctr) ? row.ctr : 0,
    position: Number.isFinite(row.position) ? row.position : null
  };
}

function mapRows(rows, keyName) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    [keyName]: Array.isArray(row.keys) ? row.keys[0] ?? '' : '',
    ...asMetricRow(row)
  }));
}

export async function loadSearchConsoleOverview(input) {
  if (!input || typeof input !== 'object') throw new TypeError('input must be an object');
  if (!input.client || typeof input.client.querySearchAnalytics !== 'function') throw new TypeError('client.querySearchAnalytics must be a function');
  const siteUrl = normalizeSearchConsoleSiteUrl(input.siteUrl);
  const startDate = required(input.startDate, 'startDate');
  const endDate = required(input.endDate, 'endDate');
  const rowLimit = input.rowLimit === undefined ? 10 : input.rowLimit;
  if (!Number.isInteger(rowLimit) || rowLimit < 1 || rowLimit > 25000) throw new RangeError('rowLimit must be an integer between 1 and 25000');

  const base = { siteUrl, startDate, endDate };
  const [aggregate, queryRows, pageRows] = await Promise.all([
    input.client.querySearchAnalytics({ ...base, dimensions: [], rowLimit: 1 }),
    input.client.querySearchAnalytics({ ...base, dimensions: ['query'], rowLimit }),
    input.client.querySearchAnalytics({ ...base, dimensions: ['page'], rowLimit })
  ]);

  return Object.freeze({
    siteUrl,
    period: Object.freeze({ startDate, endDate }),
    metrics: Object.freeze(asMetricRow(aggregate?.rows?.[0])),
    topQueries: Object.freeze(mapRows(queryRows?.rows, 'query')),
    topPages: Object.freeze(mapRows(pageRows?.rows, 'page'))
  });
}
