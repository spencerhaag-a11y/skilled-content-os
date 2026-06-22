// Edge Function: google-business
// Module 15 — Google Business Tools. One function, five tasks:
//   profile_audit   → paste current GBP fields, get completeness gaps
//   gbp_post        → weekly update / offer / event post (saved as a content piece)
//   review_response → paste a review, get a brand-voice reply
//   qa_generate     → common Q&A pairs for the GBP Q&A section
//   local_keywords  → local keyword suggestions from location + category
//
// Deploy: supabase functions deploy google-business

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { callClaude, parseJsonBlock } from "../_shared/claude.ts";
import { fetchAccountContext, buildBrandSystemPrompt } from "../_shared/context.ts";

const TASKS = ["profile_audit", "gbp_post", "review_response", "qa_generate", "local_keywords"];
const KB_SECTIONS = ["services", "promotions", "events", "faqs"];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SCHEMAS: Record<string, string> = {
  profile_audit: `{ "score": number (0-100), "gaps": [ { "field": string, "issue": string, "fix": string } ] (6-12 items), "strengths": string[] }`,
  gbp_post: `{ "title": string (short internal label), "body": string (the GBP post, 1500 char max, with a clear CTA), "cta_label": string }`,
  review_response: `{ "response": string (brand-voice reply, warm and specific, no fabricated facts) }`,
  qa_generate: `{ "qa": [ { "question": string, "answer": string } ] (8-12 pairs) }`,
  local_keywords: `{ "keywords": string[] (15-25 local-intent terms), "post_ideas": string[] (5-8 GBP post ideas using them) }`,
};

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightIfNeeded(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let task = "";
  let input = "";
  let postType = "update";
  try {
    const body = await req.json();
    task = String(body.task ?? "").trim();
    input = String(body.input ?? "").trim().slice(0, 6000);
    postType = String(body.post_type ?? "update").trim();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  if (!TASKS.includes(task)) return json({ error: "Unknown task." }, 400);

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

  // Tasks that take pasted content require it; generators can run from brand context alone.
  if ((task === "profile_audit" || task === "review_response") && input.length < 5) {
    return json({ error: "Paste the GBP info or review first." }, 400);
  }

  try {
    const ctx = await fetchAccountContext(supabase, accountId, KB_SECTIONS, 3500);
    const taskInstruction: Record<string, string> = {
      profile_audit: "Audit this Google Business Profile for completeness and quality. Pasted profile fields follow.",
      gbp_post: `Write a Google Business Profile post (type: ${postType}). Keep it local, specific, and action-oriented.`,
      review_response: "Write a reply to this Google review in the brand voice. Never invent facts or make medical promises. Review follows.",
      qa_generate: "Generate Q&A pairs for the Google Business Profile Q&A section based on this business.",
      local_keywords: "Suggest local-intent keywords and GBP post ideas for this business and its location/category.",
    };
    const system =
      `${buildBrandSystemPrompt(ctx)}\n\n## Task\n${taskInstruction[task]}\n\nRespond with ONLY a JSON object — no markdown fences, no preamble. Schema: ${SCHEMAS[task]}`;

    const userContent = input || "(no pasted input — use the business context above)";
    const raw = await callClaude({ system, userContent, maxTokens: 1800 });
    const results = parseJsonBlock<Record<string, unknown>>(raw);

    // The GBP post generator drops a draft into the content library (Module 9/11).
    let savedPieceId: string | null = null;
    if (task === "gbp_post") {
      const r = results as { title?: string; body?: string };
      if (r.body) {
        const { data: piece } = await supabase
          .from("content_pieces")
          .insert({
            account_id: accountId,
            created_by: userId,
            type: "gbp_post",
            platform: "GBP",
            title: r.title || "Google Business post",
            body: r.body,
            status: "draft",
          })
          .select("id")
          .single();
        savedPieceId = piece?.id ?? null;
      }
    }

    return json({ task, results, saved_piece_id: savedPieceId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Task failed.";
    return json({ error: message }, 422);
  }
});
