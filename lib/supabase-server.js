function supabaseUrl() {
  return (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ''
  ).replace(/\/$/, '');
}

function supabaseAnonKey() {
  return (
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ''
  );
}

function supabaseServiceKey() {
  return (
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    ''
  );
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  const raw = typeof req.body === 'string' ? req.body : '';
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function bearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  if (!header.startsWith('Bearer ')) return '';
  return header.slice(7).trim();
}

async function getUserFromRequest(req) {
  const token = bearerToken(req);
  const url = supabaseUrl();
  const anonKey = supabaseAnonKey();
  if (!token || !url || !anonKey) return null;

  try {
    const response = await fetch(`${url}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
      },
    });

    if (!response.ok) return null;
    return response.json();
  } catch (err) {
    const hint =
      'Cannot reach Supabase — verify SUPABASE_URL in Vercel matches Settings → API in your Supabase dashboard.';
    throw new Error(err.message === 'fetch failed' ? hint : err.message);
  }
}

async function supabaseRest(path, options = {}) {
  const url = supabaseUrl();
  const key = options.useServiceRole ? supabaseServiceKey() : supabaseAnonKey();
  if (!url || !key) {
    throw new Error('Supabase is not configured');
  }

  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const response = await fetch(`${url}/rest/v1/${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body
      ? JSON.stringify(Array.isArray(options.body) ? options.body : [options.body])
      : undefined,
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
      (data && data.message) ||
      (data && data.error) ||
      `Supabase request failed (${response.status})`;
    throw new Error(message);
  }

  return data;
}

async function getPayPalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_SECRET;
  const mode = process.env.PAYPAL_MODE || 'live';
  if (!clientId || !secret) {
    throw new Error('PayPal is not configured');
  }

  const base =
    mode === 'sandbox'
      ? 'https://api-m.sandbox.paypal.com'
      : 'https://api-m.paypal.com';

  const credentials = Buffer.from(`${clientId}:${secret}`).toString('base64');
  const response = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error_description || 'PayPal auth failed');
  }
  return { token: data.access_token, base };
}

async function fetchPayPalSubscription(subscriptionId) {
  const { token, base } = await getPayPalAccessToken();
  const response = await fetch(`${base}/v1/billing/subscriptions/${subscriptionId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'PayPal subscription lookup failed');
  }
  return data;
}

function subscriptionRequired() {
  return process.env.REQUIRE_SUBSCRIPTION === 'true';
}

function setCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}

module.exports = {
  supabaseUrl,
  supabaseAnonKey,
  parseBody,
  bearerToken,
  getUserFromRequest,
  supabaseRest,
  fetchPayPalSubscription,
  setCors,
  subscriptionRequired,
};
