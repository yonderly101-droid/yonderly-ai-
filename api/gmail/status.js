const { getUserFromRequest, supabaseRest, setCors } = require('../../lib/supabase-server');

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
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to load Gmail status' });
  }
};
