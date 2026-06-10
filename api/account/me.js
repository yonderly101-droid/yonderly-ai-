const {
  getUserFromRequest,
  supabaseRest,
  setCors,
  subscriptionRequired,
} = require('../../lib/supabase-server');

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

    const userId = user.id;
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');

    const [subscriptions, profiles] = await Promise.all([
      supabaseRest(`subscriptions?user_id=eq.${userId}&select=*`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      supabaseRest(`user_business_profiles?user_id=eq.${userId}&select=*`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);

    const subscription = Array.isArray(subscriptions) ? subscriptions[0] : null;
    const businessProfile = Array.isArray(profiles) ? profiles[0] : null;
    const isActive =
      !subscriptionRequired() || subscription?.status === 'active';

    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
      },
      subscription: subscription || null,
      isActive,
      requireSubscription: subscriptionRequired(),
      hasBusinessProfile: Boolean(businessProfile?.business_name),
      businessProfile: businessProfile || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to load account' });
  }
};
