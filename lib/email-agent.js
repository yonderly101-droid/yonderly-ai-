const {
  listUnreadInbox,
  sendReply,
  markAsRead,
  extractEmailAddress,
  extractCustomerName,
  refreshAccessToken,
} = require('./gmail');
const { supabaseRest } = require('./supabase-server');

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

const NEWSLETTER_SENDER_PATTERNS = [
  'noreply',
  'no-reply',
  'donotreply',
  'notifications',
  'newsletter',
  'marketing',
  'mail.',
  'email.',
  'send.',
  'shopifyemail.com',
  'market.',
];

const MARKETING_LOCAL_PARTS = new Set([
  'info',
  'support',
  'welcome',
  'contact',
  'hello',
  'news',
  'updates',
]);

const KNOWN_PLATFORM_DOMAINS = [
  'mailchimp.com',
  'sendgrid.net',
  'constantcontact.com',
  'hubspot.com',
  'linkedin.com',
  'facebookmail.com',
  'shopify.com',
  'shopifyemail.com',
  'squarespace.com',
  'mailgun.org',
  'amazonses.com',
  'stripe.com',
  'paypal.com',
  'intercom.io',
  'zendesk.com',
  'google.com',
  'microsoft.com',
  'twitter.com',
  'instagram.com',
  'pinterest.com',
  'etsy.com',
  'vidiq.com',
  'replit.com',
  'supabase.com',
  'arcads.ai',
  'acquire.com',
  'shein.com',
  'getkong.ai',
];

const SUBJECT_MARKETING_KEYWORDS = [
  'unsubscribe',
  '% off',
  '%off',
  'deal',
  'offer',
  'sale',
  'newsletter',
  'notification',
  'welcome to',
  'replay now',
  'just listed',
  'while you were away',
  'special',
  'delightful',
  'boost',
];

const GMAIL_SKIP_LABELS = new Set([
  'CATEGORY_PROMOTIONS',
  'CATEGORY_SOCIAL',
  'CATEGORY_UPDATES',
]);

function isKnownPlatformDomain(domain) {
  const d = domain.toLowerCase();
  return KNOWN_PLATFORM_DOMAINS.some(
    (platform) => d === platform || d.endsWith(`.${platform}`)
  );
}

function isNewsletterOrMarketing(email) {
  const senderAddress = extractEmailAddress(email.from);
  const subjectLower = (email.subject || '').toLowerCase();
  const skipLabels = new Set(email.label_ids || []);

  if ([...skipLabels].some((label) => GMAIL_SKIP_LABELS.has(label))) {
    return true;
  }

  for (const pattern of NEWSLETTER_SENDER_PATTERNS) {
    if (senderAddress.includes(pattern)) return true;
  }

  if (senderAddress.includes('@')) {
    const [localPart, domain] = senderAddress.split('@');
    if (isKnownPlatformDomain(domain)) return true;
    if (
      MARKETING_LOCAL_PARTS.has(localPart) &&
      (isKnownPlatformDomain(domain) ||
        ['mail.', 'email.', 'send.', 'market.'].some((m) => domain.includes(m)))
    ) {
      return true;
    }
  }

  if (email.list_unsubscribe) return true;

  return SUBJECT_MARKETING_KEYWORDS.some((keyword) =>
    subjectLower.includes(keyword)
  );
}

function buildSystemPrompt(profile) {
  return (
    `You are an AI employee for ${profile.business_name}. ` +
    `Your job is to reply to customer emails on their behalf. ` +
    `Use only the information in the business profile below to answer. ` +
    `Never invent prices, services, or facts. ` +
    `Match the tone specified. ` +
    `Always sign off as 'The ${profile.business_name} Team, powered by Yonderly'. ` +
    `Business profile: ${JSON.stringify(profile, null, 2)}`
  );
}

async function generateReply(profile, subject, customerMessage) {
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
          `Reply to this customer email. Write only the email body — no subject line.\n\n` +
          `Subject: ${subject}\n\n${customerMessage}`,
      }],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || 'AI request failed');
  }
  return (data.content?.[0]?.text || '').trim();
}

function profileFromRow(row) {
  return {
    business_name: row.business_name,
    offerings: row.offerings,
    prices: row.prices,
    common_questions: row.common_questions,
    tone: row.tone,
    contact_email: row.contact_email || row.gmail_address,
    restrictions: row.restrictions,
  };
}

async function getValidAccessToken(connection) {
  const expiresAt = connection.token_expires_at
    ? new Date(connection.token_expires_at).getTime()
    : 0;

  if (connection.access_token && expiresAt > Date.now() + 60_000) {
    return connection.access_token;
  }

  const refreshed = await refreshAccessToken(connection.refresh_token);
  const tokenExpiresAt = new Date(
    Date.now() + (refreshed.expires_in || 3600) * 1000
  ).toISOString();

  await supabaseRest(`gmail_connections?user_id=eq.${connection.user_id}`, {
    method: 'PATCH',
    useServiceRole: true,
    rawBody: true,
    body: {
      access_token: refreshed.access_token,
      token_expires_at: tokenExpiresAt,
      updated_at: new Date().toISOString(),
    },
  });

  return refreshed.access_token;
}

