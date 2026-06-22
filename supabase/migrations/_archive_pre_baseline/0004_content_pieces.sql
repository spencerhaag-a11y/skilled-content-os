-- ============================================================================
-- Phase 4 — content_pieces (Section 3 core table) + dashboard support
-- Created now because the Dashboard reads it; Phases 5–12 write to it.
-- Status values mirror the Kanban lanes (Module 9).
-- ============================================================================

create table public.content_pieces (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts (id) on delete cascade,
  type            text not null,      -- caption | linkedin_post | email | blog | reel_script | carousel | story_frames | thread | sms | gbp_post | ...
  platform        text,               -- Instagram | TikTok | LinkedIn | Facebook | X | Email | Blog | GBP | null
  title           text not null,
  body            text not null default '',
  status          text not null default 'draft'
    check (status in ('draft', 'in_review', 'approved', 'scheduled', 'published')),
  pillar          text,
  scheduled_at    timestamptz,
  published_at    timestamptz,
  ghl_push_at     timestamptz,
  ghl_destination text,
  created_by      uuid references auth.users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index content_pieces_account_created_idx
  on public.content_pieces (account_id, created_at desc);
create index content_pieces_account_status_idx
  on public.content_pieces (account_id, status);
create index content_pieces_account_scheduled_idx
  on public.content_pieces (account_id, scheduled_at)
  where scheduled_at is not null;

create trigger content_pieces_set_updated_at
  before update on public.content_pieces
  for each row execute function public.set_updated_at();

alter table public.content_pieces enable row level security;

create policy content_pieces_select
  on public.content_pieces for select
  to authenticated
  using (account_id = public.current_account_id() or public.is_platform_owner());

create policy content_pieces_insert
  on public.content_pieces for insert
  to authenticated
  with check (
    (account_id = public.current_account_id() and created_by = auth.uid())
    or public.is_platform_owner()
  );

create policy content_pieces_update
  on public.content_pieces for update
  to authenticated
  using (account_id = public.current_account_id() or public.is_platform_owner())
  with check (account_id = public.current_account_id() or public.is_platform_owner());

create policy content_pieces_delete
  on public.content_pieces for delete
  to authenticated
  using (account_id = public.current_account_id() or public.is_platform_owner());

-- Non-secret GHL connection status flag for dashboard/settings badges
-- (Section 6). The key itself stays in account_secrets; an Edge Function
-- flips this flag after a successful connection test in Phase 15.
alter table public.accounts
  add column if not exists ghl_connected boolean not null default false;
