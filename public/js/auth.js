(function (global) {
  let client = null;
  let configCache = null;

  async function loadConfig() {
    if (configCache) return configCache;
    let res;
    try {
      res = await fetch('/api/config');
    } catch {
      throw new Error('Could not reach Yonderly. Check your internet connection and try again.');
    }
    if (!res.ok) throw new Error('Could not load app config');
    configCache = await res.json();
    return configCache;
  }

  async function appOrigin() {
    const host = global.location.hostname;
    if (host === 'www.yonderly.online' || host === 'yonderly.online') {
      return 'https://yonderly.online';
    }
    return global.location.origin;
  }

  async function getClient() {
    if (client) return client;
    const config = await loadConfig();
    const url = config.supabaseUrl;
    const key = config.supabaseAnonKey || config.supabasePublishableKey;
    if (!url || !key) {
      throw new Error('Supabase is not configured. Contact support.');
    }
    client = global.supabase.createClient(url, key, {
      auth: {
        flowType: 'implicit',
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
        storage: global.localStorage,
      },
    });
    return client;
  }

  function authErrorMessage(err) {
    const msg = err && err.message ? err.message : String(err || '');
    if (/failed to fetch|networkerror|network request failed/i.test(msg)) {
      return (
        'Could not reach Supabase. In your Supabase dashboard go to Settings → API, ' +
        'copy Project URL, and set SUPABASE_URL on Vercel to match exactly.'
      );
    }
    return msg || 'Authentication failed';
  }

  async function getSession() {
    const sb = await getClient();
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    return data.session;
  }

  async function handleOAuthReturn() {
    const sb = await getClient();
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    if (data.session && global.history.replaceState) {
      global.history.replaceState({}, '', global.location.pathname + global.location.search);
    }
    return data.session;
  }

  async function requireSession(redirectTo) {
    const session = await getSession();
    if (!session) {
      const next = redirectTo || global.location.pathname;
      global.location.href = '/login?next=' + encodeURIComponent(next);
      return null;
    }
    return session;
  }

  async function signUp(email, password, fullName) {
    const sb = await getClient();
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName || '' },
        emailRedirectTo: global.location.origin + '/login',
      },
    });
    if (error) throw new Error(authErrorMessage(error));
    return data;
  }

  async function signIn(email, password) {
    const sb = await getClient();
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(authErrorMessage(error));
    return data;
  }

  async function signInWithGoogle(nextPath) {
    const sb = await getClient();
    const next = nextPath || '/dashboard';
    const origin = await appOrigin();
    const redirectTo = origin + '/login?next=' + encodeURIComponent(next);
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) throw new Error(authErrorMessage(error));
  }

  async function signOut() {
    const sb = await getClient();
    await sb.auth.signOut();
    global.location.href = '/login';
  }

  async function fetchAccount() {
    const session = await getSession();
    if (!session) return null;
    let res;
    try {
      res = await fetch('/api/account/me', {
        headers: { Authorization: 'Bearer ' + session.access_token },
      });
    } catch {
      throw new Error('Could not load your account. Try again in a moment.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Could not load account');
    }
    return res.json();
  }

  async function activateSubscription(subscriptionId) {
    const session = await getSession();
    if (!session) throw new Error('Not signed in');
    const res = await fetch('/api/subscription/activate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + session.access_token,
      },
      body: JSON.stringify({ subscription_id: subscriptionId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Activation failed');
    return data;
  }

  async function saveProfile(profile) {
    const session = await getSession();
    if (!session) throw new Error('Not signed in');
    const res = await fetch('/api/account/profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + session.access_token,
      },
      body: JSON.stringify(profile),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed');
    return data;
  }

  async function connectGmail() {
    const session = await getSession();
    if (!session) throw new Error('Not signed in');
    const res = await fetch('/api/gmail/connect', {
      headers: { Authorization: 'Bearer ' + session.access_token },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not start Gmail connect');
    global.location.href = data.url;
  }

  async function fetchGmailStatus() {
    const session = await getSession();
    if (!session) return null;
    const res = await fetch('/api/gmail/status', {
      headers: { Authorization: 'Bearer ' + session.access_token },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Could not load Gmail status');
    }
    return res.json();
  }

  async function disconnectGmail() {
    const session = await getSession();
    if (!session) throw new Error('Not signed in');
    const res = await fetch('/api/gmail/disconnect', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + session.access_token },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Disconnect failed');
    return data;
  }

  global.YonderlyAuth = {
    loadConfig,
    getClient,
    getSession,
    handleOAuthReturn,
    requireSession,
    signUp,
    signIn,
    signInWithGoogle,
    signOut,
    fetchAccount,
    activateSubscription,
    saveProfile,
    connectGmail,
    fetchGmailStatus,
    disconnectGmail,
    authErrorMessage,
  };
})(window);
