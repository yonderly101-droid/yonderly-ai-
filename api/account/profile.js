const {
  getUserFromRequest,
  parseBody,
  supabaseRest,
  setCors,
} = require('../../lib/supabase-server');

const TONES = new Set(['professional', 'friendly', 'casual']);

function cleanText(value, max) {
  return String(value || '').trim().slice(0, max);
}

module.exports = async (req, res) => {
  if (setCors(req, res)) return;

  if (req.method === 'GET') {
    try {
      const user = await getUserFromRequest(req);
      if (!user) return res.status(401).json({ error: 'Not signed in' });

      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const rows = await supabaseRest(
        `user_business_profiles?user_id=eq.${user.id}&select=*`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      return res.status(200).json({ profile: Array.isArray(rows) ? rows[0] || null : null });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to load profile' });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Not signed in' });

    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const subs = await supabaseRest(
      `subscriptions?user_id=eq.${user.id}&select=status`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const subscription = Array.isArray(subs) ? subs[0] : null;
    if (!subscription || subscription.status !== 'active') {
      return res.status(403).json({ error: 'Active subscription required' });
    }

    const body = parseBody(req);
    const tone = cleanText(body.tone, 20);
    if (!TONES.has(tone)) {
      return res.status(400).json({ error: 'Invalid tone' });
    }

    const profile = {
      user_id: user.id,
      business_name: cleanText(body.business_name, 200),
      offerings: cleanText(body.offerings, 2000),
      prices: cleanText(body.prices, 1000),
      common_questions: cleanText(body.common_questions, 2000),
      tone,
      contact_email: cleanText(body.contact_email, 320).toLowerCase(),
      restrictions: cleanText(body.restrictions, 1000),
      updated_at: new Date().toISOString(),
    };

    if (!profile.business_name || !profile.contact_email) {
      return res.status(400).json({ error: 'Business name and contact email are required' });
    }

    await supabaseRest('user_business_profiles?on_conflict=user_id', {
      method: 'POST',
      useServiceRole: true,
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: profile,
    });

    return res.status(200).json({ success: true, profile });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to save profile' });
  }
};
