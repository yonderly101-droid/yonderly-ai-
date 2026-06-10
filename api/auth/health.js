const { supabaseUrl, supabaseAnonKey, setCors } = require('../../lib/supabase-server');

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
    const response = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: supabaseAnonKey() },
    });
    return res.status(200).json({
      ok: response.ok,
      supabaseUrl: url,
      status: response.status,
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
