const { supabaseRest } = require('./supabase-server');

const GRAPH_API = 'https://graph.facebook.com/v21.0';
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

function platformToken() {
  return process.env.WHATSAPP_ACCESS_TOKEN || '';
}

function fallbackPhoneNumberId() {
  return process.env.WHATSAPP_PHONE_NUMBER_ID || '';
}

function buildSystemPrompt(profile) {
  return (
    `You are an AI employee for ${profile.business_name}. ` +
    `Your job is to reply to customer WhatsApp messages on their behalf. ` +
    `Use only the information in the business profile below to answer. ` +
    `Never invent prices, services, or facts. ` +
    `Match the tone specified. ` +
    `Keep replies concise for WhatsApp (2-3 short paragraphs max). ` +
    `Always sign off as 'The ${profile.business_name} Team, powered by Yonderly'. ` +
    `Business profile: ${JSON.stringify(profile, null, 2)}`
  );
}

function profileFromRow(row) {
  return {
    business_name: row.business_name,
    offerings: row.offerings,
    prices: row.prices,
    common_questions: row.common_questions,
    tone: row.tone,
    contact_email: row.contact_email,
    restrictions: row.restrictions,
  };
}

async function graphFetch(path, options = {}) {
  const token = platformToken();
  if (!token) throw new Error('WhatsApp platform token not configured');

  const response = await fetch(`${GRAPH_API}${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const message =
      (data && data.error && data.error.message) ||
      (data && data.message) ||
      `Meta API error (${response.status})`;
    throw new Error(message);
  }

  return data;
}

async function fetchDisplayPhone(phoneNumberId) {
  const data = await graphFetch(`/${phoneNumberId}?fields=display_phone_number,verified_name`);
  return data.display_phone_number || '';
}

async function subscribeWabaToApp(wabaId) {
  if (!wabaId) return;
  await graphFetch(`/${wabaId}/subscribed_apps`, { method: 'POST' });
}

async function getConnectionByPhoneNumberId(phoneNumberId) {
  if (!phoneNumberId) return null;
  const rows = await supabaseRest(
    `whatsapp_connections?phone_number_id=eq.${encodeURIComponent(phoneNumberId)}&enabled=eq.true&select=*`,
    { useServiceRole: true }
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function getBusinessProfileForUser(userId) {
  const rows = await supabaseRest(
    `user_business_profiles?user_id=eq.${userId}&select=*`,
    { useServiceRole: true }
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function generateReply(profile, customerMessage) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('AI key not configured');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: buildSystemPrompt(profile),
      messages: [{
        role: 'user',
        content:
          `Reply to this customer WhatsApp message. Write only the message body.\n\n${customerMessage}`,
      }],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || 'AI request failed');
  }
  return (data.content?.[0]?.text || '').trim();
}

async function sendWhatsAppText(to, body, phoneNumberId) {
  const token = platformToken();
  const fromId = phoneNumberId || fallbackPhoneNumberId();
  if (!token || !fromId) {
    throw new Error('WhatsApp send not configured');
  }

  const data = await graphFetch(`/${fromId}/messages`, {
    method: 'POST',
    body: {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    },
  });
  return data;
}

function extractIncomingMessages(payload) {
  const messages = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value;
      if (!value?.messages) continue;
      const phoneNumberId = String(value.metadata?.phone_number_id || '');
      for (const msg of value.messages) {
        if (msg.type !== 'text' || !msg.text?.body) continue;
        messages.push({
          from: String(msg.from || ''),
          body: String(msg.text.body || '').trim(),
          id: msg.id,
          phone_number_id: phoneNumberId,
        });
      }
    }
  }
  return messages;
}

async function resolveTenantContext(phoneNumberId) {
  const connection = await getConnectionByPhoneNumberId(phoneNumberId);
  if (connection) {
    const profile = await getBusinessProfileForUser(connection.user_id);
    if (profile?.business_name) {
      return {
        phoneNumberId: connection.phone_number_id,
        profile: profileFromRow(profile),
        businessName: profile.business_name,
      };
    }
  }

  const fallbackId = fallbackPhoneNumberId();
  if (!phoneNumberId || phoneNumberId === fallbackId) {
    return {
      phoneNumberId: fallbackId,
      profile: {
        business_name: 'Test Salon',
        offerings: 'Haircuts, braids, and styling',
        prices: 'Haircuts from $20, Braids from $50',
        common_questions: 'Do you take walk-ins? What are your hours?',
        tone: 'friendly',
        contact_email: 'hello@testsalon.com',
        restrictions: 'Never offer discounts.',
      },
      businessName: 'Test Salon',
      legacy: true,
    };
  }

  return null;
}

module.exports = {
  GRAPH_API,
  platformToken,
  fallbackPhoneNumberId,
  fetchDisplayPhone,
  subscribeWabaToApp,
  getConnectionByPhoneNumberId,
  getBusinessProfileForUser,
  generateReply,
  sendWhatsAppText,
  extractIncomingMessages,
  resolveTenantContext,
  profileFromRow,
};
