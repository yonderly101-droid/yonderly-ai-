const {
  extractIncomingMessages,
  generateReply,
  sendWhatsAppText,
  resolveTenantContext,
} = require('../lib/whatsapp-meta');

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

  if (!incoming.length) {
    return res.status(200).json({ status: 'ok' });
  }

  const errors = [];
  for (const msg of incoming) {
    if (!msg.from || !msg.body || msg.body.length > 2000) continue;

    const tenant = await resolveTenantContext(msg.phone_number_id);
    if (!tenant) {
      errors.push(`No business linked for phone_number_id ${msg.phone_number_id || 'unknown'}`);
      continue;
    }

    try {
      const reply = await generateReply(tenant.profile, msg.body);
      await sendWhatsAppText(msg.from, reply, tenant.phoneNumberId);
    } catch (err) {
      errors.push(err.message || 'failed');
      try {
        await sendWhatsAppText(
          msg.from,
          'Sorry, we could not process your message right now. Please try again shortly.',
          tenant.phoneNumberId
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
