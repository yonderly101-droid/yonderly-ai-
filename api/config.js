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

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSystemPrompt(profile, channel) {
  const channelLabel = channel === 'whatsapp' ? 'WhatsApp messages' : 'emails';
  const lengthHint =
    channel === 'whatsapp'
      ? 'Keep replies concise for WhatsApp (2-3 short paragraphs max).'
      : 'Keep replies concise (2-3 short paragraphs).';

  return (
    `You are an AI employee for ${profile.business_name}. ` +
    `Your job is to reply to customer ${channelLabel} on their behalf. ` +
    `Use only the information in the business profile below to answer. ` +
    `Never invent prices, services, or facts. ` +
    `Match the tone specified. ` +
    `${lengthHint} ` +
    `Always sign off as 'The ${profile.business_name} Team, powered by Yonderly'. ` +
    `Business profile: ${JSON.stringify(profile, null, 2)}`
  );
}

function parseFormBody(req) {
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

async function generateReply(customerMessage, profile, channel) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('AI key not configured');
  }

  const userMessage =
    channel === 'whatsapp'
      ? `Reply to this customer WhatsApp message. Write only the message body — no labels or prefixes.\n\n${customerMessage}`
      : `Reply to this customer message. Write only the reply body — no subject line.\n\nSubject: Customer inquiry\n\n${customerMessage}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: channel === 'whatsapp' ? 1024 : 512,
      system: buildSystemPrompt(profile, channel),
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || 'AI request failed');
  }

  return data.content?.[0]?.text?.trim() || '';
}

async function handleRequest(req, res) {
  if (req.method === 'POST') {
    const body = parseFormBody(req);

    if (body.From) {
      if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
        return res.status(503).send('WhatsApp not configured');
      }

      const fromNumber = String(body.From || '').trim();
      const message = String(body.Body || '').trim();

      if (!fromNumber || !message) {
        return res.status(200).type('text/xml').send(
          '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
        );
      }

      if (message.length > 2000) {
        const msg = 'Message too long. Please send a shorter message.';
        return res.status(200).type('text/xml').send(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(msg)}</Message></Response>`
        );
      }

      try {
        const reply = await generateReply(message, DEMO_PROFILE, 'whatsapp');
        return res.status(200).type('text/xml').send(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(reply)}</Message></Response>`
        );
      } catch {
        const fallback =
          'Sorry, we could not process your message right now. Please try again shortly.';
        return res.status(200).type('text/xml').send(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(fallback)}</Message></Response>`
        );
      }
    }

    const demoMessage = String(body.message || '').trim();
    if (demoMessage) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (demoMessage.length > 1000) {
        return res.status(400).json({ error: 'Please send a customer message (max 1000 characters).' });
      }
      try {
        const reply = await generateReply(demoMessage, DEMO_PROFILE, 'email');
        return res.status(200).json({ reply, business_name: DEMO_PROFILE.business_name });
      } catch (err) {
        return res.status(500).json({ error: err.message || 'Demo failed. Please try again.' });
      }
    }
  }

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
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
