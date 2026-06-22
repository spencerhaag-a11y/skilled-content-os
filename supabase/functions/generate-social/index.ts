// Edge Function: generate-social
// Module 4 — Social Posts. Platform-specific generation using brand kit +
// knowledge base context. Output saved immediately as a Draft.
//
// Deploy: supabase functions deploy generate-social

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { callClaude, parseJsonBlock } from "../_shared/claude.ts";
import { fetchAccountContext, buildBrandSystemPrompt } from "../_shared/context.ts";

const PLATFORMS = ["Instagram", "TikTok", "LinkedIn", "Facebook", "X"];
const FORMATS = ["caption", "reel_script", "carousel", "story_frames", "thread"];
const KB_SECTIONS = ["services", "promotions", "testimonials", "faqs", "events"];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function formatSchema(format: string): string {
  switch (format) {
    case "caption":
      return `{"title": string (short internal label), "body": string (complete single-image caption: scroll-stopping hook line, value-driven body, clear CTA, then 3-5 relevant hashtags)}`;
    case "reel_script":
      return `{"title": string, "body": string (15-45 second short-form video script with [HOOK], [BODY], [CTA] markers, spoken lines plus brief on-screen text cues)}`;
    case "carousel":
      return `{"title": string, "slides": [string] (first = title slide copy, then 5-7 content slides, last = CTA slide; each ≤ 30 words)}`;
    case "story_frames":
      return `{"title": string, "frames": [{"image_idea": string, "overlay_text": string}] (exactly 3 story frames)}`;
    case "thread":
      return `{"title": string, "posts": [string] (5-8 posts; post 1 is the hook, the last is the CTA; each post ≤ 280 characters)}`;
    default:
      return "";
  }
}

interface SocialOutput {
  title?: string;
  body?: string;
  slides?: string[];
  frames?: { image_idea: string; overlay_text: string }[];
  posts?: string[];
}

function renderBody(format: string, out: SocialOutput): string {
  if (format === "carousel" && out.slides?.length) {
    return out.slides
      .map((s, i, arr) => {
        const label = i === 0 ? "TITLE SLIDE" : i === arr.length - 1 ? "CTA SLIDE" : `SLIDE ${i + 1}`;
        return `[${label}]\n${s}`;
      })
      .join("\n\n");
  }
  if (format === "story_frames" && out.frames?.length) {
    return out.frames
      .slice(0, 3)
      .map((f, i) => `[FRAME ${i + 1}]\nImage: ${f.image_idea}\nOverlay: ${f.overlay_text}`)
      .join("\n\n");
  }
  if (format === "thread" && out.posts?.length) {
    return out.posts.map((p, i) => `${i + 1}/ ${p}`).join("\n\n");
  }
  return out.body ?? "";
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightIfNeeded(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let platform = "";
  let format = "";
  let pillar = "";
  let topic = "";
  let tone = "";
  try {
    const body = await req.json();
    platform = String(body.platform ?? "").trim();
    format = String(body.format ?? "").trim();
    pillar = String(body.pillar ?? "").trim();
    topic = String(body.topic ?? "").trim().slice(0, 500);
    tone = String(body.tone ?? "").trim().slice(0, 200);
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  if (!PLATFORMS.includes(platform)) return json({ error: "Invalid platform." }, 400);
  if (!FORMATS.includes(format)) return json({ error: "Invalid format." }, 400);
  if (!pillar && !topic) return json({ error: "Pick a content pillar or enter a topic." }, 400);

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
    const system =
      `${buildBrandSystemPrompt(ctx)}\n\n## Task\n` +
      `Write one ${format.replace(/_/g, " ")} for ${platform}. ` +
      `Match the platform's native conventions and length norms. ` +
      `Structure: clear hook, valuable body, direct CTA.` +
      (tone ? ` Tone override for this piece (takes precedence over default voice): ${tone}.` : "") +
      `\n\nRespond with ONLY a JSON object — no markdown fences, no preamble. Schema:\n${formatSchema(format)}`;

    const userContent = pillar
      ? `Content pillar: ${pillar}${topic ? `\nSpecific angle: ${topic}` : ""}`
      : `Topic: ${topic}`;

    const raw = await callClaude({ system, userContent, maxTokens: 2500 });
    const out = parseJsonBlock<SocialOutput>(raw);
    const body = renderBody(format, out);
    if (!body.trim()) return json({ error: "Generation produced no usable output. Try again." }, 422);

    const { data: piece, error: insertError } = await supabase
      .from("content_pieces")
      .insert({
        account_id: accountId,
        created_by: userId,
        type: format,
        platform,
        title: out.title || `${platform} ${format.replace(/_/g, " ")}`,
        body,
        status: "draft",
        pillar: pillar || null,
      })
      .select("id, type, platform, title, body, status, pillar, created_at")
      .single();
    if (insertError) throw new Error(insertError.message);

    return json({ piece });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed.";
    return json({ error: message }, 500);
  }
});
