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
  if (raw.trim().startsWith('{')) {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

function buildSystemPrompt(profile) {
  return (
    `You are an AI employee for ${profile.business_name}. ` +
    `Your job is to reply to customer emails on their behalf. ` +
    `Use only the information in the business profile below to answer. ` +
    `Never invent prices, services, or facts. ` +
    `Match the tone specified. ` +
    `Keep replies concise (2-3 short paragraphs). ` +
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
      max_tokens: 512,
      system: buildSystemPrompt(DEMO_PROFILE),
      messages: [{
        role: 'user',
        content:
          `Reply to this customer message. Write only the reply body.\n\nSubject: Customer inquiry\n\n${customerMessage}`,
      }],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || 'AI request failed');
  }
  return data.content?.[0]?.text?.trim() || '';
}

async function handleRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'POST') {
    const body = parseBody(req);
    const demoMessage = String(body.message || '').trim();
    if (demoMessage) {
      if (demoMessage.length > 1000) {
        return res.status(400).json({ error: 'Please send a customer message (max 1000 characters).' });
      }
      try {
        const reply = await generateReply(demoMessage);
        return res.status(200).json({ reply, business_name: DEMO_PROFILE.business_name });
      } catch (err) {
        return res.status(500).json({ error: err.message || 'Demo failed. Please try again.' });
      }
    }
  }

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    paypalClientId: process.env.PAYPAL_CLIENT_ID || '',
    paypalPlanId: process.env.PAYPAL_PLAN_ID || '',
    paypalMode: process.env.PAYPAL_MODE || 'live',
  });
}

module.exports = (req, res) => {
  handleRequest(req, res).catch(() => {
    res.status(500).json({ error: 'Server error' });
  });
};
