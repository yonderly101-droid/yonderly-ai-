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

function extractMessageFields(data) {
  const message = String(
    data.message ||
      data.body ||
      data.text ||
      data.customer_message ||
      data.Message ||
      data.Body ||
      ''
  ).trim();

  const customer = String(
    data.from ||
      data.customer_phone ||
      data.customer_number ||
      data.phone ||
      data.sender ||
      data.From ||
      'unknown'
  ).trim();

  return { customer, message };
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

async function notifyPabbly(customer, message, reply) {
  const url = process.env.PABBLY_WEBHOOK_URL;
  if (!url) return;

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_number: customer,
        customer_message: message,
        reply,
        business_name: DEMO_PROFILE.business_name,
      }),
    });
  } catch {
    // best-effort
  }
}

function checkAuth(req) {
  const secret = process.env.PABBLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const provided = req.headers['x-pabbly-secret'] || req.query?.secret || '';
  return provided === secret;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Pabbly-Secret');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', service: 'yonderly-pabbly' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!checkAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = parseBody(req);
  const { customer, message } = extractMessageFields(body);

  if (!message) {
    return res.status(400).json({ error: 'Missing customer message (use message, body, or text)' });
  }

  try {
    const reply = await generateReply(message);
    await notifyPabbly(customer, message, reply);
    return res.status(200).json({
      reply,
      business_name: DEMO_PROFILE.business_name,
      customer_number: customer,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Reply failed' });
  }
};
