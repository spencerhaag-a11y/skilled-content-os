// Edge Function: social-listener
// Module 17 — Social Listener. Produces a brand-voice and content-style report
// for a social account.
//
// Engineering decision (Section 4 license to decide): Instagram, TikTok, and
// LinkedIn all gate post data behind authenticated platform APIs that v1.0
// does not integrate, so this function does NOT scrape. It analyzes the
// handle plus any recent captions the user pastes in. When sample text is
// provided the report is grounded in real posts; without it, the report is a
// best-effort baseline the user is told to refine. Results save to scan_history.
//
// Deploy: supabase functions deploy social-listener

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { callClaude, parseJsonBlock } from "../_shared/claude.ts";

const PLATFORMS = ["Instagram", "TikTok", "LinkedIn"];
const MAX_SAMPLE_CHARS = 8_000;

interface ListenerResults {
  voice_summary: string;
  style_report: {
    tone: string;
    formats: string[];
    caption_structure: string;
    hashtag_strategy: string;
    posting_frequency: string;
  };
  opportunities: string[];
  grounded: boolean;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SCHEMA = `Respond with ONLY a JSON object — no markdown fences, no preamble. Schema:
{
  "voice_summary": string (2-4 sentences describing the brand voice this account projects),
  "style_report": {
    "tone": string,
    "formats": string[] (post formats they lean on: reels, carousels, talking-head, quote cards, etc.),
    "caption_structure": string (how captions are built: hook, length, CTA habits),
    "hashtag_strategy": string,
    "posting_frequency": string (estimate; say "unknown without post data" if you cannot tell)
  },
  "opportunities": string[] (4-7 specific content gaps or angles a competing/own brand could own)
}`;

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightIfNeeded(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let handle = "";
  let platform = "Instagram";
  let mode = "own";
  let samplePosts = "";
  try {
    const body = await req.json();
    handle = String(body.handle ?? "").trim();
    platform = String(body.platform ?? "Instagram").trim();
    mode = String(body.mode ?? "own").trim();
    samplePosts = String(body.sample_posts ?? "").trim().slice(0, MAX_SAMPLE_CHARS);
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  if (!handle) return json({ error: "Enter a handle or profile URL." }, 400);
  if (!PLATFORMS.includes(platform)) return json({ error: "Unsupported platform." }, 400);
  if (mode !== "own" && mode !== "competitor") mode = "own";

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

  const grounded = samplePosts.length > 0;
  try {
    const system =
      `You analyze a ${platform} account's content style for a marketing platform and return strict JSON. ` +
      (grounded
        ? "Base the analysis on the sample captions provided. "
        : "No post samples were provided, so infer a careful best-effort baseline from the handle and note uncertainty in posting_frequency. ") +
      `This is a ${mode === "own" ? "first-party (own brand baseline)" : "competitor"} analysis. ` +
      SCHEMA;

    const userContent =
      `Platform: ${platform}\nHandle: ${handle}\nAnalysis mode: ${mode}\n\n` +
      (grounded ? `Recent captions / sample posts:\n${samplePosts}` : "No sample posts supplied.");

    const raw = await callClaude({ system, userContent, maxTokens: 1400 });
    const parsed = parseJsonBlock<ListenerResults>(raw);

    const norm: ListenerResults = {
      voice_summary: parsed.voice_summary ?? "",
      style_report: {
        tone: parsed.style_report?.tone ?? "",
        formats: Array.isArray(parsed.style_report?.formats) ? parsed.style_report!.formats.slice(0, 12) : [],
        caption_structure: parsed.style_report?.caption_structure ?? "",
        hashtag_strategy: parsed.style_report?.hashtag_strategy ?? "",
        posting_frequency: parsed.style_report?.posting_frequency ?? "",
      },
      opportunities: Array.isArray(parsed.opportunities) ? parsed.opportunities.slice(0, 10) : [],
      grounded,
    };

    const { data: scan, error: insertError } = await supabase
      .from("scan_history")
      .insert({
        account_id: accountId,
        created_by: userId,
        url: handle,
        platform,
        scan_type: "social",
        results_json: norm,
      })
      .select("id, url, platform, scan_type, results_json, created_at")
      .single();
    if (insertError) throw new Error(insertError.message);

    return json({ scan });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis failed.";
    return json({ error: message }, 422);
  }
});
