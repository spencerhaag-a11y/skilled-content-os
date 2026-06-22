-- ============================================================================
-- Phase 19/20 — scan_history (Section 3 core table)
-- Backs Website Scanner (Module 16) and Social Listener (Module 17).
--
-- NOTE: This table already exists in the live project (created out-of-band by
-- an earlier build). This file is the idempotent source-of-truth mirror of
-- that live schema, so a fresh project reproduces it exactly. scan_type
-- discriminates the source: 'website' / 'competitor' (scanner) and 'social'
-- (listener, with the handle in url and the network in platform).
-- ============================================================================

create table if not exists public.scan_history (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts (id) on delete cascade,
  url          text not null,                 -- scanned URL, or social handle/profile URL
  scan_type    text not null
    check (scan_type in ('website', 'competitor', 'social')),
  platform     text,                          -- social network for scan_type='social'
  results_json jsonb not null default '{}'::jsonb,
  created_by   uuid references auth.users (id),
  created_at   timestamptz not null default now()
);

create index if not exists scan_history_account_idx
  on public.scan_history (account_id, created_at desc);

alter table public.scan_history enable row level security;

drop policy if exists scan_history_select on public.scan_history;
drop policy if exists scan_history_insert on public.scan_history;
drop policy if exists scan_history_delete on public.scan_history;

create policy scan_history_select on public.scan_history for select to authenticated
  using ((account_id = current_account_id()) or is_platform_owner());
create policy scan_history_insert on public.scan_history for insert to authenticated
  with check (((account_id = current_account_id()) and (created_by = auth.uid())) or is_platform_owner());
create policy scan_history_delete on public.scan_history for delete to authenticated
  using ((account_id = current_account_id()) or is_platform_owner());
