// Edge Function: trend-match-apply
// Trending Format Matching — step 2 (apply). Rewrites an existing concept's
// hook, structure, and pacing to match a trend format the user selected in
// trend-match, while keeping SFT's voice, phrases, and philosophy intact.
//
// Additive: generate-social and the primary generation flow are untouched.
// Only runs on an explicit user selection — nothing here auto-applies.
//
// Deploy: supabase functions deploy trend-match-apply

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { callClaude, parseJsonBlock } from "../_shared/claude.ts";
import { fetchAccountContext, buildBrandSystemPrompt } from "../_shared/context.ts";

// Founder Voice and the Language Guide are documents that live in the
// Brand Story and Brand Assets sections — there is no separate section type
// for them — so both are pulled first and given the most room.
const KB_SECTIONS = [
  "brand-story",
  "brand-assets",
  "services",
  "promotions",
  "testimonials",
  "faqs",
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Mirrors generate-social so the reformatted output keeps the same shape. */
function formatSchema(type: string): string {
  switch (type) {
    case "carousel":
      return `{"hook": string (the opening line, in the trend format's voice), "slides": [string] (first = title slide copy, then 5-7 content slides, last = CTA slide; each ≤ 30 words)}`;
    case "reel_script":
      return `{"hook": string, "body": string (15-45 second short-form video script with [HOOK], [BODY], [CTA] markers, spoken lines plus brief on-screen text cues)}`;
    case "story_frames":
      return `{"hook": string, "frames": [{"image_idea": string, "overlay_text": string}] (exactly 3 story frames)}`;
    case "thread":
      return `{"hook": string, "posts": [string] (5-8 posts; post 1 is the hook, the last is the CTA; each post ≤ 280 characters)}`;
    default:
      return `{"hook": string (the scroll-stopping opening line), "body": string (the complete caption: hook line, value-driven body, clear CTA, then 3-5 relevant hashtags)}`;
  }
}

interface TrendOutput {
  hook?: string;
  body?: string;
  slides?: string[];
  frames?: { image_idea: string; overlay_text: string }[];
  posts?: string[];
}

/** Mirrors generate-social's renderBody so stored bodies stay consistent. */
function renderBody(type: string, out: TrendOutput): string {
  if (type === "carousel" && out.slides?.length) {
    return out.slides
      .map((s, i, arr) => {
        const label = i === 0 ? "TITLE SLIDE" : i === arr.length - 1 ? "CTA SLIDE" : `SLIDE ${i + 1}`;
        return `[${label}]\n${s}`;
      })
      .join("\n\n");
  }
  if (type === "story_frames" && out.frames?.length) {
    return out.frames
      .slice(0, 3)
      .map((f, i) => `[FRAME ${i + 1}]\nImage: ${f.image_idea}\nOverlay: ${f.overlay_text}`)
      .join("\n\n");
  }
  if (type === "thread" && out.posts?.length) {
    return out.posts.map((p, i) => `${i + 1}/ ${p}`).join("\n\n");
  }
  return out.body ?? "";
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightIfNeeded(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let pieceId = "";
  let concept = "";
  let formatName = "";
  let formatDescription = "";
  try {
    const body = await req.json();
    pieceId = String(body.content_piece_id ?? "").trim();
    concept = String(body.concept ?? "").trim().slice(0, 8000);
    formatName = String(body.format_name ?? "").trim().slice(0, 200);
    formatDescription = String(body.format_description ?? "").trim().slice(0, 500);
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  if (!formatName) return json({ error: "A trend format must be selected." }, 400);
  if (!pieceId && !concept) return json({ error: "A concept or content piece is required." }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } }
  );

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) return json({ error: "Not authenticated." }, 401);

  const { data: profile } = await supabase
    .from("profiles")
    .select("account_id")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (!profile?.account_id) return json({ error: "No account found for this user." }, 403);
  const accountId = profile.account_id;

  try {
    // Load the piece when one is referenced, so the rewrite matches its
    // existing format and the result can be saved back in place.
    let piece: Record<string, unknown> | null = null;
    let type = "caption";
    let platform = "Instagram";
    let pillar = "";

    if (pieceId) {
      const { data, error: loadError } = await supabase
        .from("content_pieces")
        .select(
          "id, type, platform, title, body, status, pillar, trend_format, original_concept, created_at"
        )
        .eq("id", pieceId)
        .maybeSingle();
      if (loadError) throw new Error(loadError.message);
      if (!data) return json({ error: "Content piece not found." }, 404);
      piece = data as Record<string, unknown>;
      type = String(data.type ?? "caption");
      platform = String(data.platform ?? "Instagram");
      pillar = String(data.pillar ?? "");
      // The pre-trend body is the source of truth to reformat. Re-matching an
      // already-matched piece rewrites the ORIGINAL, not the previous trend,
      // so revert always returns to the true pre-match version.
      concept = String(data.original_concept ?? data.body ?? "");
    }

    if (!concept.trim()) return json({ error: "This piece has no content to reformat." }, 422);

    const ctx = await fetchAccountContext(supabase, accountId, KB_SECTIONS, 6000);

    const system =
      `${buildBrandSystemPrompt(ctx)}\n\n## Task\n` +
      `Reformat an existing ${platform} post into a specific trending format.\n\n` +
      `Trend format: ${formatName}\n` +
      (formatDescription ? `Format structure: ${formatDescription}\n` : "") +
      `\n## What to change\n` +
      `Rewrite the hook, the structure, and the pacing so the post reads natively as a ` +
      `"${formatName}" post. Reorder, recut, and re-pace freely — the shape of the post ` +
      `should change substantially.\n\n` +
      `## What must NOT change\n` +
      `The brand's voice, its specific phrases and terminology, and its underlying ` +
      `philosophy and message stay fully intact. Preserve the signature phrases from the ` +
      `business knowledge above verbatim where the original used them — do not paraphrase ` +
      `them into the trend's voice. The point being made must be the same point; only the ` +
      `container changes. Do not invent facts, claims, offers, or outcomes that are not in ` +
      `the original concept or the business knowledge.\n\n` +
      `Respond with ONLY a JSON object — no markdown fences, no preamble. Schema:\n` +
      `${formatSchema(type)}`;

    const userContent =
      (pillar ? `Content pillar: ${pillar}\n` : "") +
      `Original concept to reformat:\n\n${concept}`;

    const raw = await callClaude({ system, userContent, maxTokens: 3000 });
    const out = parseJsonBlock<TrendOutput>(raw);
    const body = renderBody(type, out);
    if (!body.trim()) {
      return json({ error: "Reformatting produced no usable output. Try again." }, 422);
    }

    // Stateless mode — no piece to update, just hand the rewrite back.
    if (!piece) {
      return json({
        content: { type, platform, title: null, body, pillar: pillar || null },
        trend_format: formatName,
        original_concept: concept,
      });
    }

    // Preserve the first pre-trend body only. The title is deliberately left
    // alone: original_concept is the single revert record the schema gives us,
    // so anything it can't restore must not change.
    const update: Record<string, unknown> = {
      body,
      trend_format: formatName,
      original_concept: piece.original_concept ?? piece.body,
    };

    const { data: saved, error: updateError } = await supabase
      .from("content_pieces")
      .update(update)
      .eq("id", pieceId)
      .select(
        "id, type, platform, title, body, status, pillar, trend_format, original_concept, created_at"
      )
      .single();
    if (updateError) throw new Error(updateError.message);

    return json({
      content: saved,
      trend_format: saved.trend_format,
      original_concept: saved.original_concept,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Trend match failed.";
    return json({ error: message }, 500);
  }
});
