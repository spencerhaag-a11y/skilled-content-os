-- ============================================================================
-- Phase 3 — Business Knowledge Base (Module 2)
-- Global section templates (platform-owner managed) instantiated into every
-- account; per-account file library with extracted searchable text.
-- ============================================================================

-- ── Global section templates (owner-managed, Phase 23 UI) ──────────────────

create table public.kb_section_templates (
  id                 uuid primary key default gen_random_uuid(),
  section_type       text not null unique,
  title              text not null,
  description        text not null default '',
  sort_order         integer not null default 0,
  accepted_types     text[] not null default '{pdf,docx,png,jpg,svg,mp4,txt}',
  -- SOPs are internal: never injected into public content generation.
  use_in_generation  boolean not null default true,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now()
);

alter table public.kb_section_templates enable row level security;

create policy kb_templates_owner_all
  on public.kb_section_templates for all
  to authenticated
  using (public.is_platform_owner())
  with check (public.is_platform_owner());

-- ── Per-account sections (Section 3 core table) ─────────────────────────────

create table public.knowledge_base_sections (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts (id) on delete cascade,
  template_id        uuid references public.kb_section_templates (id) on delete set null,
  section_type       text not null,
  title              text not null,
  description        text not null default '',
  sort_order         integer not null default 0,
  accepted_types     text[] not null default '{pdf,docx,png,jpg,svg,mp4,txt}',
  use_in_generation  boolean not null default true,
  created_at         timestamptz not null default now(),
  unique (account_id, section_type)
);

create index kb_sections_account_idx on public.knowledge_base_sections (account_id, sort_order);

alter table public.knowledge_base_sections enable row level security;

-- Clients see their sections; only the platform owner shapes the structure.
create policy kb_sections_select
  on public.knowledge_base_sections for select
  to authenticated
  using (account_id = public.current_account_id() or public.is_platform_owner());

create policy kb_sections_owner_write
  on public.knowledge_base_sections for insert
  to authenticated
  with check (public.is_platform_owner());

create policy kb_sections_owner_update
  on public.knowledge_base_sections for update
  to authenticated
  using (public.is_platform_owner())
  with check (public.is_platform_owner());

create policy kb_sections_owner_delete
  on public.knowledge_base_sections for delete
  to authenticated
  using (public.is_platform_owner());

-- ── Files (Section 3 core table + extraction status) ───────────────────────

create table public.knowledge_base_files (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts (id) on delete cascade,
  section_id        uuid not null references public.knowledge_base_sections (id) on delete cascade,
  file_url          text not null, -- storage object path inside the knowledge-base bucket
  file_name         text not null,
  file_type         text not null,
  file_size         bigint not null default 0,
  extracted_text    text,
  -- pending → done | failed; not_applicable for images/video
  extraction_status text not null default 'not_applicable'
    check (extraction_status in ('pending', 'done', 'failed', 'not_applicable')),
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now()
);

create index kb_files_account_idx on public.knowledge_base_files (account_id);
create index kb_files_section_idx on public.knowledge_base_files (section_id);
-- Full-text search over extracted content (Brainstorm Chat retrieval, Phase 13).
create index kb_files_extracted_text_fts_idx
  on public.knowledge_base_files
  using gin (to_tsvector('english', coalesce(extracted_text, '')));

alter table public.knowledge_base_files enable row level security;

create policy kb_files_select
  on public.knowledge_base_files for select
  to authenticated
  using (account_id = public.current_account_id() or public.is_platform_owner());

create policy kb_files_insert
  on public.knowledge_base_files for insert
  to authenticated
  with check (
    (account_id = public.current_account_id() and created_by = auth.uid())
    or public.is_platform_owner()
  );

create policy kb_files_update
  on public.knowledge_base_files for update
  to authenticated
  using (account_id = public.current_account_id() or public.is_platform_owner())
  with check (account_id = public.current_account_id() or public.is_platform_owner());

create policy kb_files_delete
  on public.knowledge_base_files for delete
  to authenticated
  using (account_id = public.current_account_id() or public.is_platform_owner());

-- ── Seed the spec's default templates (Module 2 list) ──────────────────────

insert into public.kb_section_templates
  (section_type, title, description, sort_order, use_in_generation) values
  ('services',       'Services',                'Descriptions of each service, the outcomes it delivers, and who it is for.', 10, true),
  ('pricing',        'Pricing',                 'Packages, tiers, and payment options.', 20, true),
  ('logo-kit',       'Full logo kit',           'SVG and PNG logos — dark and light versions.', 30, true),
  ('events',         'Upcoming events',         'Dates, descriptions, and registration links.', 40, true),
  ('promotions',     'Promotions',              'Active offers, discount codes, and deadlines.', 50, true),
  ('team-bios',      'Team bios',               'Names, credentials, photos, and specialties.', 60, true),
  ('faqs',           'FAQs',                    'Common questions and the answers you give.', 70, true),
  ('brand-photos',   'Brand photos',            'Approved images for use in content.', 80, true),
  ('testimonials',   'Testimonials & reviews',  'Raw review text, screenshots, and video links.', 90, true),
  ('sops',           'SOPs',                    'Internal process documents. Never used in public content generation.', 100, false),
  ('offer-sheets',   'Offer sheets & brochures','PDFs the AI reads for copy accuracy.', 110, true);

-- ── Instantiate sections per account ────────────────────────────────────────

create or replace function public.seed_account_kb_sections(target_account uuid)
returns void
language sql security definer
set search_path = public
as $$
  insert into public.knowledge_base_sections
    (account_id, template_id, section_type, title, description, sort_order, accepted_types, use_in_generation)
  select target_account, t.id, t.section_type, t.title, t.description, t.sort_order, t.accepted_types, t.use_in_generation
  from public.kb_section_templates t
  where t.is_active
  on conflict (account_id, section_type) do nothing;
$$;

create or replace function public.handle_new_account_kb()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  perform public.seed_account_kb_sections(new.id);
  return new;
end;
$$;

create trigger on_account_created_seed_kb
  after insert on public.accounts
  for each row execute function public.handle_new_account_kb();

-- Backfill accounts created before this migration.
do $$
declare acct record;
begin
  for acct in select id from public.accounts loop
    perform public.seed_account_kb_sections(acct.id);
  end loop;
end;
$$;

-- Owner panel (Phase 23) calls this after editing templates to push new
-- sections into every existing account.
create or replace function public.sync_kb_sections_from_templates()
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  acct record;
  total integer := 0;
begin
  if not public.is_platform_owner() then
    raise exception 'Platform owner only.';
  end if;
  for acct in select id from public.accounts loop
    perform public.seed_account_kb_sections(acct.id);
    total := total + 1;
  end loop;
  return total;
end;
$$;

-- ── Storage: knowledge-base bucket (Section 5) ──────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit)
values ('knowledge-base', 'knowledge-base', false, 2147483648)
on conflict (id) do nothing;

-- Object paths follow Section 5: {account_id}/knowledge-base/{ts}_{file}
-- First path segment is the tenant key for RLS.
create policy kb_storage_select
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'knowledge-base'
    and ((storage.foldername(name))[1] = public.current_account_id()::text
         or public.is_platform_owner())
  );

create policy kb_storage_insert
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'knowledge-base'
    and ((storage.foldername(name))[1] = public.current_account_id()::text
         or public.is_platform_owner())
  );

create policy kb_storage_delete
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'knowledge-base'
    and ((storage.foldername(name))[1] = public.current_account_id()::text
         or public.is_platform_owner())
  );
