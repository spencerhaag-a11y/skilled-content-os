-- ============================================================================
-- Phase 15 — GoHighLevel Integration (Module 19, Section 6)
-- One-way push. Credentials live in account_secrets (zero-policy table);
-- every push attempt — success or failure — lands in ghl_push_log.
-- ============================================================================

-- GHL v2 API needs both a Private Integration token and the Location ID.
alter table public.account_secrets
  add column if not exists ghl_location_id text;

create table public.ghl_push_log (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts (id) on delete cascade,
  content_piece_id uuid references public.content_pieces (id) on delete set null,
  destination      text not null, -- social_planner | email_builder | blog | workflow_sms
  status           text not null default 'success' check (status in ('success', 'failed')),
  ghl_item_id      text,
  ghl_url          text,
  error_detail     text,
  created_by       uuid references auth.users (id),
  pushed_at        timestamptz not null default now()
);

create index ghl_push_log_account_idx on public.ghl_push_log (account_id, pushed_at desc);
create index ghl_push_log_piece_idx on public.ghl_push_log (content_piece_id);

alter table public.ghl_push_log enable row level security;

create policy ghl_push_log_select on public.ghl_push_log for select to authenticated
  using (account_id = public.current_account_id() or public.is_platform_owner());
create policy ghl_push_log_insert on public.ghl_push_log for insert to authenticated
  with check (
    (account_id = public.current_account_id() and created_by = auth.uid())
    or public.is_platform_owner()
  );
