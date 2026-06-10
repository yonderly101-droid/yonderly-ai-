const {
  getUserFromRequest,
  parseBody,
  supabaseRest,
  fetchPayPalSubscription,
  setCors,
} = require('../../lib/supabase-server');

module.exports = async (req, res) => {
  if (setCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Sign in first, then activate your subscription' });
    }

    const body = parseBody(req);
    const subscriptionId = String(body.subscription_id || body.subscriptionID || '').trim();
    if (!subscriptionId) {
      return res.status(400).json({ error: 'Missing subscription_id' });
    }

    const paypalSub = await fetchPayPalSubscription(subscriptionId);
    const paypalStatus = String(paypalSub.status || '').toUpperCase();
    const allowed = ['ACTIVE', 'APPROVAL_PENDING', 'APPROVED'];
    if (!allowed.includes(paypalStatus)) {
      return res.status(400).json({
        error: `Subscription is not active (PayPal status: ${paypalSub.status})`,
      });
    }

    const row = {
      user_id: user.id,
      paypal_subscription_id: subscriptionId,
      status: paypalStatus === 'ACTIVE' ? 'active' : 'pending',
      plan_id: paypalSub.plan_id || body.plan_id || null,
      activated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await supabaseRest('subscriptions?on_conflict=user_id', {
      method: 'POST',
      useServiceRole: true,
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: row,
    });

    return res.status(200).json({
      success: true,
      status: row.status,
      subscription_id: subscriptionId,
      next: row.status === 'active' ? '/onboarding' : '/dashboard',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Activation failed' });
  }
};
