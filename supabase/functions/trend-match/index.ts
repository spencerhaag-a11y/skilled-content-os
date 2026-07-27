// Edge Function: trend-match
// Trending Format Matching — step 1 (options). Searches for currently trending
// short-form post FORMATS on the target platform and returns exactly 3 named
// options. Does not reformat anything and does not auto-select: the user picks
// one, and trend-match-apply does the rewrite.
//
// Deploy: supabase functions deploy trend-match

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { callClaudeWithWebSearch, parseJsonBlock } from "../_shared/claude.ts";

// The spec names instagram | tiktok; the board carries pieces on every platform
// the app supports, so all five are accepted and normalised to a display label.
const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  x: "X",
};

interface TrendOption {
  format_name: string;
  description: string;
  why_trending: string;
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

  let concept = "";
  let platformInput = "";
  let pillar = "";
  try {
    const body = await req.json();
    concept = String(body.concept ?? "").trim().slice(0, 4000);
    platformInput = String(body.platform ?? "").trim();
    pillar = String(body.pillar ?? "").trim().slice(0, 200);
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  if (!concept) return json({ error: "A post concept is required." }, 400);

  const platform = PLATFORM_LABELS[platformInput.toLowerCase()] ?? "Instagram";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } }
  );

  // account_id is accepted in the request body per the spec but never trusted —
  // the authoritative account comes from the caller's profile, as in every
  // other generation function.
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) return json({ error: "Not authenticated." }, 401);

  const { data: profile } = await supabase
    .from("profiles")
    .select("account_id")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (!profile?.account_id) return json({ error: "No account found for this user." }, 403);

  const now = new Date();
  const month = now.toLocaleString("en-US", { month: "long" });
  const year = now.getFullYear();

  try {
    const system =
      `You are a short-form content strategist researching what post FORMATS are trending right now on ${platform}.\n\n` +
      `## What a format is\n` +
      `A format is a STRUCTURAL template — the shape of the post, not its subject. ` +
      `Examples of the right kind of answer: "day in the life", "things I wish I knew", ` +
      `"POV: you just realized...", "documentary-style narration", "unpopular opinion", ` +
      `"green flag / red flag list", "if this was a Netflix documentary...". ` +
      `A topic ("ankle mobility", "youth sports injuries") is NOT a format. ` +
      `The three options you return must be structurally different from each other — ` +
      `not three variations on the same shape and not three angles on the same topic.\n\n` +
      `## Research\n` +
      `Run EXACTLY these two web searches, then stop searching:\n` +
      `1. "${platform.toLowerCase()} trending post format ${month} ${year}"\n` +
      `2. "${platform.toLowerCase()} viral content structure examples"\n` +
      `Do not run follow-up searches, do not fetch pages, and do not search again to ` +
      `verify — two searches is the whole research budget. Synthesise what those two ` +
      `searches return into exactly 3 named format options, and answer immediately after ` +
      `the second one. Prefer formats you saw evidence of in the results, and say ` +
      `concretely why each is working right now. If search returns nothing usable, still ` +
      `return 3 well-founded options and be honest in why_trending about the basis.\n\n` +
      `## Output\n` +
      `Respond with ONLY a JSON object — no markdown fences, no preamble. Schema:\n` +
      `{"options": [{"format_name": string (short, human-readable, e.g. "If This Was a Netflix Documentary"), ` +
      `"description": string (ONE line: how a post in this format is structured), ` +
      `"why_trending": string (one or two sentences on why it is working on ${platform} right now)}]}\n` +
      `Exactly 3 options.`;

    const userContent =
      `Platform: ${platform}\n` +
      (pillar ? `Content pillar: ${pillar}\n` : "") +
      `Post concept to be reformatted later:\n${concept}\n\n` +
      `Find 3 currently trending ${platform} post formats this concept could be reshaped into.`;

    const raw = await callClaudeWithWebSearch({
      system,
      userContent,
      maxTokens: 2000,
      maxSearches: 2,
    });

    const parsed = parseJsonBlock<{ options?: TrendOption[] }>(raw);
    const options = (parsed.options ?? [])
      .filter((o) => o && o.format_name)
      .slice(0, 3)
      .map((o) => ({
        format_name: String(o.format_name).trim(),
        description: String(o.description ?? "").trim(),
        why_trending: String(o.why_trending ?? "").trim(),
      }));

    if (options.length === 0) {
      return json({ error: "No trend formats came back. Try again." }, 422);
    }

    return json({ options });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Trend search failed.";
    return json({ error: message }, 500);
  }
});
