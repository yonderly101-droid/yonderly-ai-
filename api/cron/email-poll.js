const { pollAllConnectedInboxes } = require('../../lib/email-agent');

function isAuthorizedCron(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.authorization || req.headers.Authorization || '';
  return auth === `Bearer ${secret}`;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isAuthorizedCron(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await pollAllConnectedInboxes();
    return res.status(200).json({ status: 'ok', ...result });
  } catch (err) {
    return res.status(500).json({ status: 'error', error: err.message || 'Poll failed' });
  }
};
