-- ============================================================================
-- Phase 14 — Prompt Library (Module 13) support
-- Creates research_sessions (Section 3 core table) NOW so the Prompt
-- Library's "trending prompts" link works structurally; Niche Research
-- (Phase 21) populates it. Empty table → no trending badges, no errors.
-- ============================================================================

create table public.research_sessions (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts (id) on delete cascade,
  niche        text not null,
  results_json jsonb not null default '{}'::jsonb, -- {topics:[{topic, ...}], faqs:[...], seasonal:[...]}
  created_by   uuid references auth.users (id),
  created_at   timestamptz not null default now()
);

create index research_sessions_account_idx
  on public.research_sessions (account_id, created_at desc);

alter table public.research_sessions enable row level security;

create policy research_sessions_select on public.research_sessions for select to authenticated
  using (account_id = public.current_account_id() or public.is_platform_owner());
create policy research_sessions_insert on public.research_sessions for insert to authenticated
  with check ((account_id = public.current_account_id() and created_by = auth.uid()) or public.is_platform_owner());
create policy research_sessions_delete on public.research_sessions for delete to authenticated
  using (account_id = public.current_account_id() or public.is_platform_owner());
