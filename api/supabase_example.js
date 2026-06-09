// Minimal Vercel serverless function showing how to call Supabase REST
// Place this file in `api/` — Vercel will deploy it as a serverless function.

module.exports = async (req, res) => {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    res.status(500).send('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables');
    return;
  }

  try {
    const fetchUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/messages?select=*&limit=10`;
    const r = await fetch(fetchUrl, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    const data = await r.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
};
