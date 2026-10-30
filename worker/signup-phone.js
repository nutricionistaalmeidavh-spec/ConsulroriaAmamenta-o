// Phone is contact information, never an authentication or recovery factor.
// Legacy callers may omit it; no migration of existing users is required.
export function normalizeConsultantSignupPhone(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (!/^[+()\d\s.-]+$/.test(raw)) throw new Error('invalid_signup_phone');
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) digits = digits.slice(2);
  if (![10, 11].includes(digits.length) || digits[0] === '0' || digits[1] === '0') {
    throw new Error('invalid_signup_phone');
  }
  const local = digits.slice(2);
  return `(${digits.slice(0, 2)}) ${local.slice(0, -4)}-${local.slice(-4)}`;
}
