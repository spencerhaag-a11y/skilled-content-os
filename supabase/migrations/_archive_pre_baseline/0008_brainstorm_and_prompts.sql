-- ============================================================================
-- Phase 13 — AI Brainstorm Chat (Module 12)
-- Creates brainstorm_sessions AND prompt_library (Section 3 core tables);
-- "save prompt with one click" needs the table now, Phase 14 builds its UI.
-- ============================================================================

create table public.brainstorm_sessions (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts (id) on delete cascade,
  title         text not null default 'New session',
  messages_json jsonb not null default '[]'::jsonb, -- [{role, content}]
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index brainstorm_sessions_account_idx
  on public.brainstorm_sessions (account_id, updated_at desc);

create trigger brainstorm_sessions_set_updated_at
  before update on public.brainstorm_sessions
  for each row execute function public.set_updated_at();

alter table public.brainstorm_sessions enable row level security;

create policy brainstorm_sessions_select on public.brainstorm_sessions for select to authenticated
  using (account_id = public.current_account_id() or public.is_platform_owner());
create policy brainstorm_sessions_insert on public.brainstorm_sessions for insert to authenticated
  with check ((account_id = public.current_account_id() and created_by = auth.uid()) or public.is_platform_owner());
create policy brainstorm_sessions_update on public.brainstorm_sessions for update to authenticated
  using (account_id = public.current_account_id() or public.is_platform_owner())
  with check (account_id = public.current_account_id() or public.is_platform_owner());
create policy brainstorm_sessions_delete on public.brainstorm_sessions for delete to authenticated
  using (account_id = public.current_account_id() or public.is_platform_owner());

-- ── Prompt library (Module 13 table; UI ships in Phase 14) ─────────────────

create table public.prompt_library (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid references public.accounts (id) on delete cascade,
  name                text not null,
  prompt_text         text not null,
  content_type        text, -- Social | Blog | Email | Research | Repurposing | Testimonial | SEO | GBP | Brainstorm
  platform            text,
  pillar              text,
  performance_tag     text, -- e.g. high_engagement | converted | null
  is_platform_starter boolean not null default false, -- owner-curated, visible to all accounts
  created_by          uuid references auth.users (id),
  created_at          timestamptz not null default now()
);

create index prompt_library_account_idx on public.prompt_library (account_id, created_at desc);
create index prompt_library_starter_idx on public.prompt_library (is_platform_starter) where is_platform_starter;

alter table public.prompt_library enable row level security;

-- Clients see their own prompts PLUS the owner's published starter set.
create policy prompt_library_select on public.prompt_library for select to authenticated
  using (
    account_id = public.current_account_id()
    or is_platform_starter
    or public.is_platform_owner()
  );
create policy prompt_library_insert on public.prompt_library for insert to authenticated
  with check (
    (account_id = public.current_account_id() and created_by = auth.uid() and not is_platform_starter)
    or public.is_platform_owner()
  );
create policy prompt_library_update on public.prompt_library for update to authenticated
  using (
    (account_id = public.current_account_id() and not is_platform_starter)
    or public.is_platform_owner()
  )
  with check (
    (account_id = public.current_account_id() and not is_platform_starter)
    or public.is_platform_owner()
  );
create policy prompt_library_delete on public.prompt_library for delete to authenticated
  using (
    (account_id = public.current_account_id() and not is_platform_starter)
    or public.is_platform_owner()
  );
