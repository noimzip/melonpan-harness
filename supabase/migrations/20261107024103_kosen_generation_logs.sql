create table public.kosen_generation_logs (
 id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
 session_id text, provider text, model text, event text not null,
 details jsonb not null default '{}'::jsonb
);
alter table public.kosen_generation_logs enable row level security;
revoke all on public.kosen_generation_logs from public, anon, authenticated;
grant all on public.kosen_generation_logs to service_role;
create index on public.kosen_generation_logs (created_at desc, id);
create index on public.kosen_generation_logs (session_id);
create extension if not exists pg_cron;
select cron.schedule('kosen-generation-log-retention', '17 * * * *',
 $$delete from public.kosen_generation_logs where created_at < now() - interval '30 days'$$);
