function required(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} is required`);
  return value.trim();
}

export class GoogleOAuthTokenError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'GoogleOAuthTokenError';
    this.status = status;
    this.body = body;
  }
}

export function createGoogleRefreshTokenProvider(options) {
  if (!options || typeof options !== 'object') throw new TypeError('options must be an object');
  const clientId = required(options.clientId, 'clientId');
  const clientSecret = required(options.clientSecret, 'clientSecret');
  const refreshToken = required(options.refreshToken, 'refreshToken');
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch must be a function');
  const now = typeof options.now === 'function' ? options.now : Date.now;

  let cachedAccessToken = null;
  let expiresAt = 0;
  const refreshSkewMs = 60_000;

  return async function getAccessToken() {
    const currentTime = Number(now());
    if (cachedAccessToken && Number.isFinite(currentTime) && currentTime < (expiresAt - refreshSkewMs)) {
      return cachedAccessToken;
    }

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    }).toString();

    const response = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }

    if (!response.ok) {
      const message = payload?.error_description || payload?.error || `Google OAuth token refresh failed with HTTP ${response.status}`;
      throw new GoogleOAuthTokenError(message, { status: response.status, body: payload });
    }

    const accessToken = required(payload?.access_token, 'access token');
    const expiresIn = Number(payload?.expires_in);
    cachedAccessToken = accessToken;
    expiresAt = currentTime + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 3_600_000);
    return cachedAccessToken;
  };
}
