const { getUserFromRequest, supabaseRest, setCors } = require('../lib/supabase-server');
const {
  buildAuthUrl,
  verifyOAuthState,
  exchangeCodeForTokens,
  getProfileEmail,
  appOrigin,
} = require('../lib/gmail');

function gmailAction(req) {
  const raw = req.url || '';
  const path = raw.split('?')[0] || '';
  if (path.endsWith('/connect')) return 'connect';
  if (path.endsWith('/callback')) return 'callback';
  if (path.endsWith('/status')) return 'status';
  if (path.endsWith('/disconnect')) return 'disconnect';
  return '';
}

async function handleConnect(req, res) {
  if (setCors(req, res)) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Not signed in' });
  }

  const profiles = await supabaseRest(
    `user_business_profiles?user_id=eq.${user.id}&select=business_name&limit=1`,
    { useServiceRole: true }
  );
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  if (!profile?.business_name) {
    return res.status(400).json({ error: 'Complete your business profile before connecting Gmail' });
  }

  const url = buildAuthUrl(user.id);
  return res.status(200).json({ url });
}

async function handleCallback(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).send('Method not allowed');
  }

  const code = String(req.query.code || '');
  const state = String(req.query.state || '');
  const oauthError = String(req.query.error || '');
  const dashboard = `${appOrigin()}/dashboard`;

  if (oauthError) {
    return res.redirect(302, `${dashboard}?gmail=error&reason=${encodeURIComponent(oauthError)}`);
  }

  const userId = verifyOAuthState(state);
  if (!userId || !code) {
    return res.redirect(302, `${dashboard}?gmail=error&reason=invalid_state`);
  }

  const tokens = await exchangeCodeForTokens(code);
  const accessToken = tokens.access_token;
  const refreshToken = tokens.refresh_token || '';
  const gmailAddress = await getProfileEmail(accessToken);
  const tokenExpiresAt = new Date(
    Date.now() + (tokens.expires_in || 3600) * 1000
  ).toISOString();

  if (!refreshToken) {
    return res.redirect(302, `${dashboard}?gmail=error&reason=no_refresh_token`);
  }

  await supabaseRest('gmail_connections?on_conflict=user_id', {
    method: 'POST',
    useServiceRole: true,
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: {
      user_id: userId,
      gmail_address: gmailAddress,
      access_token: accessToken,
      refresh_token: refreshToken,
      token_expires_at: tokenExpiresAt,
      enabled: true,
      last_error: null,
      updated_at: new Date().toISOString(),
    },
  });

  return res.redirect(302, `${dashboard}?gmail=connected`);
}

async function handleStatus(req, res) {
  if (setCors(req, res)) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Not signed in' });
  }

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');

  const [connections, messages] = await Promise.all([
    supabaseRest(
      `gmail_connections?user_id=eq.${user.id}&select=gmail_address,enabled,last_poll_at,last_error,created_at,updated_at`,
      { headers: { Authorization: `Bearer ${token}` } }
    ),
    supabaseRest(
      `email_messages?user_id=eq.${user.id}&select=id,customer_name,customer_email,subject,status,created_at&order=created_at.desc&limit=10`,
      { headers: { Authorization: `Bearer ${token}` } }
    ),
  ]);

  const connection = Array.isArray(connections) ? connections[0] : null;

  return res.status(200).json({
    connected: Boolean(connection?.gmail_address),
    connection: connection || null,
    recentMessages: Array.isArray(messages) ? messages : [],
  });
}

async function handleDisconnect(req, res) {
  if (setCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Not signed in' });
  }

  await supabaseRest(`gmail_connections?user_id=eq.${user.id}`, {
    method: 'DELETE',
    useServiceRole: true,
  });

  return res.status(200).json({ success: true });
}

module.exports = async (req, res) => {
  try {
    const action = gmailAction(req);
    if (action === 'connect') return handleConnect(req, res);
    if (action === 'callback') return handleCallback(req, res);
    if (action === 'status') return handleStatus(req, res);
    if (action === 'disconnect') return handleDisconnect(req, res);
    return res.status(404).json({ error: 'Not found' });
  } catch (err) {
    if (gmailAction(req) === 'callback') {
      const reason = encodeURIComponent(err.message || 'callback_failed');
      return res.redirect(302, `${appOrigin()}/dashboard?gmail=error&reason=${reason}`);
    }
    return res.status(500).json({ error: err.message || 'Gmail request failed' });
  }
};
