const { supabaseRest } = require('../../lib/supabase-server');
const {
  verifyOAuthState,
  exchangeCodeForTokens,
  getProfileEmail,
  appOrigin,
} = require('../../lib/gmail');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).send('Method not allowed');
  }

  const code = String(req.query.code || '');
  const state = String(req.query.state || '');
  const oauthError = String(req.query.error || '');

  const dashboard = `${appOrigin()}/dashboard`;

  if (oauthError) {
    return res.redirect(302, `${dashboard}?gmail=error&reason=${encodeURIComponent(oauthError)}`);
  }

  const userId = verifyOAuthState(state);
  if (!userId || !code) {
    return res.redirect(302, `${dashboard}?gmail=error&reason=invalid_state`);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token || '';
    const gmailAddress = await getProfileEmail(accessToken);
    const tokenExpiresAt = new Date(
      Date.now() + (tokens.expires_in || 3600) * 1000
    ).toISOString();

    if (!refreshToken) {
      return res.redirect(302, `${dashboard}?gmail=error&reason=no_refresh_token`);
    }

    await supabaseRest('gmail_connections?on_conflict=user_id', {
      method: 'POST',
      useServiceRole: true,
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: {
        user_id: userId,
        gmail_address: gmailAddress,
        access_token: accessToken,
        refresh_token: refreshToken,
        token_expires_at: tokenExpiresAt,
        enabled: true,
        last_error: null,
        updated_at: new Date().toISOString(),
      },
    });

    return res.redirect(302, `${dashboard}?gmail=connected`);
  } catch (err) {
    const reason = encodeURIComponent(err.message || 'callback_failed');
    return res.redirect(302, `${dashboard}?gmail=error&reason=${reason}`);
  }
};
