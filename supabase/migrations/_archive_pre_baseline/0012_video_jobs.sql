-- ============================================================================
-- Phase 16 — Video Module (Module 8)
-- Tracks each uploaded video through transcription + analysis. The client
-- uploads to the video-uploads bucket and inserts a job; video-transcribe
-- submits it to AssemblyAI with a per-job webhook_token in the callback URL;
-- video-webhook (service role, no JWT) fills in transcript, captions, edit
-- markers, and clip suggestions, then flips status to 'done'.
--
-- NOTE: This table + bucket already exist in the live project (created
-- out-of-band by an earlier build). This file is the idempotent source-of-
-- truth mirror of that live schema. Authentication of the webhook is per-row
-- via webhook_token — there is no global webhook secret.
-- ============================================================================

create table if not exists public.video_jobs (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts (id) on delete cascade,
  title            text not null default 'Untitled video',
  file_path        text not null,             -- {account_id}/video/{ts}_{file}
  file_name        text not null,
  file_size        bigint not null default 0,
  status           text not null default 'uploaded'
    check (status in ('uploaded', 'transcribing', 'analyzing', 'done', 'failed')),
  error_detail     text,
  provider_job_id  text,                       -- AssemblyAI transcript id
  webhook_token    text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  transcript       text,
  transcript_json  jsonb,                      -- { words: [{text,start,end}] }
  srt              text,
  vtt              text,
  edit_markers     jsonb not null default '[]'::jsonb,
  clip_suggestions jsonb not null default '[]'::jsonb,
  duration_seconds numeric,
  created_by       uuid references auth.users (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists video_jobs_account_idx on public.video_jobs (account_id, created_at desc);
create index if not exists video_jobs_provider_idx on public.video_jobs (provider_job_id) where provider_job_id is not null;

drop trigger if exists video_jobs_set_updated_at on public.video_jobs;
create trigger video_jobs_set_updated_at
  before update on public.video_jobs
  for each row execute function public.set_updated_at();

alter table public.video_jobs enable row level security;

drop policy if exists video_jobs_select on public.video_jobs;
drop policy if exists video_jobs_insert on public.video_jobs;
drop policy if exists video_jobs_update on public.video_jobs;
drop policy if exists video_jobs_delete on public.video_jobs;

create policy video_jobs_select on public.video_jobs for select to authenticated
  using ((account_id = current_account_id()) or is_platform_owner());
create policy video_jobs_insert on public.video_jobs for insert to authenticated
  with check (((account_id = current_account_id()) and (created_by = auth.uid())) or is_platform_owner());
create policy video_jobs_update on public.video_jobs for update to authenticated
  using ((account_id = current_account_id()) or is_platform_owner())
  with check ((account_id = current_account_id()) or is_platform_owner());
create policy video_jobs_delete on public.video_jobs for delete to authenticated
  using ((account_id = current_account_id()) or is_platform_owner());
-- The webhook updates rows with the service role, which bypasses RLS.

-- ── Storage: video-uploads bucket (Section 5, 2GB cap for video) ───────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('video-uploads', 'video-uploads', false, 2147483648)
on conflict (id) do nothing;

drop policy if exists video_storage_select on storage.objects;
drop policy if exists video_storage_insert on storage.objects;
drop policy if exists video_storage_delete on storage.objects;

create policy video_storage_select on storage.objects for select to authenticated
  using (
    bucket_id = 'video-uploads'
    and (((storage.foldername(name))[1] = current_account_id()::text) or is_platform_owner())
  );
create policy video_storage_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'video-uploads'
    and ((storage.foldername(name))[1] = current_account_id()::text)
  );
create policy video_storage_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'video-uploads'
    and (((storage.foldername(name))[1] = current_account_id()::text) or is_platform_owner())
  );
