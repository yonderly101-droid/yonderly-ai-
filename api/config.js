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

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'POST') {
    const body = parseBody(req);
    if (body.From) {
      res.setHeader('Content-Type', 'text/xml; charset=utf-8');
      return res.status(200).send(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Yonderly webhook is connected.</Message></Response>'
      );
    }
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    paypalClientId: process.env.PAYPAL_CLIENT_ID || '',
    paypalPlanId: process.env.PAYPAL_PLAN_ID || '',
    paypalMode: process.env.PAYPAL_MODE || 'live',
  });
};
