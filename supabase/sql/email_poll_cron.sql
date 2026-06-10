-- Run once in Supabase SQL Editor (project: jlmvzuxzgnvvzcikyowk)
-- Replaces GitHub Actions when billing blocks scheduled workflows.
-- Replace YOUR_CRON_SECRET with the CRON_SECRET value from Vercel → Settings → Environment Variables.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid)
from cron.job
where jobname = 'yonderly-email-poll';

select cron.schedule(
  'yonderly-email-poll',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://yonderly.online/api/cron/email-poll',
    headers := jsonb_build_object(
      'Authorization', 'Bearer YOUR_CRON_SECRET',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
