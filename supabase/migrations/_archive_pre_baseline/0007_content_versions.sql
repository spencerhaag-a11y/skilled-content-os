-- ============================================================================
-- Phase 12 — Content Library (Module 11): version history
-- Every edit to a content piece's title or body snapshots the PREVIOUS
-- state automatically via trigger — modules don't have to remember to do it.
-- ============================================================================

create table public.content_versions (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts (id) on delete cascade,
  content_piece_id uuid not null references public.content_pieces (id) on delete cascade,
  title            text not null,
  body             text not null,
  status           text not null,
  edited_by        uuid references auth.users (id),
  created_at       timestamptz not null default now()
);

create index content_versions_piece_idx
  on public.content_versions (content_piece_id, created_at desc);
create index content_versions_account_idx
  on public.content_versions (account_id);

alter table public.content_versions enable row level security;

-- Read-only to clients; rows are written exclusively by the trigger below.
create policy content_versions_select
  on public.content_versions for select
  to authenticated
  using (account_id = public.current_account_id() or public.is_platform_owner());

create or replace function public.snapshot_content_version()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.title is distinct from old.title or new.body is distinct from old.body then
    insert into public.content_versions
      (account_id, content_piece_id, title, body, status, edited_by)
    values
      (old.account_id, old.id, old.title, old.body, old.status, auth.uid());
  end if;
  return new;
end;
$$;

create trigger content_pieces_version_snapshot
  before update on public.content_pieces
  for each row execute function public.snapshot_content_version();
