const DEMO_PROFILE = {
  business_name: 'Test Salon',
  offerings: 'Haircuts, braids, and styling',
  prices: 'Haircuts from $20, Braids from $50',
  common_questions: 'Do you take walk-ins? What are your hours?',
  tone: 'friendly',
  contact_email: 'hello@testsalon.com',
  restrictions: 'Never offer discounts. Do not promise same-day braids.',
};

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const GRAPH_API = 'https://graph.facebook.com/v21.0';

function parseBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  const raw = typeof req.body === 'string' ? req.body : '';
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
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

async function generateReply(customerMessage) {
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
      system: buildSystemPrompt(DEMO_PROFILE),
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
  return data.content?.[0]?.text?.trim() || '';
}

function extractIncomingMessages(payload) {
  const messages = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value;
      if (!value?.messages) continue;
      for (const msg of value.messages) {
        if (msg.type !== 'text' || !msg.text?.body) continue;
        messages.push({
          from: String(msg.from || ''),
          body: String(msg.text.body || '').trim(),
          id: msg.id,
        });
      }
    }
  }
  return messages;
}

async function sendWhatsAppText(to, body) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    throw new Error('WhatsApp send not configured');
  }

  const response = await fetch(`${GRAPH_API}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || 'WhatsApp send failed');
  }
  return data;
}

function verifyWebhook(req) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected = process.env.WHATSAPP_VERIFY_TOKEN || '';

  if (mode === 'subscribe' && token && token === expected) {
    return { ok: true, challenge };
  }
  return { ok: false };
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    const result = verifyWebhook(req);
    if (result.ok) {
      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(result.challenge);
    }
    return res.status(403).send('Forbidden');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const payload = parseBody(req);
  const incoming = extractIncomingMessages(payload);

  // Meta expects a fast 200 even for status-only webhooks.
  if (!incoming.length) {
    return res.status(200).json({ status: 'ok' });
  }

  const errors = [];
  for (const msg of incoming) {
    if (!msg.from || !msg.body || msg.body.length > 2000) continue;
    try {
      const reply = await generateReply(msg.body);
      await sendWhatsAppText(msg.from, reply);
    } catch (err) {
      errors.push(err.message || 'failed');
      try {
        await sendWhatsAppText(
          msg.from,
          'Sorry, we could not process your message right now. Please try again shortly.'
        );
      } catch {
        // ignore secondary failure
      }
    }
  }

  return res.status(200).json({
    status: errors.length ? 'partial' : 'ok',
    processed: incoming.length,
    errors: errors.length ? errors : undefined,
  });
};
