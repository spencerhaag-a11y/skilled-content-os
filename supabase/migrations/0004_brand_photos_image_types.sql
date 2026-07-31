-- ============================================================================
-- KB — Brand photos accepts image formats only
--
-- The section inherited the column-wide default {pdf,docx,png,jpg,svg,mp4,txt},
-- which was never a decision about a photos section — it let a PDF or an MP4 be
-- filed as a brand photo, and the Drive import button offers only photos there.
--
-- jpeg is listed explicitly alongside jpg even though normalizeExt() folds one
-- onto the other, so the accepted list the UI prints names both spellings.
--
-- Updates the template (new accounts, via seed_account_kb_sections) and every
-- already-instantiated section (existing accounts). Idempotent.
-- ============================================================================

update public.kb_section_templates
   set accepted_types = '{png,jpg,jpeg,svg,webp}'
 where section_type = 'brand-photos';

update public.knowledge_base_sections
   set accepted_types = '{png,jpg,jpeg,svg,webp}'
 where section_type = 'brand-photos';
