-- ============================================================================
-- Phase 1 — Auth, accounts, profiles, master owner role
-- Spec refs: Section 3 (Core Database Tables, Security Requirements),
--            Module 21 (master owner), Module 22 (schema anticipates teams)
-- Run in: Supabase Dashboard → SQL Editor (or supabase db push)
-- ============================================================================

create extension if not exists pgcrypto;

-- ── Tables ──────────────────────────────────────────────────────────────────

create table public.accounts (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  white_label_name text,
  logo_url         text,
  primary_color    text check (primary_color is null or primary_color ~* '^#[0-9a-f]{6}$'),
  owner_id         uuid not null references auth.users (id) on delete cascade,
  plan             text not null default 'standard',
  created_at       timestamptz not null default now()
);

-- One profile per auth user. account_id is the tenant key used by every
-- RLS policy platform-wide. is_platform_owner backs the master owner role.
create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  account_id        uuid references public.accounts (id) on delete set null,
  email             text not null,
  full_name         text,
  is_platform_owner boolean not null default false,
  created_at        timestamptz not null default now()
);

-- GHL API keys live here, NOT on accounts (deviation from the Section 3
-- column list, required by Section 6: "never returned to browser after
-- save"). RLS is enabled with zero policies, so no client role can ever
-- read or write this table — only Edge Functions using the service role.
create table public.account_secrets (
  account_id  uuid primary key references public.accounts (id) on delete cascade,
  ghl_api_key text,
  updated_at  timestamptz not null default now()
);

create index accounts_owner_id_idx on public.accounts (owner_id);
create index profiles_account_id_idx on public.profiles (account_id);

-- ── Helper functions (used by every RLS policy in every later phase) ───────

-- True when the session belongs to the master platform owner.
-- Reads the JWT custom claim first (fast path), falls back to the profiles
-- table so a freshly-promoted owner works before their token refreshes.
create or replace function public.is_platform_owner()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'platform_owner')::boolean, false)
      or exists (
           select 1 from public.profiles
           where id = auth.uid() and is_platform_owner
         );
$$;

-- The tenant id for the current session. JWT claim fast path with a
-- profiles fallback for tokens minted before the claim hook was enabled.
create or replace function public.current_account_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    nullif(auth.jwt() -> 'app_metadata' ->> 'account_id', '')::uuid,
    (select account_id from public.profiles where id = auth.uid())
  );
$$;

revoke execute on function public.is_platform_owner() from public, anon;
revoke execute on function public.current_account_id() from public, anon;
grant execute on function public.is_platform_owner() to authenticated;
grant execute on function public.current_account_id() to authenticated;

-- ── Account creation on first signup ────────────────────────────────────────
-- Every new auth user gets: an account, a profile linked to it, and a
-- secrets row. The platform owner promotes/deactivates accounts later from
-- the owner panel (Phase 23).

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  new_account_id uuid;
  display_name   text;
begin
  display_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    split_part(new.email, '@', 1)
  );

  insert into public.accounts (name, owner_id)
  values (display_name, new.id)
  returning id into new_account_id;

  insert into public.profiles (id, account_id, email, full_name)
  values (new.id, new_account_id, new.email, new.raw_user_meta_data ->> 'full_name');

  insert into public.account_secrets (account_id)
  values (new_account_id);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Custom access token hook (master owner role as JWT claim, Section 3) ───
-- Injects account_id and platform_owner into app_metadata on every token.
-- ENABLE IN DASHBOARD: Authentication → Hooks → Customize Access Token (JWT)
-- → Postgres function → public.custom_access_token

create or replace function public.custom_access_token(event jsonb)
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  claims  jsonb;
  profile record;
begin
  select account_id, is_platform_owner
    into profile
    from public.profiles
   where id = (event ->> 'user_id')::uuid;

  claims := event -> 'claims';

  if found then
    claims := jsonb_set(
      claims,
      '{app_metadata}',
      coalesce(claims -> 'app_metadata', '{}'::jsonb) || jsonb_build_object(
        'account_id', profile.account_id,
        'platform_owner', profile.is_platform_owner
      )
    );
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant execute on function public.custom_access_token(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token(jsonb) from authenticated, anon, public;
grant select on public.profiles to supabase_auth_admin;

-- ── Row Level Security ──────────────────────────────────────────────────────

alter table public.accounts enable row level security;
alter table public.profiles enable row level security;
alter table public.account_secrets enable row level security;
-- account_secrets intentionally has NO policies: deny-all for every client
-- role. Edge Functions access it with the service role, which bypasses RLS.

-- The auth token hook runs as supabase_auth_admin and must read profiles.
create policy profiles_auth_admin_read
  on public.profiles for select
  to supabase_auth_admin
  using (true);

create policy profiles_select
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or public.is_platform_owner());

create policy profiles_update
  on public.profiles for update
  to authenticated
  using (id = auth.uid() or public.is_platform_owner())
  with check (id = auth.uid() or public.is_platform_owner());

-- Privilege-escalation guard: a normal user can edit their own profile but
-- can never flip is_platform_owner or move themselves to another account.
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if (new.is_platform_owner is distinct from old.is_platform_owner
      or new.account_id is distinct from old.account_id)
     and not public.is_platform_owner() then
    raise exception 'Changing role or account assignment requires the platform owner.';
  end if;
  return new;
end;
$$;

create trigger protect_profile_fields
  before update on public.profiles
  for each row execute function public.protect_profile_fields();

create policy accounts_select
  on public.accounts for select
  to authenticated
  using (id = public.current_account_id() or public.is_platform_owner());

create policy accounts_update
  on public.accounts for update
  to authenticated
  using (owner_id = auth.uid() or public.is_platform_owner())
  with check (owner_id = auth.uid() or public.is_platform_owner());

-- Only the platform owner creates or removes client accounts (Module 21).
-- Signup-time account creation runs through handle_new_user (definer).
create policy accounts_insert
  on public.accounts for insert
  to authenticated
  with check (public.is_platform_owner());

create policy accounts_delete
  on public.accounts for delete
  to authenticated
  using (public.is_platform_owner());

-- ── One-time owner bootstrap ────────────────────────────────────────────────
-- After Spencer signs up with the master email, run once (edit the email):
--   update public.profiles set is_platform_owner = true
--   where email = 'OWNER_EMAIL_HERE';
