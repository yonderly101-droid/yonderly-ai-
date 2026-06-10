const crypto = require('crypto');

const GITHUB_JWKS_URL = 'https://token.actions.githubusercontent.com/.well-known/jwks';
let jwksCache = { fetchedAt: 0, keys: [] };

function bearerToken(req) {
  const auth = req.headers.authorization || req.headers.Authorization || '';
  if (!auth.startsWith('Bearer ')) return '';
  return auth.slice(7).trim();
}

function decodePart(part) {
  const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

async function getGithubJwks() {
  const now = Date.now();
  if (jwksCache.keys.length && now - jwksCache.fetchedAt < 60 * 60 * 1000) {
    return jwksCache.keys;
  }

  const response = await fetch(GITHUB_JWKS_URL);
  if (!response.ok) {
    throw new Error('Could not fetch GitHub Actions JWKS');
  }
  const data = await response.json();
  jwksCache = { fetchedAt: now, keys: Array.isArray(data.keys) ? data.keys : [] };
  return jwksCache.keys;
}

function verifyJwtSignature(token, jwk) {
  const [headerPart, payloadPart, signaturePart] = token.split('.');
  if (!headerPart || !payloadPart || !signaturePart) {
    throw new Error('Invalid JWT format');
  }

  const signed = `${headerPart}.${payloadPart}`;
  const signature = Buffer.from(signaturePart.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const keyObject = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const valid = crypto.verify('RSA-SHA256', Buffer.from(signed), keyObject, signature);
  if (!valid) {
    throw new Error('Invalid JWT signature');
  }

  return decodePart(payloadPart);
}

async function verifyGithubActionsToken(token) {
  const expectedRepo = (
    process.env.GITHUB_ACTIONS_REPO || 'yonderly101-droid/yonderly-ai-'
  ).toLowerCase();
  const audience = process.env.GITHUB_ACTIONS_AUDIENCE || 'yonderly-cron';

  const header = decodePart(token.split('.')[0] || '');
  if (header.alg !== 'RS256') {
    throw new Error('Unexpected JWT algorithm');
  }

  const keys = await getGithubJwks();
  const jwk = keys.find((entry) => entry.kid === header.kid);
  if (!jwk) {
    throw new Error('Unknown JWT key id');
  }

  const payload = verifyJwtSignature(token, jwk);

  if (payload.iss !== 'https://token.actions.githubusercontent.com') {
    throw new Error('Unexpected JWT issuer');
  }

  const aud = payload.aud;
  const audienceOk = Array.isArray(aud) ? aud.includes(audience) : aud === audience;
  if (!audienceOk) {
    throw new Error('Unexpected JWT audience');
  }

  if (payload.exp && Date.now() / 1000 >= payload.exp) {
    throw new Error('JWT expired');
  }

  const repository = String(payload.repository || '').toLowerCase();
  if (repository !== expectedRepo) {
    throw new Error(`Unexpected GitHub repository: ${payload.repository || 'unknown'}`);
  }

  return payload;
}

async function isAuthorizedCron(req) {
  const token = bearerToken(req);
  if (!token) return { ok: false, reason: 'missing_token' };

  const secret = process.env.CRON_SECRET;
  if (secret && token === secret) return { ok: true };

  try {
    await verifyGithubActionsToken(token);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message || 'oidc_failed' };
  }
}

module.exports = {
  isAuthorizedCron,
  verifyGithubActionsToken,
};
