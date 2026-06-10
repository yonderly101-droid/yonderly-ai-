const crypto = require('crypto');

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
].join(' ');

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';

function appOrigin() {
  return (process.env.APP_URL || 'https://yonderly.online').replace(/\/$/, '');
}

function oauthSecret() {
  return (
    process.env.GMAIL_OAUTH_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET ||
    process.env.CRON_SECRET ||
    'yonderly-gmail-oauth'
  );
}

function googleClientId() {
  return process.env.GOOGLE_CLIENT_ID || '';
}

function googleClientSecret() {
  return process.env.GOOGLE_CLIENT_SECRET || '';
}

function redirectUri() {
  return `${appOrigin()}/api/gmail/callback`;
}

function signOAuthState(userId) {
  const payload = JSON.stringify({ userId, ts: Date.now() });
  const sig = crypto
    .createHmac('sha256', oauthSecret())
    .update(payload)
    .digest('hex');
  return Buffer.from(JSON.stringify({ payload, sig })).toString('base64url');
}

function verifyOAuthState(state) {
  if (!state) return null;
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
    const expected = crypto
      .createHmac('sha256', oauthSecret())
      .update(parsed.payload)
      .digest('hex');
    if (expected !== parsed.sig) return null;
    const data = JSON.parse(parsed.payload);
    if (Date.now() - data.ts > 15 * 60 * 1000) return null;
    return data.userId;
  } catch {
    return null;
  }
}

function buildAuthUrl(userId) {
  const clientId = googleClientId();
  if (!clientId) throw new Error('Google OAuth is not configured');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: GMAIL_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state: signOAuthState(userId),
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
  const clientId = googleClientId();
  const clientSecret = googleClientSecret();
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth is not configured');
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error_description || data.error || 'Token exchange failed');
  }
  return data;
}

async function refreshAccessToken(refreshToken) {
  const clientId = googleClientId();
  const clientSecret = googleClientSecret();
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Cannot refresh Gmail token');
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error_description || data.error || 'Token refresh failed');
  }
  return data;
}

async function gmailFetch(accessToken, path, options = {}) {
  const response = await fetch(`${GMAIL_API}${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const message =
      (data && data.error && data.error.message) ||
      (data && data.message) ||
      `Gmail API error (${response.status})`;
    throw new Error(message);
  }

  return data;
}

async function getProfileEmail(accessToken) {
  const profile = await gmailFetch(accessToken, '/users/me/profile');
  return profile.emailAddress || '';
}

function extractEmailAddress(headerValue) {
  const match = String(headerValue || '').match(/<([^>]+)>/);
  if (match) return match[1].toLowerCase();
  return String(headerValue || '').trim().toLowerCase();
}

function extractCustomerName(headerValue) {
  const match = String(headerValue || '').match(/^(.+?)\s*</);
  if (match) {
    const name = match[1].trim().replace(/^["']|["']$/g, '');
    if (name) return name;
  }
  const address = extractEmailAddress(headerValue);
  return address.includes('@') ? address.split('@')[0] : 'Unknown';
}

function getHeader(headers, name) {
  for (const header of headers || []) {
    if (header.name.toLowerCase() === name.toLowerCase()) return header.value;
  }
  return '';
}

function decodeEmailBody(payload) {
  if (!payload) return '';

  if (payload.parts) {
    for (const part of payload.parts) {
      const mimeType = part.mimeType || '';
      if (mimeType === 'text/plain' && part.body && part.body.data) {
        return Buffer.from(part.body.data, 'base64url').toString('utf8').trim();
      }
      if (mimeType.startsWith('multipart/')) {
        const nested = decodeEmailBody(part);
        if (nested) return nested;
      }
    }
    return '';
  }

  if (payload.mimeType === 'text/plain' && payload.body && payload.body.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf8').trim();
  }

  return '';
}

function buildRawReply(originalEmail, replyText, fromEmail) {
  const customerAddress = extractEmailAddress(originalEmail.from);
  const subject = originalEmail.subject || '(no subject)';
  const replySubject = subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;

  const lines = [
    `To: ${customerAddress}`,
    `From: ${fromEmail}`,
    `Subject: ${replySubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
  ];

  if (originalEmail.message_id) {
    lines.push(`In-Reply-To: ${originalEmail.message_id}`);
    lines.push(`References: ${originalEmail.message_id}`);
  }

  lines.push('', replyText);

  const raw = lines.join('\r\n');
  return Buffer.from(raw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function listUnreadInbox(accessToken, maxResults = 20) {
  const list = await gmailFetch(
    accessToken,
    `/users/me/messages?labelIds=INBOX&labelIds=UNREAD&maxResults=${maxResults}`
  );

  const refs = list.messages || [];
  if (!refs.length) return [];

  const emails = [];
  for (const ref of refs) {
    const msg = await gmailFetch(
      accessToken,
      `/users/me/messages/${ref.id}?format=full`
    );
    const headers = msg.payload?.headers || [];
    emails.push({
      id: msg.id,
      thread_id: msg.threadId,
      from: getHeader(headers, 'From'),
      subject: getHeader(headers, 'Subject') || '(no subject)',
      body: decodeEmailBody(msg.payload),
      message_id: getHeader(headers, 'Message-ID'),
      list_unsubscribe: getHeader(headers, 'List-Unsubscribe'),
      label_ids: msg.labelIds || [],
    });
  }

  return emails;
}

async function sendReply(accessToken, originalEmail, replyText, fromEmail) {
  const raw = buildRawReply(originalEmail, replyText, fromEmail);
  return gmailFetch(accessToken, '/users/me/messages/send', {
    method: 'POST',
    body: { raw, threadId: originalEmail.thread_id },
  });
}

async function markAsRead(accessToken, messageId) {
  return gmailFetch(accessToken, `/users/me/messages/${messageId}/modify`, {
    method: 'POST',
    body: { removeLabelIds: ['UNREAD'] },
  });
}

module.exports = {
  GMAIL_SCOPES,
  appOrigin,
  redirectUri,
  buildAuthUrl,
  verifyOAuthState,
  exchangeCodeForTokens,
  refreshAccessToken,
  getProfileEmail,
  listUnreadInbox,
  sendReply,
  markAsRead,
  extractEmailAddress,
  extractCustomerName,
};