async function logEmailMessage(entry) {
  await supabaseRest('email_messages?on_conflict=user_id,gmail_message_id', {
    method: 'POST',
    useServiceRole: true,
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: entry,
  });
}

async function processEmailForUser(connection, businessProfile) {
  const profile = profileFromRow({ ...businessProfile, gmail_address: connection.gmail_address });
  const accessToken = await getValidAccessToken(connection);
  const emails = await listUnreadInbox(accessToken);
  const businessEmail = (profile.contact_email || connection.gmail_address || '').toLowerCase();

  const summary = { userId: connection.user_id, processed: 0, replied: 0, skipped: 0, errors: [] };

  for (const email of emails) {
    summary.processed += 1;
    const customerAddress = extractEmailAddress(email.from);
    const customerName = extractCustomerName(email.from);

    try {
      if (customerAddress === businessEmail) {
        await markAsRead(accessToken, email.id);
        await logEmailMessage({
          user_id: connection.user_id,
          gmail_message_id: email.id,
          thread_id: email.thread_id,
          customer_email: customerAddress,
          customer_name: customerName,
          subject: email.subject,
          customer_message: email.body || '',
          status: 'skipped',
        });
        summary.skipped += 1;
        continue;
      }

      if (!email.body) {
        await markAsRead(accessToken, email.id);
        await logEmailMessage({
          user_id: connection.user_id,
          gmail_message_id: email.id,
          thread_id: email.thread_id,
          customer_email: customerAddress,
          customer_name: customerName,
          subject: email.subject,
          customer_message: '',
          status: 'skipped',
        });
        summary.skipped += 1;
        continue;
      }

      if (isNewsletterOrMarketing(email)) {
        await markAsRead(accessToken, email.id);
        await logEmailMessage({
          user_id: connection.user_id,
          gmail_message_id: email.id,
          thread_id: email.thread_id,
          customer_email: customerAddress,
          customer_name: customerName,
          subject: email.subject,
          customer_message: email.body,
          status: 'skipped',
        });
        summary.skipped += 1;
        continue;
      }

      const reply = await generateReply(profile, email.subject, email.body);
      const fromEmail = connection.gmail_address || profile.contact_email;
      await sendReply(accessToken, email, reply, fromEmail);
      await markAsRead(accessToken, email.id);
      await logEmailMessage({
        user_id: connection.user_id,
        gmail_message_id: email.id,
        thread_id: email.thread_id,
        customer_email: customerAddress,
        customer_name: customerName,
        subject: email.subject,
        customer_message: email.body,
        yonderly_reply: reply,
        status: 'replied',
      });
      summary.replied += 1;
    } catch (err) {
      summary.errors.push(err.message || 'failed');
    }
  }

  await supabaseRest(`gmail_connections?user_id=eq.${connection.user_id}`, {
    method: 'PATCH',
    useServiceRole: true,
    rawBody: true,
    body: {
      last_poll_at: new Date().toISOString(),
      last_error: summary.errors.length ? summary.errors[0] : null,
      updated_at: new Date().toISOString(),
    },
  });

  return summary;
}

async function pollAllConnectedInboxes() {
  const connections = await supabaseRest(
    'gmail_connections?enabled=eq.true&select=*',
    { useServiceRole: true }
  );

  if (!Array.isArray(connections) || !connections.length) {
    return { users: 0, results: [] };
  }

  const results = [];

  for (const connection of connections) {
    const profiles = await supabaseRest(
      `user_business_profiles?user_id=eq.${connection.user_id}&select=*`,
      { useServiceRole: true }
    );
    const businessProfile = Array.isArray(profiles) ? profiles[0] : null;

    if (!businessProfile?.business_name) {
      results.push({
        userId: connection.user_id,
        error: 'Business profile not set up',
      });
      continue;
    }

    try {
      const summary = await processEmailForUser(connection, businessProfile);
      results.push(summary);
    } catch (err) {
      await supabaseRest(`gmail_connections?user_id=eq.${connection.user_id}`, {
        method: 'PATCH',
        useServiceRole: true,
        rawBody: true,
        body: {
          last_poll_at: new Date().toISOString(),
          last_error: err.message || 'Poll failed',
          updated_at: new Date().toISOString(),
        },
      });
      results.push({ userId: connection.user_id, error: err.message || 'Poll failed' });
    }
  }

  return { users: connections.length, results };
}

module.exports = {
  pollAllConnectedInboxes,
  processEmailForUser,
  isNewsletterOrMarketing,
};
