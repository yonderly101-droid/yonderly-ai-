const { pollAllConnectedInboxes } = require('../../lib/email-agent');
const { isAuthorizedCron } = require('../../lib/cron-auth');

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await isAuthorizedCron(req);
  if (!auth.ok) {
    return res.status(401).json({ error: 'Unauthorized', detail: auth.reason });
  }

  try {
    const result = await pollAllConnectedInboxes();
    return res.status(200).json({ status: 'ok', ...result });
  } catch (err) {
    return res.status(500).json({ status: 'error', error: err.message || 'Poll failed' });
  }
};
