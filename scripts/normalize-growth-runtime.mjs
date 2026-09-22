import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const LEGACY_ORIGIN = 'https://zxowxdfhtksevhnjmeyu.supabase.co';
const LEGACY_KEY = 'sb_publishable_yXYUcXiks3Usr1GxHMw2Mg_cPMLD3zt';
const GROWTH_FILE = new URL('../public/growth-feature.js', import.meta.url);

export function normalizeGrowthRuntimeSource(source) {
  return String(source)
    .replace(`const SB_URL='${LEGACY_ORIGIN}';const SB_KEY='${LEGACY_KEY}';`, "const SB_URL=globalThis.location?.origin||'';const SB_KEY='cloudflare-runtime';")
    .replace("const SB_URL=window.location.origin;const SB_KEY='cloudflare-runtime';", "const SB_URL=globalThis.location?.origin||'';const SB_KEY='cloudflare-runtime';")
    .replace("const WHO_BASE='./who/v2026-08-30/';", "const WHO_BASE='/who/v2026-08-30/';");
}

export async function normalizeGrowthRuntime({ write = true } = {}) {
  const source = await readFile(GROWTH_FILE, 'utf8');
  const normalized = normalizeGrowthRuntimeSource(source);
  if (normalized === source) {
    if (/zxowxdfhtksevhnjmeyu|supabase\.co/i.test(source)) {
      throw new Error('growth_runtime_legacy_origin_not_normalized');
    }
    return { changed: false, source };
  }
  if (/zxowxdfhtksevhnjmeyu|supabase\.co/i.test(normalized)) {
    throw new Error('growth_runtime_still_contains_legacy_origin');
  }
  if (!normalized.includes("const SB_URL=globalThis.location?.origin||''") || !normalized.includes("const WHO_BASE='/who/v2026-08-30/'")) {
    throw new Error('growth_runtime_cloudflare_contract_missing');
  }
  if (write) await writeFile(GROWTH_FILE, normalized, 'utf8');
  return { changed: true, source: normalized };
}

const executedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (executedDirectly) {
  await normalizeGrowthRuntime({ write: !process.argv.includes('--check') });
}
