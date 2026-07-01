-- ============================================================================
-- KB — Brand Story & Founder Philosophy section
--
-- A dedicated upload slot (renders as a standard SectionCard, like Services /
-- FAQs). sort_order 5 places it first in the Knowledge Base, before Services.
-- Backfill instantiates it into existing accounts (idempotent).
-- ============================================================================

insert into public.kb_section_templates
  (section_type, title, description, sort_order, accepted_types, use_in_generation, is_active) values
  ('brand-story', 'Brand Story & Founder Philosophy',
   'Who SFT is, why it was built, Spencer''s origin, and the beliefs that drive everything. The AI reads this before generating any content about the company or founder.',
   5, '{pdf,docx,txt}', true, true)
on conflict (section_type) do nothing;

insert into public.knowledge_base_sections
  (account_id, template_id, section_type, title, description, sort_order, accepted_types, use_in_generation)
select a.id, t.id, t.section_type, t.title, t.description, t.sort_order, t.accepted_types, t.use_in_generation
from public.accounts a
cross join public.kb_section_templates t
where t.is_active
on conflict (account_id, section_type) do nothing;
