-- ============================================================================
-- Team invites: generated password + forced first-login rotation
--
-- Replaces the magic-link invite with an admin-created user holding a
-- server-generated temporary password. The temporary password is only ever
-- valid until first login: must_change_password gates the whole app until the
-- member sets their own.
--
-- Idempotent.
-- ============================================================================

-- Defaults false so every existing profile — and every owner — is unaffected.
-- Only the team_member branch of handle_new_user turns it on (Requirement 5).
alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

-- ── handle_new_user: flag invited members for rotation ──────────────────────
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

  if new.raw_user_meta_data ->> 'member_role' = 'team_member' then
    invited_account := nullif(new.raw_user_meta_data ->> 'owner_account_id', '')::uuid;
    if invited_account is null then
      raise exception 'team_member invite is missing owner_account_id metadata';
    end if;

    insert into public.profiles (
      id, account_id, owner_account_id, email, full_name, member_role, must_change_password
    )
    values (
      new.id, invited_account, invited_account, new.email, display_name, 'team_member', true
    );

    return new;
  end if;

  -- Owner signup — unchanged. must_change_password takes the false default.
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

-- ── close a self-escalation hole opened by 0006 ─────────────────────────────
-- profiles_update permits (id = auth.uid()), and protect_profile_fields only
-- guarded is_platform_owner and account_id. member_role was therefore
-- self-writable: a team member could PATCH their own row to member_role =
-- 'owner' and the permission store would hand them every module. The same
-- would apply to must_change_password, which would make the rotation gate
-- opt-out.
--
-- auth.uid() is null under the service role, which is how the team-* Edge
-- Functions legitimately set these fields. The original two conditions are
-- left exactly as they were.
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if (new.is_platform_owner is distinct from old.is_platform_owner
      or new.account_id is distinct from old.account_id)
     and not public.is_platform_owner() then
    raise exception 'Changing role or account assignment requires the platform owner.';
  end if;

  if (new.member_role is distinct from old.member_role
      or new.owner_account_id is distinct from old.owner_account_id
      or new.must_change_password is distinct from old.must_change_password)
     and auth.uid() is not null
     and not public.is_platform_owner() then
    raise exception 'Team role and password-reset state are managed server-side.';
  end if;

  return new;
end;
$function$;
