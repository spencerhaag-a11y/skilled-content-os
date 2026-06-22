// Edge Function: repurpose
// Module 3 — Content Repurposing Engine. One input → full multi-format
// content suite in a single Claude call, all saved simultaneously as Drafts.
//
// Deploy: supabase functions deploy repurpose

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { callClaude, parseJsonBlock } from "../_shared/claude.ts";
import { fetchAccountContext, buildBrandSystemPrompt } from "../_shared/context.ts";

const INPUT_TYPES = ["blog_post", "video_transcript", "audio_brain_dump", "raw_notes", "social_post"];
const MAX_INPUT_CHARS = 24_000;
const KB_SECTIONS = ["services", "promotions", "testimonials", "faqs"];

interface SuiteOutput {
  pillar?: string;
  captions?: { style: string; title: string; body: string }[];
  linkedin_post?: { title: string; body: string };
  email_newsletter?: { title: string; subject: string; body: string };
  blog_expansion?: { title: string; body: string } | null;
  reel_script?: { title: string; body: string };
  carousel?: { title: string; slides: string[] };
  story_frames?: { image_idea: string; overlay_text: string }[];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const OUTPUT_SCHEMA = `Respond with ONLY a JSON object — no markdown fences, no preamble. Schema:
{
  "pillar": string (the single best-fit content pillar from the brand's pillar list; if none fit, a short topic label),
  "captions": [ { "style": "educational" | "story" | "hook" | "list" | "quote", "title": string (short internal label), "body": string (complete Instagram/TikTok caption incl. hook, body, CTA, 3-5 hashtags) } ] (exactly 5, one per style),
  "linkedin_post": { "title": string, "body": string (longer, professional tone, no hashtag wall) },
  "email_newsletter": { "title": string (internal label), "subject": string, "body": string (complete newsletter email) },
  "blog_expansion": { "title": string (H1), "body": string (markdown with H2 sections, 800+ words) } — include ONLY if the input is short-form; otherwise null,
  "reel_script": { "title": string, "body": string (15-45s short-form video script with [HOOK]/[BODY]/[CTA] markers and spoken lines) },
  "carousel": { "title": string, "slides": [string] (first = title slide copy, then 5-7 content slides, last = CTA slide; each slide ≤ 30 words) },
  "story_frames": [ { "image_idea": string, "overlay_text": string } ] (exactly 3)
}`;

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightIfNeeded(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let inputText = "";
  let inputType = "";
  let pillarOverride = "";
  try {
    const body = await req.json();
    inputText = String(body.input_text ?? "").trim();
    inputType = String(body.input_type ?? "").trim();
    pillarOverride = String(body.pillar ?? "").trim();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  if (!INPUT_TYPES.includes(inputType)) return json({ error: "Invalid input_type." }, 400);
  if (inputText.length < 50) return json({ error: "Input is too short to repurpose (50+ characters)." }, 400);
  inputText = inputText.slice(0, MAX_INPUT_CHARS);

  // Caller-scoped client — RLS applies to every read and write below.
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
    const ctx = await fetchAccountContext(supabase, accountId, KB_SECTIONS, 6000);
    const system = `${buildBrandSystemPrompt(ctx)}\n\n## Task\nYou will receive one piece of source content. Repurpose it into a complete multi-platform content suite. Every output must stand alone and stay true to the source material's substance.\n\n${OUTPUT_SCHEMA}`;

    const isShortForm = inputText.length < 1500 || inputType === "social_post" || inputType === "raw_notes";
    const userContent =
      `Source content type: ${inputType.replace(/_/g, " ")}\n` +
      `Treat as short-form input (include blog_expansion): ${isShortForm}\n` +
      (pillarOverride ? `Use this content pillar: ${pillarOverride}\n` : "") +
      `\nSource content:\n${inputText}`;

    const raw = await callClaude({ system, userContent, maxTokens: 8000 });
    const suite = parseJsonBlock<SuiteOutput>(raw);

    const pillar = pillarOverride || suite.pillar || null;
    const rows: Record<string, unknown>[] = [];
    const base = { account_id: accountId, created_by: userId, status: "draft", pillar };

    for (const c of (suite.captions ?? []).slice(0, 5)) {
      if (!c?.body) continue;
      rows.push({
        ...base,
        type: "caption",
        platform: "Instagram",
        title: c.title || `${c.style} caption`,
        body: c.body,
      });
    }
    if (suite.linkedin_post?.body) {
      rows.push({ ...base, type: "linkedin_post", platform: "LinkedIn", title: suite.linkedin_post.title || "LinkedIn post", body: suite.linkedin_post.body });
    }
    if (suite.email_newsletter?.body) {
      rows.push({
        ...base,
        type: "email",
        platform: "Email",
        title: suite.email_newsletter.title || "Newsletter",
        body: `Subject: ${suite.email_newsletter.subject ?? ""}\n\n${suite.email_newsletter.body}`,
      });
    }
    if (suite.blog_expansion?.body) {
      rows.push({ ...base, type: "blog", platform: "Blog", title: suite.blog_expansion.title || "Blog post", body: suite.blog_expansion.body });
    }
    if (suite.reel_script?.body) {
      rows.push({ ...base, type: "reel_script", platform: "Instagram", title: suite.reel_script.title || "Reel script", body: suite.reel_script.body });
    }
    if (suite.carousel?.slides?.length) {
      const slides = suite.carousel.slides
        .map((s, i, arr) => {
          const label = i === 0 ? "TITLE SLIDE" : i === arr.length - 1 ? "CTA SLIDE" : `SLIDE ${i + 1}`;
          return `[${label}]\n${s}`;
        })
        .join("\n\n");
      rows.push({ ...base, type: "carousel", platform: "Instagram", title: suite.carousel.title || "Carousel", body: slides });
    }
    if (suite.story_frames?.length) {
      const frames = suite.story_frames
        .slice(0, 3)
        .map((f, i) => `[FRAME ${i + 1}]\nImage: ${f.image_idea}\nOverlay: ${f.overlay_text}`)
        .join("\n\n");
      rows.push({ ...base, type: "story_frames", platform: "Instagram", title: "Story frames", body: frames });
    }

    if (rows.length === 0) return json({ error: "Generation produced no usable outputs. Try again." }, 422);

    // Single batch insert — the whole suite lands atomically (Module 3).
    const { data: inserted, error: insertError } = await supabase
      .from("content_pieces")
      .insert(rows)
      .select("id, type, platform, title, body, status, pillar, created_at");
    if (insertError) throw new Error(insertError.message);

    return json({ pillar, pieces: inserted });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Repurposing failed.";
    return json({ error: message }, 500);
  }
});
