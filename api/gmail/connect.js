const { getUserFromRequest, supabaseRest, setCors } = require('../../lib/supabase-server');
const { buildAuthUrl } = require('../../lib/gmail');

module.exports = async (req, res) => {
  if (setCors(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
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
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Could not start Gmail connect' });
  }
};
