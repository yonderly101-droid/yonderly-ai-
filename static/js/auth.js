(function (global) {
  let client = null;

  async function loadConfig() {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error('Could not load app config');
    return res.json();
  }

  async function getClient() {
    if (client) return client;
    const config = await loadConfig();
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error('Supabase is not configured on the server');
    }
    client = global.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    return client;
  }

  async function getSession() {
    const sb = await getClient();
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
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
      options: { data: { full_name: fullName || '' } },
    });
    if (error) throw error;
    return data;
  }

  async function signIn(email, password) {
    const sb = await getClient();
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    const sb = await getClient();
    await sb.auth.signOut();
    global.location.href = '/login';
  }

  async function fetchAccount() {
    const session = await getSession();
    if (!session) return null;
    const res = await fetch('/api/account/me', {
      headers: { Authorization: 'Bearer ' + session.access_token },
    });
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

  global.YonderlyAuth = {
    loadConfig,
    getClient,
    getSession,
    requireSession,
    signUp,
    signIn,
    signOut,
    fetchAccount,
    activateSubscription,
    saveProfile,
  };
})(window);
