-- ============================================================================
-- Phase 2 — Brand Kit (Module 1)
-- One brand kit per account. Every AI generation in later phases reads it.
-- ============================================================================

-- Reusable updated_at maintenance for this and all future tables.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table public.brand_kits (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null unique references public.accounts (id) on delete cascade,
  business_name text,
  tagline       text,
  mission       text,
  voice         text[] not null default '{}',
  icp           jsonb  not null default '{}'::jsonb, -- {demographics, pain_points, goals, objections}
  pillars       text[] not null default '{}',
  platforms     jsonb  not null default '[]'::jsonb, -- [{platform, handle}]
  competitors   text[] not null default '{}',
  url           text,
  brand_colors  text[] not null default '{}',
  typography    text,
  score         integer not null default 0 check (score between 0 and 100),
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index brand_kits_account_id_idx on public.brand_kits (account_id);

create trigger brand_kits_set_updated_at
  before update on public.brand_kits
  for each row execute function public.set_updated_at();

alter table public.brand_kits enable row level security;

create policy brand_kits_select
  on public.brand_kits for select
  to authenticated
  using (account_id = public.current_account_id() or public.is_platform_owner());

create policy brand_kits_insert
  on public.brand_kits for insert
  to authenticated
  with check (
    (account_id = public.current_account_id() and created_by = auth.uid())
    or public.is_platform_owner()
  );

create policy brand_kits_update
  on public.brand_kits for update
  to authenticated
  using (account_id = public.current_account_id() or public.is_platform_owner())
  with check (account_id = public.current_account_id() or public.is_platform_owner());

create policy brand_kits_delete
  on public.brand_kits for delete
  to authenticated
  using (account_id = public.current_account_id() or public.is_platform_owner());
