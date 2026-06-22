-- ============================================================================
-- Phase 10 — Kanban Approval Board (Module 9): card comments
-- "Comment on cards — leave feedback for edits before approving."
-- ============================================================================

create table public.content_comments (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts (id) on delete cascade,
  content_piece_id uuid not null references public.content_pieces (id) on delete cascade,
  body             text not null,
  created_by       uuid references auth.users (id),
  created_at       timestamptz not null default now()
);

create index content_comments_piece_idx
  on public.content_comments (content_piece_id, created_at);
create index content_comments_account_idx
  on public.content_comments (account_id);

alter table public.content_comments enable row level security;

create policy content_comments_select
  on public.content_comments for select
  to authenticated
  using (account_id = public.current_account_id() or public.is_platform_owner());

create policy content_comments_insert
  on public.content_comments for insert
  to authenticated
  with check (
    (account_id = public.current_account_id() and created_by = auth.uid())
    or public.is_platform_owner()
  );

create policy content_comments_delete
  on public.content_comments for delete
  to authenticated
  using (
    (account_id = public.current_account_id() and created_by = auth.uid())
    or public.is_platform_owner()
  );
