-- Yonderly: Gmail OAuth connections + email activity log
-- Run in Supabase SQL Editor after auth_and_subscriptions.sql

create table if not exists public.gmail_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  gmail_address text not null default '',
  access_token text not null default '',
  refresh_token text not null default '',
  token_expires_at timestamptz,
  enabled boolean not null default true,
  last_poll_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  gmail_message_id text not null,
  thread_id text,
  customer_email text not null default '',
  customer_name text not null default '',
  subject text not null default '',
  customer_message text not null default '',
  yonderly_reply text,
  status text not null default 'replied',
  created_at timestamptz not null default now(),
  unique (user_id, gmail_message_id)
);

create index if not exists email_messages_user_created_idx
  on public.email_messages (user_id, created_at desc);

alter table public.gmail_connections enable row level security;
alter table public.email_messages enable row level security;

-- Users see connection status (not tokens — columns excluded via API)
create policy "gmail_connections_select_own" on public.gmail_connections
  for select using (auth.uid() = user_id);

create policy "email_messages_select_own" on public.email_messages
  for select using (auth.uid() = user_id);

-- No insert/update/delete policies for users — server uses service role only
