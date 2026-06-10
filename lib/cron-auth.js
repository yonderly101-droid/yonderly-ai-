const { createRemoteJWKSet, jwtVerify } = require('jose');

const GITHUB_JWKS = createRemoteJWKSet(
  new URL('https://token.actions.githubusercontent.com/.well-known/jwks')
);

function bearerToken(req) {
  const auth = req.headers.authorization || req.headers.Authorization || '';
  if (!auth.startsWith('Bearer ')) return '';
  return auth.slice(7).trim();
}

async function verifyGithubActionsToken(token) {
  const expectedRepo = (
    process.env.GITHUB_ACTIONS_REPO || 'yonderly101-droid/yonderly-ai-'
  ).toLowerCase();
  const audience = process.env.GITHUB_ACTIONS_AUDIENCE || 'yonderly-cron';

  const { payload } = await jwtVerify(token, GITHUB_JWKS, {
    issuer: 'https://token.actions.githubusercontent.com',
    audience,
  });

  const sub = String(payload.sub || '').toLowerCase();
  if (!sub.startsWith(`repo:${expectedRepo}:`)) {
    throw new Error('Unexpected GitHub Actions repository');
  }

  return payload;
}

async function isAuthorizedCron(req) {
  const token = bearerToken(req);
  if (!token) return false;

  const secret = process.env.CRON_SECRET;
  if (secret && token === secret) return true;

  try {
    await verifyGithubActionsToken(token);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  isAuthorizedCron,
  verifyGithubActionsToken,
};
