const enc = new TextEncoder();

export const CLOUDFLARE_PBKDF2_ITERATIONS = 100000;

function bytesFromB64url(value) {
  let normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  while (normalized.length % 4) normalized += '=';
  const binary = atob(normalized);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
}

function b64urlBytes(bytes) {
  let binary = '';
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const value of data) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function cloudflarePasswordHash(password, salt, iterations = CLOUDFLARE_PBKDF2_ITERATIONS) {
  const count = Number(iterations || 0);
  if (!Number.isInteger(count) || count < 1 || count > CLOUDFLARE_PBKDF2_ITERATIONS) {
    throw new Error('unsupported_pbkdf2_iterations');
  }
  const key = await crypto.subtle.importKey('raw', enc.encode(String(password || '')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: bytesFromB64url(salt),
    iterations: count,
  }, key, 256);
  return b64urlBytes(bits);
}
