-- Per-business WhatsApp connections (Meta Embedded Signup)
-- Run in Supabase SQL Editor after auth_and_subscriptions.sql

create table if not exists public.whatsapp_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone_number_id text not null,
  waba_id text not null default '',
  display_phone_number text not null default '',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (phone_number_id)
);

create index if not exists whatsapp_connections_phone_idx
  on public.whatsapp_connections (phone_number_id);

alter table public.whatsapp_connections enable row level security;

create policy "whatsapp_connections_select_own" on public.whatsapp_connections
  for select using (auth.uid() = user_id);

-- Inserts/updates via server (service role) only
