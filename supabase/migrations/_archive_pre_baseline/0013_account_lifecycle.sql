-- ============================================================================
-- Phase 23 — Account lifecycle + per-account feature flags (Module 21)
--
-- This DB does feature flags as an accounts.disabled_modules text[] (each
-- entry is a ModuleDef.path from src/lib/modules.ts, e.g. '/video', '/seo').
-- The white-label Owner Panel edits that array; the sidebar hides anything in
-- it. disabled_modules already exists in the live project; is_active is the
-- one field this migration adds (account deactivation). Both are idempotent.
-- ============================================================================

alter table public.accounts
  add column if not exists disabled_modules text[] not null default '{}'::text[];

alter table public.accounts
  add column if not exists is_active boolean not null default true;
