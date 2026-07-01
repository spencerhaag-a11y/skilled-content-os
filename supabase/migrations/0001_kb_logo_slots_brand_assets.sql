-- ============================================================================
-- KB Upgrade — Logo slots + Brand Assets (SCO_KB_Upgrade_Spec)
--
-- 1. knowledge_base_files gains slot_key (named logo-kit slots) and
--    category_key (brand-assets sub-categories). Both nullable — existing
--    files and all other sections ignore them.
-- 2. New 'brand-assets' section template at sort_order 35 (between logo-kit=30
--    and events=40).
-- 3. Backfill: instantiate every active template into every existing account
--    (idempotent) so the new section appears for accounts created before this.
-- ============================================================================

alter table public.knowledge_base_files
  add column if not exists slot_key text;
alter table public.knowledge_base_files
  add column if not exists category_key text;

-- Logo-kit slots are one-file-each, so a partial unique index keeps a slot
-- from accumulating duplicates per account.
create unique index if not exists kb_files_account_slot_uniq
  on public.knowledge_base_files (account_id, slot_key)
  where slot_key is not null;

insert into public.kb_section_templates
  (section_type, title, description, sort_order, accepted_types, use_in_generation) values
  ('brand-assets', 'Brand Assets',
   'Brand guidelines, post-format templates, prior winning posts, visual renderings, and other brand reference material.',
   35, '{pdf,docx,png,jpg,svg,mp4,txt}', true)
on conflict (section_type) do nothing;

-- Instantiate active templates into existing accounts (mirrors
-- seed_account_kb_sections / sync_kb_sections_from_templates, no owner guard).
insert into public.knowledge_base_sections
  (account_id, template_id, section_type, title, description, sort_order, accepted_types, use_in_generation)
select a.id, t.id, t.section_type, t.title, t.description, t.sort_order, t.accepted_types, t.use_in_generation
from public.accounts a
cross join public.kb_section_templates t
where t.is_active
on conflict (account_id, section_type) do nothing;
