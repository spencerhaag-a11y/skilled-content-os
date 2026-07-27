-- ============================================================================
-- Trending Format Matching (Fable5_Spec_TrendingFormatMatching)
--
-- trend_format     — name of the trend applied (e.g. 'netflix-documentary').
-- original_concept — the pre-trend-match body, preserved so the user can revert.
--
-- Both nullable and additive: every existing piece and the primary generation
-- flow are untouched. Trend matching is an optional post-processing step.
-- ============================================================================

alter table public.content_pieces add column if not exists trend_format text;
alter table public.content_pieces add column if not exists original_concept text;
