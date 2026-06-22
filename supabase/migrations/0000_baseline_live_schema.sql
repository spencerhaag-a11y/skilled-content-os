-- ============================================================================
-- BASELINE SCHEMA SNAPSHOT — Skilled Content OS
-- Project: ogyhnxeecrcwtpfizsjp   |   Captured: 2026-06-19
--
-- This file is a faithful, reconstructed snapshot of the LIVE database schema,
-- generated from the Postgres catalog (pg_get_functiondef / pg_get_constraintdef
-- / pg_get_indexdef / pg_get_triggerdef + pg_policies). Applying it to an empty
-- project reproduces the live public schema, RLS, functions, triggers, storage
-- buckets, and section-template seed exactly.
--
-- WHY THIS EXISTS: the live project was built out-of-band (its supabase
-- migrations table was empty) and had drifted from the numbered migration files.
-- This baseline is the single source of truth. The historical phase migrations
-- (0001–0013) are kept under migrations/_archive_pre_baseline/ for reference and
-- are intentionally NOT applied (subdirectories are ignored by `supabase db push`).
--
-- After applying on a fresh project, also do the dashboard steps at the bottom
-- (auth token hook + owner bootstrap).
-- ============================================================================

-- ── Extensions ──────────────────────────────────────────────────────────────
create extension if not exists pg_stat_statements;
create extension if not exists pgcrypto;
create extension if not exists supabase_vault;
create extension if not exists "uuid-ossp";

-- ── Tables ──────────────────────────────────────────────────────────────────
create table if not exists public.account_secrets (
  account_id uuid not null,
  ghl_api_key text,
  updated_at timestamp with time zone not null default now(),
  ghl_location_id text
);

create table if not exists public.accounts (
  id uuid not null default gen_random_uuid(),
  name text not null,
  white_label_name text,
  logo_url text,
  primary_color text,
  owner_id uuid not null,
  plan text not null default 'standard'::text,
  created_at timestamp with time zone not null default now(),
  ghl_connected boolean not null default false,
  disabled_modules text[] not null default '{}'::text[],
  is_active boolean not null default true
);

