-- ============================================================================
-- Team Members & Permission Access
--
-- Additive to the existing single-owner auth model. A team member is a real
-- auth user whose profile is scoped to an owner's account_id, with a per-module
-- allow list. Owners are never consulted against this table — member_role
-- 'owner' short-circuits every check, so existing accounts keep working with
-- zero behavioural change.
--
-- Numbered 0006, not 0005 as the spec says: 0005 is already taken by
-- 0005_video_uploads_5gb.sql.
--
-- Idempotent.
-- ============================================================================

-- ── profiles: member role + owning account ──────────────────────────────────
-- Existing rows take the 'owner' default, which is what keeps them unaffected.
alter table public.profiles
  add column if not exists owner_account_id uuid references public.accounts(id) on delete cascade;

alter table public.profiles
  add column if not exists member_role text not null default 'owner';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_member_role_check'
  ) then
    alter table public.profiles
      add constraint profiles_member_role_check
      check (member_role in ('owner', 'team_member'));
  end if;
end $$;

create index if not exists profiles_owner_account_idx
  on public.profiles (owner_account_id);

-- ── team_member_permissions ─────────────────────────────────────────────────
create table if not exists public.team_member_permissions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  permission_key text not null,
  allowed boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (profile_id, permission_key)
);

create index if not exists team_member_permissions_profile_idx
  on public.team_member_permissions (profile_id);
create index if not exists team_member_permissions_account_idx
  on public.team_member_permissions (account_id);

alter table public.team_member_permissions enable row level security;

drop policy if exists "owner manages team permissions" on public.team_member_permissions;
create policy "owner manages team permissions" on public.team_member_permissions
  for all
  using (account_id in (select id from public.accounts where owner_id = auth.uid()))
  with check (account_id in (select id from public.accounts where owner_id = auth.uid()));

drop policy if exists "team member reads own permissions" on public.team_member_permissions;
create policy "team member reads own permissions" on public.team_member_permissions
  for select
  using (profile_id = auth.uid());

-- ── profiles RLS: let an owner see their own team ───────────────────────────
-- Not in the spec, but the Team Members list cannot work without it: the
-- existing profiles_select policy is (id = auth.uid() or is_platform_owner()),
-- so an account owner who is not the *platform* owner would read back an empty
-- list and the page would look broken.
drop policy if exists profiles_select_team on public.profiles;
create policy profiles_select_team on public.profiles
  for select
  using (owner_account_id in (select id from public.accounts where owner_id = auth.uid()));

-- ── signup trigger: don't give an invitee their own account ─────────────────
-- Not in the spec, and without it the feature cannot work at all.
-- handle_new_user fires on every auth.users insert, inviteUserByEmail
-- included, and unconditionally creates an account owned by the new user plus
-- a profile pointing at it. An invited team member would therefore land in a
-- brand-new empty account of their own, and team-invite's own profile insert
-- would collide on the primary key.
--
-- team-invite passes member_role / owner_account_id in the invite's user
-- metadata; this takes that branch and files the profile under the inviting
-- owner's account instead. The owner signup path below it is unchanged, so
-- existing signup behaviour is byte-for-byte what it was (Spec Section 8).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  new_account_id uuid;
  display_name   text;
  invited_account uuid;
begin
  display_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    split_part(new.email, '@', 1)
  );

  -- Invited team member: attach to the inviting owner's account, no account
  -- and no secrets row of their own.
  if new.raw_user_meta_data ->> 'member_role' = 'team_member' then
    invited_account := nullif(new.raw_user_meta_data ->> 'owner_account_id', '')::uuid;
    if invited_account is null then
      raise exception 'team_member invite is missing owner_account_id metadata';
    end if;

    insert into public.profiles (id, account_id, owner_account_id, email, full_name, member_role)
    values (new.id, invited_account, invited_account, new.email, display_name, 'team_member');

    return new;
  end if;

  -- Owner signup — unchanged.
  insert into public.accounts (name, owner_id)
  values (display_name, new.id)
  returning id into new_account_id;

  insert into public.profiles (id, account_id, email, full_name)
  values (new.id, new_account_id, new.email, new.raw_user_meta_data ->> 'full_name');

  insert into public.account_secrets (account_id)
  values (new_account_id);

  return new;
end;
$function$;

-- ── team roster for the owner's Team Members page ───────────────────────────
-- Status (Invited vs Active) depends on auth.users.last_sign_in_at, which the
-- browser cannot read. This security-definer function exposes exactly the
-- roster columns the page needs, scoped to the caller's own account.
create or replace function public.team_members_for_owner()
returns table (
  id uuid,
  email text,
  full_name text,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
language sql
security definer
set search_path to 'public'
as $function$
  select p.id, p.email, p.full_name, p.created_at, u.last_sign_in_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.member_role = 'team_member'
    and p.owner_account_id in (
      select a.id from public.accounts a where a.owner_id = auth.uid()
    )
  order by p.created_at desc;
$function$;

revoke all on function public.team_members_for_owner() from public, anon;
grant execute on function public.team_members_for_owner() to authenticated;
