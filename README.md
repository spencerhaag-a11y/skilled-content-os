# Skilled Content OS

White-label, multi-tenant AI content platform. React + Vite + Tailwind + Supabase.
Spec: Skilled_Content_OS_Build_Prompt_v1_1 — build order in Section 4.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local`, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
3. `npm run dev`

Edge Function secrets (`ANTHROPIC_API_KEY`, `ASSEMBLYAI_API_KEY`) are set via
`supabase secrets set` — never in client env vars.

## Structure

- `src/lib/modules.ts` — module registry: single source of truth for nav + routes
- `src/lib/supabase.ts` — Supabase client + Edge Function invoker
- `src/lib/utils.ts` — `cn()` + runtime white-label theming (`applyAccountTheme`)
- `src/stores/` — Zustand: auth (session + platform_owner claim), account (branding)
- `src/components/layout/` — app shell: dark sidebar, topbar
- `src/pages/modules/` — one file per module; each build phase replaces one file
- `supabase/functions/` — Edge Functions (added from Phase 5 on)

## Build status

Phases 0–15 complete. Next: Phase 16 — Video Module.

### Phase 15 setup checklist
1. Run `supabase/migrations/0010_ghl_integration.sql` in the SQL Editor.
2. `supabase functions deploy ghl-connect`
3. `supabase functions deploy ghl-push`
4. In GHL: Settings → Private Integrations → create a token with social
   posting, email builder, and blog scopes; grab the sub-account Location ID.
   Enter both in the app under Settings → GoHighLevel.

### Phase 14 setup checklist
1. Run `supabase/migrations/0009_research_sessions.sql` in the SQL Editor
   (research_sessions table — trending source; Phase 21 populates it).

### Phase 13 setup checklist
1. Run `supabase/migrations/0008_brainstorm_and_prompts.sql` in the SQL Editor
   (brainstorm_sessions + prompt_library tables).
2. `supabase functions deploy brainstorm`

### Phase 12 setup checklist
1. Run `supabase/migrations/0007_content_versions.sql` in the SQL Editor
   (version history table + automatic edit-snapshot trigger).

### Phase 11 setup checklist
Nothing to configure — no new SQL or functions this phase.

### Phase 10 setup checklist
1. Run `supabase/migrations/0006_content_comments.sql` in the SQL Editor.
   (Frontend dep @dnd-kit/core added — run `npm install` after pulling.)

### Phase 9 setup checklist
1. Run `supabase/migrations/0005_testimonials.sql` in the SQL Editor.
2. `supabase functions deploy generate-testimonial-content`
3. `supabase functions deploy testimonial-form --no-verify-jwt`
   (public form endpoint — token-gated, service-role inside)

### Phase 8 setup checklist
1. `supabase functions deploy generate-email` (no new SQL this phase).

### Phase 7 setup checklist
1. `supabase functions deploy generate-blog` (no new SQL this phase).

### Phase 6 setup checklist
1. `supabase functions deploy generate-social` (no new SQL this phase).

### Phase 5 setup checklist
1. `supabase functions deploy repurpose` (no new SQL this phase).

### Phase 4 setup checklist
1. Run `supabase/migrations/0004_content_pieces.sql` in the SQL Editor
   (content_pieces table + ghl_connected flag on accounts).

### Phase 3 setup checklist
1. Run `supabase/migrations/0003_knowledge_base.sql` in the SQL Editor
   (creates tables, seeds the 11 default section templates, creates the
   private `knowledge-base` storage bucket with RLS).
2. `supabase functions deploy kb-extract-text`

### Phase 2 setup checklist
1. Run `supabase/migrations/0002_brand_kits.sql` in the SQL Editor.
2. `supabase secrets set ANTHROPIC_API_KEY=sk-ant-...`
3. `supabase functions deploy brand-scan`

### Phase 1 setup checklist (one-time, Supabase Dashboard)
1. Run `supabase/migrations/0001_auth_and_accounts.sql` in the SQL Editor.
2. Authentication → Hooks → "Customize Access Token (JWT)" → enable →
   Postgres function → `public.custom_access_token`.
3. Sign up with the master owner email, then run once in SQL Editor:
   `update public.profiles set is_platform_owner = true where email = 'OWNER_EMAIL';`
4. Sign out and back in (mints a token carrying the owner claim).
