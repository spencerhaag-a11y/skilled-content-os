// Edge Function: niche-research
// Module 18 — Niche Research. Given a niche, returns a ranked list of content
// ideas (each with a suggested format and angle), frequently asked questions,
// and seasonal opportunities. Saved to research_sessions, which the Prompt
// Library reads for its "trending prompts" link (Phase 14).
//
// Deploy: supabase functions deploy niche-research

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { callClaude, parseJsonBlock } from "../_shared/claude.ts";
import { fetchAccountContext, buildBrandSystemPrompt } from "../_shared/context.ts";

const KB_SECTIONS = ["services", "faqs"];

interface ResearchResults {
  topics: { topic: string; format: string; angle: string; rank: number }[];
  faqs: string[];
  seasonal: { opportunity: string; timing: string }[];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SCHEMA = `Respond with ONLY a JSON object — no markdown fences, no preamble. Schema:
{
  "topics": [ { "topic": string, "format": "blog" | "reel" | "carousel" | "email" | "social", "angle": string (the specific hook/angle), "rank": number (1 = highest priority) } ] (8-12 ideas, ranked),
  "faqs": string[] (8-12 real questions this niche's audience asks),
  "seasonal": [ { "opportunity": string, "timing": string (month/season/event) } ] (4-6 items)
}`;

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightIfNeeded(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let niche = "";
  try {
    const body = await req.json();
    niche = String(body.niche ?? "").trim().slice(0, 300);
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  if (niche.length < 2) return json({ error: "Enter a niche or topic area." }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } }
  );

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) return json({ error: "Not authenticated." }, 401);
  const userId = userData.user.id;

  const { data: profile } = await supabase
    .from("profiles")
    .select("account_id")
    .eq("id", userId)
    .maybeSingle();
  if (!profile?.account_id) return json({ error: "No account found for this user." }, 403);
  const accountId = profile.account_id;

  try {
    const ctx = await fetchAccountContext(supabase, accountId, KB_SECTIONS, 3000);
    const system =
      `${buildBrandSystemPrompt(ctx)}\n\n## Task\nYou are a content strategist researching the niche below. Produce ranked, specific, non-generic content ideas this brand can act on, the real questions its audience asks, and seasonal openings. ${SCHEMA}`;

    const raw = await callClaude({
      system,
      userContent: `Niche / topic area: ${niche}`,
      maxTokens: 2400,
    });
    const parsed = parseJsonBlock<ResearchResults>(raw);

    const norm: ResearchResults = {
      topics: Array.isArray(parsed.topics)
        ? parsed.topics
            .filter((t) => t && typeof t.topic === "string")
            .slice(0, 12)
            .map((t, i) => ({
              topic: t.topic,
              format: typeof t.format === "string" ? t.format : "social",
              angle: typeof t.angle === "string" ? t.angle : "",
              rank: typeof t.rank === "number" ? t.rank : i + 1,
            }))
        : [],
      faqs: Array.isArray(parsed.faqs) ? parsed.faqs.filter((f) => typeof f === "string").slice(0, 12) : [],
      seasonal: Array.isArray(parsed.seasonal)
        ? parsed.seasonal
            .filter((s) => s && typeof s.opportunity === "string")
            .slice(0, 6)
            .map((s) => ({ opportunity: s.opportunity, timing: typeof s.timing === "string" ? s.timing : "" }))
        : [],
    };

    if (norm.topics.length === 0) return json({ error: "No ideas generated. Try a more specific niche." }, 422);

    const { data: session, error: insertError } = await supabase
      .from("research_sessions")
      .insert({
        account_id: accountId,
        created_by: userId,
        niche,
        results_json: norm,
      })
      .select("id, niche, results_json, created_at")
      .single();
    if (insertError) throw new Error(insertError.message);

    return json({ session });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Research failed.";
    return json({ error: message }, 500);
  }
});
