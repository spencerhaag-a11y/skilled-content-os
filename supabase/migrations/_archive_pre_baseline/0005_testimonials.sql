-- ============================================================================
-- Phase 9 — Testimonial Builder & Review Manager (Module 7)
-- ============================================================================

create table public.testimonials (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts (id) on delete cascade,
  client_name     text not null default '',
  raw_text        text not null,
  service_tag     text,
  client_type_tag text,
  outcome_tag     text,
  source          text not null default 'direct'
    check (source in ('google', 'facebook', 'instagram', 'direct', 'form', 'other')),
  media_url       text, -- storage path in testimonial-media (screenshot) or external video link
  created_by      uuid references auth.users (id),
  created_at      timestamptz not null default now()
);

create index testimonials_account_idx on public.testimonials (account_id, created_at desc);

create table public.testimonial_forms (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts (id) on delete cascade,
  title            text not null default 'Client feedback',
  questions_json   jsonb not null default '[]'::jsonb, -- [string]
  share_link_token text not null unique default encode(gen_random_bytes(24), 'hex'),
  is_active        boolean not null default true,
  created_by       uuid references auth.users (id),
  created_at       timestamptz not null default now()
);

create index testimonial_forms_account_idx on public.testimonial_forms (account_id);
create index testimonial_forms_token_idx on public.testimonial_forms (share_link_token);

create table public.testimonial_responses (
  id           uuid primary key default gen_random_uuid(),
  form_id      uuid not null references public.testimonial_forms (id) on delete cascade,
  account_id   uuid not null references public.accounts (id) on delete cascade,
  client_name  text not null default '',
  answers_json jsonb not null default '[]'::jsonb, -- [{question, answer}]
  created_at   timestamptz not null default now()
);

create index testimonial_responses_account_idx on public.testimonial_responses (account_id, created_at desc);
create index testimonial_responses_form_idx on public.testimonial_responses (form_id);

alter table public.testimonials enable row level security;
alter table public.testimonial_forms enable row level security;
alter table public.testimonial_responses enable row level security;

create policy testimonials_select on public.testimonials for select to authenticated
  using (account_id = public.current_account_id() or public.is_platform_owner());
create policy testimonials_insert on public.testimonials for insert to authenticated
  with check ((account_id = public.current_account_id() and created_by = auth.uid()) or public.is_platform_owner());
create policy testimonials_update on public.testimonials for update to authenticated
  using (account_id = public.current_account_id() or public.is_platform_owner())
  with check (account_id = public.current_account_id() or public.is_platform_owner());
create policy testimonials_delete on public.testimonials for delete to authenticated
  using (account_id = public.current_account_id() or public.is_platform_owner());

create policy testimonial_forms_select on public.testimonial_forms for select to authenticated
  using (account_id = public.current_account_id() or public.is_platform_owner());
create policy testimonial_forms_insert on public.testimonial_forms for insert to authenticated
  with check ((account_id = public.current_account_id() and created_by = auth.uid()) or public.is_platform_owner());
create policy testimonial_forms_update on public.testimonial_forms for update to authenticated
  using (account_id = public.current_account_id() or public.is_platform_owner())
  with check (account_id = public.current_account_id() or public.is_platform_owner());
create policy testimonial_forms_delete on public.testimonial_forms for delete to authenticated
  using (account_id = public.current_account_id() or public.is_platform_owner());

-- Responses: clients of the platform can READ their own; INSERT has no
-- authenticated policy at all — public submissions go exclusively through
-- the testimonial-form Edge Function (service role + opaque token check),
-- per Section 3 Security Requirements.
create policy testimonial_responses_select on public.testimonial_responses for select to authenticated
  using (account_id = public.current_account_id() or public.is_platform_owner());
create policy testimonial_responses_delete on public.testimonial_responses for delete to authenticated
  using (account_id = public.current_account_id() or public.is_platform_owner());

-- ── Storage: testimonial-media bucket (Section 5) ──────────────────────────

insert into storage.buckets (id, name, public, file_size_limit)
values ('testimonial-media', 'testimonial-media', false, 52428800)
on conflict (id) do nothing;

create policy testimonial_media_select on storage.objects for select to authenticated
  using (bucket_id = 'testimonial-media'
    and ((storage.foldername(name))[1] = public.current_account_id()::text or public.is_platform_owner()));
create policy testimonial_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'testimonial-media'
    and ((storage.foldername(name))[1] = public.current_account_id()::text or public.is_platform_owner()));
create policy testimonial_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'testimonial-media'
    and ((storage.foldername(name))[1] = public.current_account_id()::text or public.is_platform_owner()));
