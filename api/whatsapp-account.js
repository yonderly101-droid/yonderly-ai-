const { getUserFromRequest, supabaseRest, setCors, parseBody } = require('../lib/supabase-server');
const {
  fetchDisplayPhone,
  subscribeWabaToApp,
  fallbackPhoneNumberId,
} = require('../lib/whatsapp-meta');

function routeAction(req) {
  const raw = req.url || '';
  const path = raw.split('?')[0] || '';
  if (path.endsWith('/config')) return 'config';
  if (path.endsWith('/complete')) return 'complete';
  if (path.endsWith('/status')) return 'status';
  if (path.endsWith('/disconnect')) return 'disconnect';
  return '';
}

async function handleConfig(req, res) {
  if (setCors(req, res)) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });

  const metaAppId = process.env.META_APP_ID || process.env.WHATSAPP_APP_ID || '';
  const embeddedConfigId =
    process.env.WHATSAPP_EMBEDDED_CONFIG_ID || process.env.META_EMBEDDED_CONFIG_ID || '';

  return res.status(200).json({
    metaAppId,
    embeddedConfigId,
    ready: Boolean(metaAppId && embeddedConfigId),
  });
}

async function handleComplete(req, res) {
  if (setCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });

  const profiles = await supabaseRest(
    `user_business_profiles?user_id=eq.${user.id}&select=business_name&limit=1`,
    { useServiceRole: true }
  );
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  if (!profile?.business_name) {
    return res.status(400).json({ error: 'Complete your business profile first' });
  }

  const body = parseBody(req);
  const phoneNumberId = String(body.phone_number_id || '').replace(/\D/g, '');
  const wabaId = String(body.waba_id || '').replace(/\D/g, '');

  if (!phoneNumberId) {
    return res.status(400).json({ error: 'Phone number ID is required (from Meta → WhatsApp → API Setup)' });
  }

  const existing = await supabaseRest(
    `whatsapp_connections?phone_number_id=eq.${encodeURIComponent(phoneNumberId)}&select=user_id&limit=1`,
    { useServiceRole: true }
  );
  const taken = Array.isArray(existing) ? existing[0] : null;
  if (taken && taken.user_id !== user.id) {
    return res.status(409).json({ error: 'This WhatsApp number is already linked to another account' });
  }

  let displayPhone = '';
  try {
    displayPhone = await fetchDisplayPhone(phoneNumberId);
  } catch {
    displayPhone = String(body.display_phone_number || '').trim();
  }

  if (wabaId) {
    try {
      await subscribeWabaToApp(wabaId);
    } catch (err) {
      return res.status(502).json({
        error: 'Could not register WhatsApp with Meta: ' + (err.message || 'subscribe failed'),
      });
    }
  }

  await supabaseRest('whatsapp_connections?on_conflict=user_id', {
    method: 'POST',
    useServiceRole: true,
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: {
      user_id: user.id,
      phone_number_id: phoneNumberId,
      waba_id: wabaId,
      display_phone_number: displayPhone,
      enabled: true,
      updated_at: new Date().toISOString(),
    },
  });

  try {
    await supabaseRest(`user_business_profiles?user_id=eq.${user.id}`, {
      method: 'PATCH',
      useServiceRole: true,
      rawBody: true,
      body: {
        whatsapp_phone: displayPhone,
        updated_at: new Date().toISOString(),
      },
    });
  } catch {
    // whatsapp_phone column optional until migration runs
  }

  return res.status(200).json({
    success: true,
    connection: {
      phone_number_id: phoneNumberId,
      display_phone_number: displayPhone,
      waba_id: wabaId,
    },
  });
}

async function handleStatus(req, res) {
  if (setCors(req, res)) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const rows = await supabaseRest(
    `whatsapp_connections?user_id=eq.${user.id}&select=phone_number_id,display_phone_number,waba_id,enabled,created_at,updated_at`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const connection = Array.isArray(rows) ? rows[0] : null;

  const metaAppId = process.env.META_APP_ID || process.env.WHATSAPP_APP_ID || '';
  const embeddedConfigId =
    process.env.WHATSAPP_EMBEDDED_CONFIG_ID || process.env.META_EMBEDDED_CONFIG_ID || '';

  return res.status(200).json({
    connected: Boolean(connection?.phone_number_id),
    connection: connection || null,
    embeddedSignupReady: Boolean(metaAppId && embeddedConfigId),
    legacyTestNumber: fallbackPhoneNumberId() || null,
  });
}

async function handleDisconnect(req, res) {
  if (setCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });

  await supabaseRest(`whatsapp_connections?user_id=eq.${user.id}`, {
    method: 'DELETE',
    useServiceRole: true,
  });

  return res.status(200).json({ success: true });
}

module.exports = async (req, res) => {
  try {
    const action = routeAction(req);
    if (action === 'config') return handleConfig(req, res);
    if (action === 'complete') return handleComplete(req, res);
    if (action === 'status') return handleStatus(req, res);
    if (action === 'disconnect') return handleDisconnect(req, res);
    return res.status(404).json({ error: 'Not found' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'WhatsApp account request failed' });
  }
};
