-- Applied to buyerassist-web 2026-10-24 (approved by Josh).
-- Stores the full /ko/apply submission linked to the deal it created.
create table if not exists public.ko_applications (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references public.deals(id) on delete set null,
  dealer_id uuid not null references public.dealers(id),
  reference text not null,
  payload jsonb not null,          -- full form sections (contains PII)
  consent_privacy boolean not null default false,
  source_url text,
  created_at timestamptz not null default now()
);
create index if not exists ko_applications_deal_idx on public.ko_applications(deal_id);
alter table public.ko_applications enable row level security;
-- No policies: only the service role (server) can read/write.
