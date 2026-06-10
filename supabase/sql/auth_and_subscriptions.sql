-- Yonderly: Supabase Auth + subscriptions + per-user business profiles
-- Run in Supabase SQL Editor after enabling Email auth in Authentication → Providers

-- Profile row for each signed-up user
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- PayPal subscription linked to user (replaces valid_tokens)
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  paypal_subscription_id text unique,
  status text not null default 'pending',
  plan_id text,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

-- Business brain per paying customer
create table if not exists public.user_business_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  business_name text not null default '',
  offerings text not null default '',
  prices text not null default '',
  common_questions text not null default '',
  tone text not null default 'friendly',
  contact_email text not null default '',
  restrictions text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.user_business_profiles enable row level security;

-- Users read/update their own profile
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

-- Users read their own subscription
create policy "subscriptions_select_own" on public.subscriptions
  for select using (auth.uid() = user_id);

-- Users read/write their business profile
create policy "business_select_own" on public.user_business_profiles
  for select using (auth.uid() = user_id);
create policy "business_insert_own" on public.user_business_profiles
  for insert with check (auth.uid() = user_id);
create policy "business_update_own" on public.user_business_profiles
  for update using (auth.uid() = user_id);

-- Auto-create profile row on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
