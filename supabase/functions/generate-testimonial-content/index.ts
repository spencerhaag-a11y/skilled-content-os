// Edge Function: generate-testimonial-content
// Module 7 — Turns one testimonial (pasted review or form response) into
// four polished content assets: carousel, pull quote, before/after story,
// written testimonial block. All saved as Drafts → Kanban.
//
// Deploy: supabase functions deploy generate-testimonial-content

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { callClaude, parseJsonBlock } from "../_shared/claude.ts";
import { fetchAccountContext, buildBrandSystemPrompt } from "../_shared/context.ts";

interface Output {
  carousel?: { title: string; slides: string[] };
  pull_quote?: { title: string; body: string };
  before_after?: { title: string; body: string };
  testimonial_block?: { title: string; body: string };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightIfNeeded(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let testimonialId = "";
  try {
    const body = await req.json();
    testimonialId = String(body.testimonial_id ?? "");
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  if (!testimonialId) return json({ error: "testimonial_id is required." }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } }
  );

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) return json({ error: "Not authenticated." }, 401);
  const userId = userData.user.id;

  // RLS scopes this read to the caller's account.
  const { data: t, error: tError } = await supabase
    .from("testimonials")
    .select("id, account_id, client_name, raw_text, service_tag, client_type_tag, outcome_tag")
    .eq("id", testimonialId)
    .maybeSingle();
  if (tError) return json({ error: tError.message }, 500);
  if (!t) return json({ error: "Testimonial not found." }, 404);

  try {
    const ctx = await fetchAccountContext(supabase, t.account_id, ["services", "promotions"], 3000);
    const system =
      `${buildBrandSystemPrompt(ctx)}\n\n## Task\n` +
      `You will receive one real client testimonial. Turn it into four social-proof assets. ` +
      `Stay 100% truthful to what the client actually said — you may tighten wording and fix ` +
      `grammar inside quotes, but never invent results, numbers, or sentiment. ` +
      `Use the client's first name only${t.client_name ? "" : " (no name was provided — write around it)"}.\n` +
      `Respond with ONLY a JSON object — no fences, no preamble. Schema:\n` +
      `{"carousel": {"title": string, "slides": [string] (first = title slide hook, then 4-6 quote/stat slides drawn from the testimonial, last = CTA slide; each ≤ 30 words)},\n` +
      ` "pull_quote": {"title": string, "body": string (the single most powerful sentence as a quote, plus a 1-2 line caption and CTA for sharing it as a graphic)},\n` +
      ` "before_after": {"title": string, "body": string (story-format social post: where the client started → what changed → where they are now → CTA)},\n` +
      ` "testimonial_block": {"title": string, "body": string (clean written testimonial with attribution line, ready for a website or email)}}`;

    const tags = [
      t.service_tag && `Service: ${t.service_tag}`,
      t.client_type_tag && `Client type: ${t.client_type_tag}`,
      t.outcome_tag && `Outcome: ${t.outcome_tag}`,
    ]
      .filter(Boolean)
      .join(" | ");

    const userContent =
      `Client: ${t.client_name || "(name withheld)"}\n` +
      (tags ? `${tags}\n` : "") +
      `\nTestimonial:\n${String(t.raw_text).slice(0, 8000)}`;

    const raw = await callClaude({ system, userContent, maxTokens: 3000 });
    const out = parseJsonBlock<Output>(raw);

    const base = {
      account_id: t.account_id,
      created_by: userId,
      status: "draft",
      pillar: t.service_tag || null,
    };
    const rows: Record<string, unknown>[] = [];

    if (out.carousel?.slides?.length) {
      const slides = out.carousel.slides
        .map((s, i, arr) => {
          const label = i === 0 ? "TITLE SLIDE" : i === arr.length - 1 ? "CTA SLIDE" : `SLIDE ${i + 1}`;
          return `[${label}]\n${s}`;
        })
        .join("\n\n");
      rows.push({ ...base, type: "carousel", platform: "Instagram", title: out.carousel.title || "Testimonial carousel", body: slides });
    }
    if (out.pull_quote?.body) {
      rows.push({ ...base, type: "caption", platform: "Instagram", title: out.pull_quote.title || "Pull quote", body: out.pull_quote.body });
    }
    if (out.before_after?.body) {
      rows.push({ ...base, type: "caption", platform: "Instagram", title: out.before_after.title || "Before/after story", body: out.before_after.body });
    }
    if (out.testimonial_block?.body) {
      rows.push({ ...base, type: "testimonial_block", platform: null, title: out.testimonial_block.title || "Written testimonial", body: out.testimonial_block.body });
    }

    if (rows.length === 0) return json({ error: "Generation produced no usable outputs. Try again." }, 422);

    const { data: pieces, error: insertError } = await supabase
      .from("content_pieces")
      .insert(rows)
      .select("id, type, platform, title, body, status, created_at");
    if (insertError) throw new Error(insertError.message);

    return json({ pieces });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed.";
    return json({ error: message }, 500);
  }
});