create table if not exists public.brainstorm_sessions (
  id uuid not null default gen_random_uuid(),
  account_id uuid not null,
  title text not null default 'New session'::text,
  messages_json jsonb not null default '[]'::jsonb,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.brand_kits (
  id uuid not null default gen_random_uuid(),
  account_id uuid not null,
  business_name text,
  tagline text,
  mission text,
  voice text[] not null default '{}'::text[],
  icp jsonb not null default '{}'::jsonb,
  pillars text[] not null default '{}'::text[],
  platforms jsonb not null default '[]'::jsonb,
  competitors text[] not null default '{}'::text[],
  url text,
  brand_colors text[] not null default '{}'::text[],
  typography text,
  score integer not null default 0,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.content_comments (
  id uuid not null default gen_random_uuid(),
  account_id uuid not null,
  content_piece_id uuid not null,
  body text not null,
  created_by uuid,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.content_pieces (
  id uuid not null default gen_random_uuid(),
  account_id uuid not null,
  type text not null,
  platform text,
  title text not null,
  body text not null default ''::text,
  status text not null default 'draft'::text,
  pillar text,
  scheduled_at timestamp with time zone,
  published_at timestamp with time zone,
  ghl_push_at timestamp with time zone,
  ghl_destination text,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.content_versions (
  id uuid not null default gen_random_uuid(),
  account_id uuid not null,
  content_piece_id uuid not null,
  title text not null,
  body text not null,
  status text not null,
  edited_by uuid,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.ghl_push_log (
  id uuid not null default gen_random_uuid(),
  account_id uuid not null,
  content_piece_id uuid,
  destination text not null,
  status text not null default 'success'::text,
  ghl_item_id text,
  ghl_url text,
  error_detail text,
  created_by uuid,
  pushed_at timestamp with time zone not null default now()
);

create table if not exists public.kb_section_templates (
  id uuid not null default gen_random_uuid(),
  section_type text not null,
  title text not null,
  description text not null default ''::text,
  sort_order integer not null default 0,
  accepted_types text[] not null default '{pdf,docx,png,jpg,svg,mp4,txt}'::text[],
  use_in_generation boolean not null default true,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.knowledge_base_files (
  id uuid not null default gen_random_uuid(),
  account_id uuid not null,
  section_id uuid not null,
  file_url text not null,
  file_name text not null,
  file_type text not null,
  file_size bigint not null default 0,
  extracted_text text,
  extraction_status text not null default 'not_applicable'::text,
  created_by uuid,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.knowledge_base_sections (
  id uuid not null default gen_random_uuid(),
  account_id uuid not null,
  template_id uuid,
  section_type text not null,
  title text not null,
  description text not null default ''::text,
  sort_order integer not null default 0,
  accepted_types text[] not null default '{pdf,docx,png,jpg,svg,mp4,txt}'::text[],
  use_in_generation boolean not null default true,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.profiles (
  id uuid not null,
  account_id uuid,
  email text not null,
  full_name text,
  is_platform_owner boolean not null default false,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.prompt_library (
  id uuid not null default gen_random_uuid(),
  account_id uuid,
  name text not null,
  prompt_text text not null,
  content_type text,
  platform text,
  pillar text,
  performance_tag text,
  is_platform_starter boolean not null default false,
  created_by uuid,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.research_sessions (
  id uuid not null default gen_random_uuid(),
  account_id uuid not null,
  niche text not null,
  results_json jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.scan_history (
  id uuid not null default gen_random_uuid(),
  account_id uuid not null,
  url text not null,
  scan_type text not null,
  platform text,
  results_json jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.testimonial_forms (
  id uuid not null default gen_random_uuid(),
  account_id uuid not null,
  title text not null default 'Client feedback'::text,
  questions_json jsonb not null default '[]'::jsonb,
  share_link_token text not null default encode(gen_random_bytes(24), 'hex'::text),
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.testimonial_responses (
  id uuid not null default gen_random_uuid(),
  form_id uuid not null,
  account_id uuid not null,
  client_name text not null default ''::text,
  answers_json jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.testimonials (
  id uuid not null default gen_random_uuid(),
  account_id uuid not null,
  client_name text not null default ''::text,
  raw_text text not null,
  service_tag text,
  client_type_tag text,
  outcome_tag text,
  source text not null default 'direct'::text,
  media_url text,
  created_by uuid,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.video_jobs (
  id uuid not null default gen_random_uuid(),
  account_id uuid not null,
  title text not null default 'Untitled video'::text,
  file_path text not null,
  file_name text not null,
  file_size bigint not null default 0,
  status text not null default 'uploaded'::text,
  error_detail text,
  provider_job_id text,
  webhook_token text not null default encode(gen_random_bytes(24), 'hex'::text),
  transcript text,
  transcript_json jsonb,
  srt text,
  vtt text,
  edit_markers jsonb not null default '[]'::jsonb,
  clip_suggestions jsonb not null default '[]'::jsonb,
  duration_seconds numeric,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

-- ── Constraints (primary/unique/check first, then foreign keys) ─────────────
alter table public.account_secrets add constraint account_secrets_pkey PRIMARY KEY (account_id);
alter table public.accounts add constraint accounts_pkey PRIMARY KEY (id);
alter table public.brainstorm_sessions add constraint brainstorm_sessions_pkey PRIMARY KEY (id);
alter table public.brand_kits add constraint brand_kits_pkey PRIMARY KEY (id);
alter table public.content_comments add constraint content_comments_pkey PRIMARY KEY (id);
alter table public.content_pieces add constraint content_pieces_pkey PRIMARY KEY (id);
alter table public.content_versions add constraint content_versions_pkey PRIMARY KEY (id);
alter table public.ghl_push_log add constraint ghl_push_log_pkey PRIMARY KEY (id);
alter table public.kb_section_templates add constraint kb_section_templates_pkey PRIMARY KEY (id);
alter table public.knowledge_base_files add constraint knowledge_base_files_pkey PRIMARY KEY (id);
alter table public.knowledge_base_sections add constraint knowledge_base_sections_pkey PRIMARY KEY (id);
alter table public.profiles add constraint profiles_pkey PRIMARY KEY (id);
alter table public.prompt_library add constraint prompt_library_pkey PRIMARY KEY (id);
alter table public.research_sessions add constraint research_sessions_pkey PRIMARY KEY (id);
alter table public.scan_history add constraint scan_history_pkey PRIMARY KEY (id);
alter table public.testimonial_forms add constraint testimonial_forms_pkey PRIMARY KEY (id);
alter table public.testimonial_responses add constraint testimonial_responses_pkey PRIMARY KEY (id);
alter table public.testimonials add constraint testimonials_pkey PRIMARY KEY (id);
alter table public.video_jobs add constraint video_jobs_pkey PRIMARY KEY (id);
alter table public.brand_kits add constraint brand_kits_account_id_key UNIQUE (account_id);
alter table public.kb_section_templates add constraint kb_section_templates_section_type_key UNIQUE (section_type);
alter table public.knowledge_base_sections add constraint knowledge_base_sections_account_id_section_type_key UNIQUE (account_id, section_type);
alter table public.testimonial_forms add constraint testimonial_forms_share_link_token_key UNIQUE (share_link_token);
alter table public.accounts add constraint accounts_primary_color_check CHECK (((primary_color IS NULL) OR (primary_color ~* '^#[0-9a-f]{6}$'::text)));
alter table public.brand_kits add constraint brand_kits_score_check CHECK (((score >= 0) AND (score <= 100)));
alter table public.content_pieces add constraint content_pieces_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'in_review'::text, 'approved'::text, 'scheduled'::text, 'published'::text])));
alter table public.ghl_push_log add constraint ghl_push_log_status_check CHECK ((status = ANY (ARRAY['success'::text, 'failed'::text])));
alter table public.knowledge_base_files add constraint knowledge_base_files_extraction_status_check CHECK ((extraction_status = ANY (ARRAY['pending'::text, 'done'::text, 'failed'::text, 'not_applicable'::text])));
alter table public.scan_history add constraint scan_history_scan_type_check CHECK ((scan_type = ANY (ARRAY['website'::text, 'competitor'::text, 'social'::text])));
alter table public.testimonials add constraint testimonials_source_check CHECK ((source = ANY (ARRAY['google'::text, 'facebook'::text, 'instagram'::text, 'direct'::text, 'form'::text, 'other'::text])));
alter table public.video_jobs add constraint video_jobs_status_check CHECK ((status = ANY (ARRAY['uploaded'::text, 'transcribing'::text, 'analyzing'::text, 'done'::text, 'failed'::text])));
alter table public.account_secrets add constraint account_secrets_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;
alter table public.accounts add constraint accounts_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.brainstorm_sessions add constraint brainstorm_sessions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.brainstorm_sessions add constraint brainstorm_sessions_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;
alter table public.brand_kits add constraint brand_kits_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;
alter table public.brand_kits add constraint brand_kits_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.content_comments add constraint content_comments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.content_comments add constraint content_comments_content_piece_id_fkey FOREIGN KEY (content_piece_id) REFERENCES content_pieces(id) ON DELETE CASCADE;
alter table public.content_comments add constraint content_comments_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;
alter table public.content_pieces add constraint content_pieces_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.content_pieces add constraint content_pieces_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;
alter table public.content_versions add constraint content_versions_edited_by_fkey FOREIGN KEY (edited_by) REFERENCES auth.users(id);
alter table public.content_versions add constraint content_versions_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;
alter table public.content_versions add constraint content_versions_content_piece_id_fkey FOREIGN KEY (content_piece_id) REFERENCES content_pieces(id) ON DELETE CASCADE;
alter table public.ghl_push_log add constraint ghl_push_log_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.ghl_push_log add constraint ghl_push_log_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;
alter table public.ghl_push_log add constraint ghl_push_log_content_piece_id_fkey FOREIGN KEY (content_piece_id) REFERENCES content_pieces(id) ON DELETE SET NULL;
alter table public.knowledge_base_files add constraint knowledge_base_files_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;
alter table public.knowledge_base_files add constraint knowledge_base_files_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.knowledge_base_files add constraint knowledge_base_files_section_id_fkey FOREIGN KEY (section_id) REFERENCES knowledge_base_sections(id) ON DELETE CASCADE;
alter table public.knowledge_base_sections add constraint knowledge_base_sections_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;
alter table public.knowledge_base_sections add constraint knowledge_base_sections_template_id_fkey FOREIGN KEY (template_id) REFERENCES kb_section_templates(id) ON DELETE SET NULL;
alter table public.profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.profiles add constraint profiles_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;
alter table public.prompt_library add constraint prompt_library_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;
alter table public.prompt_library add constraint prompt_library_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.research_sessions add constraint research_sessions_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;
alter table public.research_sessions add constraint research_sessions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.scan_history add constraint scan_history_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;
alter table public.scan_history add constraint scan_history_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.testimonial_forms add constraint testimonial_forms_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;
alter table public.testimonial_forms add constraint testimonial_forms_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.testimonial_responses add constraint testimonial_responses_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;
alter table public.testimonial_responses add constraint testimonial_responses_form_id_fkey FOREIGN KEY (form_id) REFERENCES testimonial_forms(id) ON DELETE CASCADE;
alter table public.testimonials add constraint testimonials_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;
alter table public.testimonials add constraint testimonials_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.video_jobs add constraint video_jobs_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;
alter table public.video_jobs add constraint video_jobs_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

-- ── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX accounts_owner_id_idx ON public.accounts USING btree (owner_id);
CREATE INDEX brainstorm_sessions_account_idx ON public.brainstorm_sessions USING btree (account_id, updated_at DESC);
CREATE INDEX brand_kits_account_id_idx ON public.brand_kits USING btree (account_id);
CREATE INDEX content_comments_account_idx ON public.content_comments USING btree (account_id);
CREATE INDEX content_comments_piece_idx ON public.content_comments USING btree (content_piece_id, created_at);
CREATE INDEX content_pieces_account_created_idx ON public.content_pieces USING btree (account_id, created_at DESC);
CREATE INDEX content_pieces_account_scheduled_idx ON public.content_pieces USING btree (account_id, scheduled_at) WHERE (scheduled_at IS NOT NULL);
CREATE INDEX content_pieces_account_status_idx ON public.content_pieces USING btree (account_id, status);
CREATE INDEX content_versions_account_idx ON public.content_versions USING btree (account_id);
CREATE INDEX content_versions_piece_idx ON public.content_versions USING btree (content_piece_id, created_at DESC);
CREATE INDEX ghl_push_log_account_idx ON public.ghl_push_log USING btree (account_id, pushed_at DESC);
CREATE INDEX ghl_push_log_piece_idx ON public.ghl_push_log USING btree (content_piece_id);
CREATE INDEX kb_files_account_idx ON public.knowledge_base_files USING btree (account_id);
CREATE INDEX kb_files_extracted_text_fts_idx ON public.knowledge_base_files USING gin (to_tsvector('english'::regconfig, COALESCE(extracted_text, ''::text)));
CREATE INDEX kb_files_section_idx ON public.knowledge_base_files USING btree (section_id);
CREATE INDEX kb_sections_account_idx ON public.knowledge_base_sections USING btree (account_id, sort_order);
CREATE INDEX profiles_account_id_idx ON public.profiles USING btree (account_id);
CREATE INDEX prompt_library_account_idx ON public.prompt_library USING btree (account_id, created_at DESC);
CREATE INDEX prompt_library_starter_idx ON public.prompt_library USING btree (is_platform_starter) WHERE is_platform_starter;
CREATE INDEX research_sessions_account_idx ON public.research_sessions USING btree (account_id, created_at DESC);
CREATE INDEX scan_history_account_idx ON public.scan_history USING btree (account_id, created_at DESC);
CREATE INDEX scan_history_account_type_idx ON public.scan_history USING btree (account_id, scan_type, created_at DESC);
CREATE INDEX testimonial_forms_account_idx ON public.testimonial_forms USING btree (account_id);
CREATE INDEX testimonial_forms_token_idx ON public.testimonial_forms USING btree (share_link_token);
CREATE INDEX testimonial_responses_account_idx ON public.testimonial_responses USING btree (account_id, created_at DESC);
CREATE INDEX testimonial_responses_form_idx ON public.testimonial_responses USING btree (form_id);
CREATE INDEX testimonials_account_idx ON public.testimonials USING btree (account_id, created_at DESC);
CREATE INDEX video_jobs_account_idx ON public.video_jobs USING btree (account_id, created_at DESC);
CREATE INDEX video_jobs_provider_idx ON public.video_jobs USING btree (provider_job_id);

-- ── Functions ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.current_account_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    nullif(auth.jwt() -> 'app_metadata' ->> 'account_id', '')::uuid,
    (select account_id from public.profiles where id = auth.uid())
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_platform_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'platform_owner')::boolean, false)
      or exists (
           select 1 from public.profiles
           where id = auth.uid() and is_platform_owner
         );
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.seed_account_kb_sections(target_account uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into public.knowledge_base_sections
    (account_id, template_id, section_type, title, description, sort_order, accepted_types, use_in_generation)
  select target_account, t.id, t.section_type, t.title, t.description, t.sort_order, t.accepted_types, t.use_in_generation
  from public.kb_section_templates t
  where t.is_active
  on conflict (account_id, section_type) do nothing;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_account_kb()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.seed_account_kb_sections(new.id);
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  new_account_id uuid;
  display_name   text;
begin
  display_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    split_part(new.email, '@', 1)
  );

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

CREATE OR REPLACE FUNCTION public.protect_profile_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (new.is_platform_owner is distinct from old.is_platform_owner
      or new.account_id is distinct from old.account_id)
     and not public.is_platform_owner() then
    raise exception 'Changing role or account assignment requires the platform owner.';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.snapshot_content_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.title is distinct from old.title or new.body is distinct from old.body then
    insert into public.content_versions
      (account_id, content_piece_id, title, body, status, edited_by)
    values
      (old.account_id, old.id, old.title, old.body, old.status, auth.uid());
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_kb_sections_from_templates()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.custom_access_token(event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  claims  jsonb;
  profile record;
begin
  select account_id, is_platform_owner
    into profile
    from public.profiles
   where id = (event ->> 'user_id')::uuid;

  claims := event -> 'claims';

  if found then
    claims := jsonb_set(
      claims,
      '{app_metadata}',
      coalesce(claims -> 'app_metadata', '{}'::jsonb) || jsonb_build_object(
        'account_id', profile.account_id,
        'platform_owner', profile.is_platform_owner
      )
    );
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$function$;

-- ── Function grants (helpers + auth token hook) ─────────────────────────────
revoke execute on function public.is_platform_owner() from public, anon;
revoke execute on function public.current_account_id() from public, anon;
grant execute on function public.is_platform_owner() to authenticated;
grant execute on function public.current_account_id() to authenticated;
grant execute on function public.custom_access_token(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token(jsonb) from authenticated, anon, public;
grant select on public.profiles to supabase_auth_admin;

-- ── Triggers ────────────────────────────────────────────────────────────────
CREATE TRIGGER on_account_created_seed_kb AFTER INSERT ON public.accounts FOR EACH ROW EXECUTE FUNCTION handle_new_account_kb();
CREATE TRIGGER brainstorm_sessions_set_updated_at BEFORE UPDATE ON public.brainstorm_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER brand_kits_set_updated_at BEFORE UPDATE ON public.brand_kits FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER content_pieces_set_updated_at BEFORE UPDATE ON public.content_pieces FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER content_pieces_version_snapshot BEFORE UPDATE ON public.content_pieces FOR EACH ROW EXECUTE FUNCTION snapshot_content_version();
CREATE TRIGGER protect_profile_fields BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION protect_profile_fields();
CREATE TRIGGER video_jobs_set_updated_at BEFORE UPDATE ON public.video_jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The auth.users insert trigger lives in the auth schema (created by 0001):
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── Row Level Security ──────────────────────────────────────────────────────
alter table public.account_secrets enable row level security;  -- intentionally zero policies (deny-all to clients)
alter table public.accounts enable row level security;
alter table public.brainstorm_sessions enable row level security;
alter table public.brand_kits enable row level security;
alter table public.content_comments enable row level security;
alter table public.content_pieces enable row level security;
alter table public.content_versions enable row level security;
alter table public.ghl_push_log enable row level security;
alter table public.kb_section_templates enable row level security;
alter table public.knowledge_base_files enable row level security;
alter table public.knowledge_base_sections enable row level security;
alter table public.profiles enable row level security;
alter table public.prompt_library enable row level security;
alter table public.research_sessions enable row level security;
alter table public.scan_history enable row level security;
alter table public.testimonial_forms enable row level security;
alter table public.testimonial_responses enable row level security;
alter table public.testimonials enable row level security;
alter table public.video_jobs enable row level security;

-- ── Storage buckets ─────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit) values ('knowledge-base', 'knowledge-base', false, 2147483648) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit) values ('testimonial-media', 'testimonial-media', false, 52428800) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit) values ('video-uploads', 'video-uploads', false, 2147483648) on conflict (id) do nothing;

-- ── Policies (public + storage) ─────────────────────────────────────────────
create policy accounts_delete on public.accounts for delete to authenticated using (is_platform_owner());
create policy accounts_insert on public.accounts for insert to authenticated with check (is_platform_owner());
create policy accounts_select on public.accounts for select to authenticated using (((id = current_account_id()) OR is_platform_owner()));
create policy accounts_update on public.accounts for update to authenticated using (((owner_id = auth.uid()) OR is_platform_owner())) with check (((owner_id = auth.uid()) OR is_platform_owner()));
create policy brainstorm_sessions_delete on public.brainstorm_sessions for delete to authenticated using (((account_id = current_account_id()) OR is_platform_owner()));
create policy brainstorm_sessions_insert on public.brainstorm_sessions for insert to authenticated with check ((((account_id = current_account_id()) AND (created_by = auth.uid())) OR is_platform_owner()));
create policy brainstorm_sessions_select on public.brainstorm_sessions for select to authenticated using (((account_id = current_account_id()) OR is_platform_owner()));
create policy brainstorm_sessions_update on public.brainstorm_sessions for update to authenticated using (((account_id = current_account_id()) OR is_platform_owner())) with check (((account_id = current_account_id()) OR is_platform_owner()));
create policy brand_kits_delete on public.brand_kits for delete to authenticated using (((account_id = current_account_id()) OR is_platform_owner()));
create policy brand_kits_insert on public.brand_kits for insert to authenticated with check ((((account_id = current_account_id()) AND (created_by = auth.uid())) OR is_platform_owner()));
create policy brand_kits_select on public.brand_kits for select to authenticated using (((account_id = current_account_id()) OR is_platform_owner()));
create policy brand_kits_update on public.brand_kits for update to authenticated using (((account_id = current_account_id()) OR is_platform_owner())) with check (((account_id = current_account_id()) OR is_platform_owner()));
create policy content_comments_delete on public.content_comments for delete to authenticated using ((((account_id = current_account_id()) AND (created_by = auth.uid())) OR is_platform_owner()));
create policy content_comments_insert on public.content_comments for insert to authenticated with check ((((account_id = current_account_id()) AND (created_by = auth.uid())) OR is_platform_owner()));
create policy content_comments_select on public.content_comments for select to authenticated using (((account_id = current_account_id()) OR is_platform_owner()));
create policy content_pieces_delete on public.content_pieces for delete to authenticated using (((account_id = current_account_id()) OR is_platform_owner()));
create policy content_pieces_insert on public.content_pieces for insert to authenticated with check ((((account_id = current_account_id()) AND (created_by = auth.uid())) OR is_platform_owner()));
create policy content_pieces_select on public.content_pieces for select to authenticated using (((account_id = current_account_id()) OR is_platform_owner()));
create policy content_pieces_update on public.content_pieces for update to authenticated using (((account_id = current_account_id()) OR is_platform_owner())) with check (((account_id = current_account_id()) OR is_platform_owner()));
create policy content_versions_select on public.content_versions for select to authenticated using (((account_id = current_account_id()) OR is_platform_owner()));
create policy ghl_push_log_insert on public.ghl_push_log for insert to authenticated with check ((((account_id = current_account_id()) AND (created_by = auth.uid())) OR is_platform_owner()));
create policy ghl_push_log_select on public.ghl_push_log for select to authenticated using (((account_id = current_account_id()) OR is_platform_owner()));
create policy kb_templates_owner_all on public.kb_section_templates for all to authenticated using (is_platform_owner()) with check (is_platform_owner());
create policy kb_files_delete on public.knowledge_base_files for delete to authenticated using (((account_id = current_account_id()) OR is_platform_owner()));
create policy kb_files_insert on public.knowledge_base_files for insert to authenticated with check ((((account_id = current_account_id()) AND (created_by = auth.uid())) OR is_platform_owner()));
create policy kb_files_select on public.knowledge_base_files for select to authenticated using (((account_id = current_account_id()) OR is_platform_owner()));
create policy kb_files_update on public.knowledge_base_files for update to authenticated using (((account_id = current_account_id()) OR is_platform_owner())) with check (((account_id = current_account_id()) OR is_platform_owner()));
create policy kb_sections_owner_delete on public.knowledge_base_sections for delete to authenticated using (is_platform_owner());
create policy kb_sections_owner_write on public.knowledge_base_sections for insert to authenticated with check (is_platform_owner());
create policy kb_sections_select on public.knowledge_base_sections for select to authenticated using (((account_id = current_account_id()) OR is_platform_owner()));
create policy kb_sections_owner_update on public.knowledge_base_sections for update to authenticated using (is_platform_owner()) with check (is_platform_owner());
create policy profiles_auth_admin_read on public.profiles for select to supabase_auth_admin using (true);
create policy profiles_select on public.profiles for select to authenticated using (((id = auth.uid()) OR is_platform_owner()));
create policy profiles_update on public.profiles for update to authenticated using (((id = auth.uid()) OR is_platform_owner())) with check (((id = auth.uid()) OR is_platform_owner()));
create policy prompt_library_delete on public.prompt_library for delete to authenticated using ((((account_id = current_account_id()) AND (NOT is_platform_starter)) OR is_platform_owner()));
create policy prompt_library_insert on public.prompt_library for insert to authenticated with check ((((account_id = current_account_id()) AND (created_by = auth.uid()) AND (NOT is_platform_starter)) OR is_platform_owner()));
create policy prompt_library_select on public.prompt_library for select to authenticated using (((account_id = current_account_id()) OR is_platform_starter OR is_platform_owner()));
create policy prompt_library_update on public.prompt_library for update to authenticated using ((((account_id = current_account_id()) AND (NOT is_platform_starter)) OR is_platform_owner())) with check ((((account_id = current_account_id()) AND (NOT is_platform_starter)) OR is_platform_owner()));
create policy research_sessions_delete on public.research_sessions for delete to authenticated using (((account_id = current_account_id()) OR is_platform_owner()));
create policy research_sessions_insert on public.research_sessions for insert to authenticated with check ((((account_id = current_account_id()) AND (created_by = auth.uid())) OR is_platform_owner()));
create policy research_sessions_select on public.research_sessions for select to authenticated using (((account_id = current_account_id()) OR is_platform_owner()));
create policy scan_history_delete on public.scan_history for delete to authenticated using (((account_id = current_account_id()) OR is_platform_owner()));
create policy scan_history_insert on public.scan_history for insert to authenticated with check ((((account_id = current_account_id()) AND (created_by = auth.uid())) OR is_platform_owner()));
create policy scan_history_select on public.scan_history for select to authenticated using (((account_id = current_account_id()) OR is_platform_owner()));
create policy testimonial_forms_delete on public.testimonial_forms for delete to authenticated using (((account_id = current_account_id()) OR is_platform_owner()));
create policy testimonial_forms_insert on public.testimonial_forms for insert to authenticated with check ((((account_id = current_account_id()) AND (created_by = auth.uid())) OR is_platform_owner()));
create policy testimonial_forms_select on public.testimonial_forms for select to authenticated using (((account_id = current_account_id()) OR is_platform_owner()));
create policy testimonial_forms_update on public.testimonial_forms for update to authenticated using (((account_id = current_account_id()) OR is_platform_owner())) with check (((account_id = current_account_id()) OR is_platform_owner()));
create policy testimonial_responses_delete on public.testimonial_responses for delete to authenticated using (((account_id = current_account_id()) OR is_platform_owner()));
create policy testimonial_responses_select on public.testimonial_responses for select to authenticated using (((account_id = current_account_id()) OR is_platform_owner()));
create policy testimonials_delete on public.testimonials for delete to authenticated using (((account_id = current_account_id()) OR is_platform_owner()));
create policy testimonials_insert on public.testimonials for insert to authenticated with check ((((account_id = current_account_id()) AND (created_by = auth.uid())) OR is_platform_owner()));
create policy testimonials_select on public.testimonials for select to authenticated using (((account_id = current_account_id()) OR is_platform_owner()));
create policy testimonials_update on public.testimonials for update to authenticated using (((account_id = current_account_id()) OR is_platform_owner())) with check (((account_id = current_account_id()) OR is_platform_owner()));
create policy video_jobs_delete on public.video_jobs for delete to authenticated using (((account_id = current_account_id()) OR is_platform_owner()));
create policy video_jobs_insert on public.video_jobs for insert to authenticated with check ((((account_id = current_account_id()) AND (created_by = auth.uid())) OR is_platform_owner()));
create policy video_jobs_select on public.video_jobs for select to authenticated using (((account_id = current_account_id()) OR is_platform_owner()));
create policy video_jobs_update on public.video_jobs for update to authenticated using (((account_id = current_account_id()) OR is_platform_owner())) with check (((account_id = current_account_id()) OR is_platform_owner()));
create policy kb_storage_delete on storage.objects for delete to authenticated using (((bucket_id = 'knowledge-base'::text) AND (((storage.foldername(name))[1] = (current_account_id())::text) OR is_platform_owner())));
create policy testimonial_media_delete on storage.objects for delete to authenticated using (((bucket_id = 'testimonial-media'::text) AND (((storage.foldername(name))[1] = (current_account_id())::text) OR is_platform_owner())));
create policy video_storage_delete on storage.objects for delete to authenticated using (((bucket_id = 'video-uploads'::text) AND (((storage.foldername(name))[1] = (current_account_id())::text) OR is_platform_owner())));
create policy kb_storage_insert on storage.objects for insert to authenticated with check (((bucket_id = 'knowledge-base'::text) AND (((storage.foldername(name))[1] = (current_account_id())::text) OR is_platform_owner())));
create policy testimonial_media_insert on storage.objects for insert to authenticated with check (((bucket_id = 'testimonial-media'::text) AND (((storage.foldername(name))[1] = (current_account_id())::text) OR is_platform_owner())));
create policy video_storage_insert on storage.objects for insert to authenticated with check (((bucket_id = 'video-uploads'::text) AND ((storage.foldername(name))[1] = (current_account_id())::text)));
create policy kb_storage_select on storage.objects for select to authenticated using (((bucket_id = 'knowledge-base'::text) AND (((storage.foldername(name))[1] = (current_account_id())::text) OR is_platform_owner())));
create policy testimonial_media_select on storage.objects for select to authenticated using (((bucket_id = 'testimonial-media'::text) AND (((storage.foldername(name))[1] = (current_account_id())::text) OR is_platform_owner())));
create policy video_storage_select on storage.objects for select to authenticated using (((bucket_id = 'video-uploads'::text) AND (((storage.foldername(name))[1] = (current_account_id())::text) OR is_platform_owner())));

-- ── Seed: global KB section templates (owner-managed, Module 2) ─────────────
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
  ('offer-sheets',   'Offer sheets & brochures','PDFs the AI reads for copy accuracy.', 110, true)
on conflict (section_type) do nothing;

-- ============================================================================
-- POST-APPLY DASHBOARD STEPS (cannot be done in SQL alone):
--   1. Authentication → Hooks → Customize Access Token (JWT) →
--        Postgres function → public.custom_access_token
--   2. After the founder signs up, promote them once:
--        update public.profiles set is_platform_owner = true where email = 'OWNER_EMAIL_HERE';
-- ============================================================================
