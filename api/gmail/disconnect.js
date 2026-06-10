const { getUserFromRequest, supabaseRest, setCors } = require('../../lib/supabase-server');

module.exports = async (req, res) => {
  if (setCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Not signed in' });
    }

    await supabaseRest(`gmail_connections?user_id=eq.${user.id}`, {
      method: 'DELETE',
      useServiceRole: true,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to disconnect Gmail' });
  }
};
