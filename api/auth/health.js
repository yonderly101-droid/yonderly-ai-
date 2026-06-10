const { supabaseUrl, supabaseAnonKey, setCors } = require('../../lib/supabase-server');

const GRAPH_API = 'https://graph.facebook.com/v21.0';

async function checkWhatsAppToken() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || '';
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';

  if (!token || !phoneNumberId) {
    return {
      ok: false,
      configured: false,
      error: 'WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID not set on Vercel',
    };
  }

  try {
    const response = await fetch(`${GRAPH_API}/${phoneNumberId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json();
    if (!response.ok) {
      const message = data?.error?.message || 'Meta API rejected the token';
      const expired = data?.error?.code === 190;
      return {
        ok: false,
        configured: true,
        expired,
        error: message,
        fix: expired
          ? 'Meta → WhatsApp → API Setup → Generate access token → update WHATSAPP_ACCESS_TOKEN on Vercel → redeploy'
          : 'Check WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID on Vercel',
      };
    }
    return {
      ok: true,
      configured: true,
      phone: data.display_phone_number || null,
    };
  } catch (err) {
    return { ok: false, configured: true, error: err.message || 'Token check failed' };
  }
}

module.exports = async (req, res) => {
  if (setCors(req, res)) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = supabaseUrl();
  if (!url) {
    return res.status(503).json({ ok: false, error: 'SUPABASE_URL not set' });
  }

  try {
    const [supabaseResponse, whatsapp] = await Promise.all([
      fetch(`${url}/auth/v1/health`, {
        headers: { apikey: supabaseAnonKey() },
      }),
      checkWhatsAppToken(),
    ]);

    return res.status(200).json({
      ok: supabaseResponse.ok && whatsapp.ok,
      supabaseUrl: url,
      supabase: { ok: supabaseResponse.ok, status: supabaseResponse.status },
      whatsapp,
      embeddedSignup: {
        metaAppId: process.env.META_APP_ID || process.env.WHATSAPP_APP_ID || '',
        configIdSet: Boolean(
          process.env.WHATSAPP_EMBEDDED_CONFIG_ID || process.env.META_EMBEDDED_CONFIG_ID
        ),
        ready: Boolean(
          (process.env.META_APP_ID || process.env.WHATSAPP_APP_ID) &&
          (process.env.WHATSAPP_EMBEDDED_CONFIG_ID || process.env.META_EMBEDDED_CONFIG_ID)
        ),
      },
      emailCron: {
        secretConfigured: Boolean(process.env.CRON_SECRET),
        note: 'GitHub Actions workflow email-poll.yml hits /api/cron/email-poll every 10 minutes',
      },
    });
  } catch (err) {
    return res.status(503).json({
      ok: false,
      supabaseUrl: url,
      error: 'Cannot reach Supabase. Update SUPABASE_URL in Vercel to your real project URL from Supabase → Settings → API.',
      detail: err.message,
    });
  }
};
