-- Provider credentials are only accessible to the service role used by the Edge Function.
create table if not exists public.kosen_provider_secrets (
  provider text primary key check (provider in ('gemini', 'openrouter', 'surplus')),
  api_key text not null,
  updated_at timestamptz not null default now()
);
alter table public.kosen_provider_secrets enable row level security;
revoke all on public.kosen_provider_secrets from public, anon, authenticated;
grant all on public.kosen_provider_secrets to service_role;

-- Enrollment credentials must not share the publicly readable settings table.
create table if not exists public.kosen_staff_secrets (
  id boolean primary key default true check (id),
  enrollment_secret text not null,
  updated_at timestamptz not null default now()
);
alter table public.kosen_staff_secrets enable row level security;
revoke all on public.kosen_staff_secrets from public, anon, authenticated;
grant all on public.kosen_staff_secrets to service_role;
