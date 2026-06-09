-- Supabase SQL migration: create core tables for Yonderly
-- Run this in your Supabase SQL editor (Project -> SQL Editor) or via psql.

-- Enable UUID generation (pgcrypto provides gen_random_uuid)
create extension if not exists pgcrypto;

-- Business profile (single-row config per project)
create table if not exists business_profile (
  id uuid primary key default gen_random_uuid(),
  business_name text,
  description text,
  prices text,
  faqs jsonb,
  tone text,
  contact_email text,
  rules text,
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Email logs: records of incoming emails and Yonderly replies
create table if not exists email_logs (
  id uuid primary key default gen_random_uuid(),
  message_id text,
  received_at timestamptz default now(),
  from_email text,
  to_email text,
  subject text,
  body text,
  reply text,
  ai_metadata jsonb,
  handled boolean default false,
  created_at timestamptz default now()
);

-- Tokens for dashboard / onboarding access (simple token store)
create table if not exists valid_tokens (
  token text primary key,
  created_at timestamptz default now(),
  expires_at timestamptz
);

-- Optional: pending replies queue (if you implement background retries later)
create table if not exists pending_replies (
  id uuid primary key default gen_random_uuid(),
  email_log_id uuid references email_logs(id) on delete cascade,
  attempt_count int default 0,
  next_attempt timestamptz,
  payload jsonb,
  created_at timestamptz default now()
);

-- Indexes for common queries
create index if not exists idx_email_logs_from on email_logs(from_email);
create index if not exists idx_email_logs_received_at on email_logs(received_at);

-- Helpful view: latest business profile
create or replace view latest_business_profile as
select * from business_profile order by updated_at desc limit 1;
