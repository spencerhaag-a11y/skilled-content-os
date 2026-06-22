// Shared account-context assembler (Module 2: "Claude API calls include
// relevant knowledge base context based on the content type being
// generated"). Used by every content-generation Edge Function.
//
// Deterministic section-type routing, no vector search in v1: cheap,
// predictable, and the section taxonomy is owner-curated.

// deno-lint-ignore-file no-explicit-any

export interface KnowledgeSnippet {
  title: string;
  text: string;
}

export interface AccountContext {
  brandKit: Record<string, any> | null;
  knowledge: KnowledgeSnippet[];
}

/**
 * Loads the brand kit plus extracted text from the requested KB section
 * types. Sections flagged use_in_generation = false (e.g. SOPs) are
 * excluded at the query level — structurally, not by prompt instruction.
 */
export async function fetchAccountContext(
  supabase: any,
  accountId: string,
  sectionTypes: string[],
  totalCharBudget: number
): Promise<AccountContext> {
  const [brandRes, sectionsRes] = await Promise.all([
    supabase.from("brand_kits").select("*").eq("account_id", accountId).maybeSingle(),
    supabase
      .from("knowledge_base_sections")
      .select("id, section_type, title")
      .eq("account_id", accountId)
      .eq("use_in_generation", true)
      .in("section_type", sectionTypes),
  ]);

  const knowledge: KnowledgeSnippet[] = [];
  const sections = sectionsRes.data ?? [];
  if (sections.length > 0) {
    const perSectionBudget = Math.floor(totalCharBudget / sections.length);
    const { data: files } = await supabase
      .from("knowledge_base_files")
      .select("section_id, file_name, extracted_text")
      .eq("account_id", accountId)
      .eq("extraction_status", "done")
      .in("section_id", sections.map((s: any) => s.id));

    for (const section of sections) {
      const sectionFiles = (files ?? []).filter(
        (f: any) => f.section_id === section.id && f.extracted_text
      );
      if (sectionFiles.length === 0) continue;
      let remaining = perSectionBudget;
      const parts: string[] = [];
      for (const f of sectionFiles) {
        if (remaining <= 0) break;
        const chunk = String(f.extracted_text).slice(0, remaining);
        parts.push(chunk);
        remaining -= chunk.length;
      }
      knowledge.push({ title: section.title, text: parts.join("\n") });
    }
  }

  return { brandKit: brandRes.data ?? null, knowledge };
}

/** Renders the account context into a system prompt block. */
export function buildBrandSystemPrompt(ctx: AccountContext): string {
  const b = ctx.brandKit;
  const lines: string[] = [
    "You are the in-house content writer for the following business. Everything you produce must sound like this brand, speak to this audience, and stay factually accurate to the business information provided.",
    "",
  ];

  if (b) {
    lines.push("## Brand");
    if (b.business_name) lines.push(`Business: ${b.business_name}`);
    if (b.tagline) lines.push(`Tagline: ${b.tagline}`);
    if (b.mission) lines.push(`Mission: ${b.mission}`);
    if (Array.isArray(b.voice) && b.voice.length) lines.push(`Voice: ${b.voice.join(", ")}`);
    const icp = b.icp ?? {};
    const icpParts = [
      icp.demographics && `Demographics: ${icp.demographics}`,
      icp.pain_points && `Pain points: ${icp.pain_points}`,
      icp.goals && `Goals: ${icp.goals}`,
      icp.objections && `Objections: ${icp.objections}`,
    ].filter(Boolean);
    if (icpParts.length) lines.push("Ideal client:", ...icpParts.map((p) => `- ${p}`));
    if (Array.isArray(b.pillars) && b.pillars.length)
      lines.push(`Content pillars: ${b.pillars.join(" | ")}`);
    if (Array.isArray(b.platforms) && b.platforms.length)
      lines.push(
        `Active platforms: ${b.platforms
          .map((p: any) => `${p.platform}${p.handle ? ` (${p.handle})` : ""}`)
          .join(", ")}`
      );
    lines.push("");
  }

  if (ctx.knowledge.length > 0) {
    lines.push("## Business knowledge (authoritative — do not contradict or invent beyond it)");
    for (const k of ctx.knowledge) {
      lines.push(`### ${k.title}`, k.text, "");
    }
  }

  lines.push(
    "## Rules",
    "- Never invent prices, offers, credentials, dates, or claims not present in the business knowledge.",
    "- No medical guarantees or outcome promises.",
    "- Write like a person, not a brochure. No hashtag walls; 3-5 relevant hashtags max where hashtags are requested."
  );

  return lines.join("\n");
}
