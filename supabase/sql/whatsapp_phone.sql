-- Optional: business WhatsApp number shown on dashboard (Meta webhook still configured in Meta console)
alter table public.user_business_profiles
  add column if not exists whatsapp_phone text not null default '';
