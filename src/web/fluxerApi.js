const OAUTH_AUTHORIZE_URL =
  process.env.FLUXER_OAUTH_AUTHORIZE_URL ||
  'https://fluxer.app/oauth2/authorize';

const OAUTH_TOKEN_URL =
  process.env.FLUXER_OAUTH_TOKEN_URL ||
  'https://api.fluxer.app/api/v1/oauth2/token';

const API_BASE = (
  process.env.FLUXER_API_BASE ||
  'https://api.fluxer.app/api/v1'
).replace(/\/+$/, '');

const CDN_BASE = (
  process.env.FLUXER_CDN_BASE ||
  'https://fluxerusercontent.com'
).replace(/\/+$/, '');

export const SCOPES = 'identify guilds';

const ADMINISTRATOR = 1n << 3n;
const MANAGE_GUILD = 1n << 5n;

export function buildAuthorizeUrl({ clientId, redirectUri, state }) {
  const url = new URL(OAUTH_AUTHORIZE_URL);

  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('state', state);

  return url.toString();
}

async function tokenRequest(body) {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
   headers: {
  'Content-Type': 'application/x-www-form-urlencoded',
  Accept: 'application/json',
},
    body: new URLSearchParams(body).toString(),
  });

  const responseText = await res.text();

  let data = {};
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {

  }

  if (!res.ok || !data.access_token) {
    const safeBody = responseText
      .slice(0, 500)
      .replace(/[\r\n\t]+/g, ' ');

    const error = new Error(
      `Fluxer token request failed (${res.status}) ` +
      `at ${OAUTH_TOKEN_URL}; response: ` +
      `${safeBody || '(empty response)'}`
    );

    error.status = res.status;
    throw error;
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt:
      Math.floor(Date.now() / 1000) +
      Number(data.expires_in ?? 3600),
  };
}

export function exchangeCode({
  clientId,
  clientSecret,
  redirectUri,
  code,
}) {
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });
}

export function refreshAccessToken({
  clientId,
  clientSecret,
  refreshToken,
}) {
  return tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
}

async function apiGet(path, accessToken) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const error = new Error(
      `Fluxer API ${path} failed (${res.status})`
    );
    error.status = res.status;
    throw error;
  }

  return res.json();
}

export const fetchCurrentUser = (accessToken) =>
  apiGet('/users/@me', accessToken);

export const fetchUserGuilds = (accessToken) =>
  apiGet('/users/@me/guilds', accessToken);

/** True when the user owns the guild, is an Administrator, or has Manage Community. */
export function canManageGuild(guild) {
  if (guild?.owner === true) return true;

  try {
    const perms = BigInt(guild?.permissions ?? '0');
    return (
      (perms & (ADMINISTRATOR | MANAGE_GUILD)) !== 0n
    );
  } catch {
    return false;
  }
}

export function guildIconUrl(id, hash, size = 128) {
  if (!hash) return null;

  const ext = String(hash).startsWith('a_') ? 'gif' : 'png';

  return `${CDN_BASE}/icons/${id}/${hash}.${ext}?size=${size}`;
}

export function userAvatarUrl(id, hash, size = 128) {
  if (!hash) return null;

  const ext = String(hash).startsWith('a_') ? 'gif' : 'png';

  return `${CDN_BASE}/avatars/${id}/${hash}.${ext}?size=${size}`;
}