import type { BrandKitDraft } from "@/stores/brandKitStore";

interface ScoreItem {
  label: string;
  weight: number;
  complete: (kit: BrandKitDraft) => boolean;
}

/**
 * Brand score (Module 1): completeness percentage across all brand kit
 * fields. Weights favor the fields the AI leans on hardest when generating
 * content. The same calculation runs live in the form and is stored on save
 * so the Dashboard (Phase 4) and Analytics (Phase 22) read one number.
 */
export const SCORE_ITEMS: ScoreItem[] = [
  { label: "Business name", weight: 10, complete: (k) => k.business_name.trim().length > 0 },
  { label: "Tagline", weight: 5, complete: (k) => k.tagline.trim().length > 0 },
  { label: "Mission statement", weight: 10, complete: (k) => k.mission.trim().length >= 20 },
  { label: "Voice descriptors (2+)", weight: 10, complete: (k) => k.voice.length >= 2 },
  { label: "ICP — demographics", weight: 5, complete: (k) => k.icp.demographics.trim().length > 0 },
  { label: "ICP — pain points", weight: 5, complete: (k) => k.icp.pain_points.trim().length > 0 },
  { label: "ICP — goals", weight: 5, complete: (k) => k.icp.goals.trim().length > 0 },
  { label: "ICP — objections", weight: 5, complete: (k) => k.icp.objections.trim().length > 0 },
  { label: "Content pillars (3–5)", weight: 15, complete: (k) => k.pillars.length >= 3 },
  { label: "Active platforms (1+)", weight: 10, complete: (k) => k.platforms.length >= 1 },
  { label: "Business URL", weight: 5, complete: (k) => k.url.trim().length > 0 },
  { label: "Competitors (1+)", weight: 5, complete: (k) => k.competitors.length >= 1 },
  { label: "Brand colors (1+)", weight: 5, complete: (k) => k.brand_colors.length >= 1 },
  { label: "Typography", weight: 5, complete: (k) => k.typography.trim().length > 0 },
];

export function calculateBrandScore(kit: BrandKitDraft): number {
  const total = SCORE_ITEMS.reduce((sum, item) => sum + item.weight, 0);
  const earned = SCORE_ITEMS.reduce(
    (sum, item) => sum + (item.complete(kit) ? item.weight : 0),
    0
  );
  return Math.round((earned / total) * 100);
}
