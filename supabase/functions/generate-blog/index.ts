// Edge Function: generate-blog
// Module 5 — Blog Posts. Long-form SEO content with a STREAMING response
// (Section 4, Phase 7). Claude's SSE stream is parsed server-side and the
// raw text deltas are forwarded to the client as a plain text stream.
//
// Deploy: supabase functions deploy generate-blog

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { CLAUDE_MODEL } from "../_shared/claude.ts";
import { fetchAccountContext, buildBrandSystemPrompt } from "../_shared/context.ts";

const KB_SECTIONS = ["services", "faqs", "testimonials", "team-bios"];
const LENGTHS: Record<string, { words: number; maxTokens: number }> = {
  "500": { words: 500, maxTokens: 1600 },
  "1000": { words: 1000, maxTokens: 2600 },
  "1500": { words: 1500, maxTokens: 3600 },
  "2000": { words: 2200, maxTokens: 5000 },
};

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

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY is not configured." }, 500);

  let topic = "";
  let pillar = "";
  let length = "1000";
  let targetKeyword = "";
  try {
    const body = await req.json();
    topic = String(body.topic ?? "").trim().slice(0, 500);
    pillar = String(body.pillar ?? "").trim().slice(0, 200);
    length = String(body.length ?? "1000");
    targetKeyword = String(body.target_keyword ?? "").trim().slice(0, 120);
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  if (!topic && !pillar) return json({ error: "Enter a topic or pick a pillar." }, 400);
  const lengthSpec = LENGTHS[length] ?? LENGTHS["1000"];

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

  const ctx = await fetchAccountContext(supabase, profile.account_id, KB_SECTIONS, 6000);

  const system =
    `${buildBrandSystemPrompt(ctx)}\n\n## Task\n` +
    `Write one SEO-optimized blog post of approximately ${lengthSpec.words} words.\n` +
    `Output format — follow EXACTLY, in this order, no markdown fences:\n` +
    `1. First line: "# " followed by the H1 title.\n` +
    `2. An engaging intro paragraph.\n` +
    `3. Body organized under "## " H2 section headings (and "### " H3s where useful).\n` +
    `4. A conclusion section ending with a clear CTA.\n` +
    `5. Then a line containing only "---META---", followed by one meta description of 150 characters or fewer.\n` +
    `6. Then a line containing only "---KEYWORDS---", followed by a single comma-separated line of the 5-8 keywords/phrases the post targets.\n` +
    (targetKeyword
      ? `Primary target keyword: "${targetKeyword}" — use it in the H1, the intro, at least one H2, and naturally throughout (no stuffing).\n`
      : "");

  const userContent = pillar
    ? `Content pillar: ${pillar}${topic ? `\nSpecific topic: ${topic}` : ""}`
    : `Topic: ${topic}`;

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: lengthSpec.maxTokens,
      stream: true,
      system,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!anthropicRes.ok || !anthropicRes.body) {
    const detail = await anthropicRes.text();
    return json({ error: `Claude API error ${anthropicRes.status}: ${detail.slice(0, 300)}` }, 502);
  }

  const upstream = anthropicRes.body.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    async start(controller) {
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await upstream.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const evt = JSON.parse(payload);
              if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
                controller.enqueue(encoder.encode(evt.delta.text));
              }
              if (evt.type === "error") {
                controller.enqueue(
                  encoder.encode(`\n\n[STREAM ERROR] ${evt.error?.message ?? "unknown"}`)
                );
              }
            } catch {
              // Ignore unparseable keep-alive lines.
            }
          }
        }
      } finally {
        controller.close();
      }
    },
    cancel() {
      void upstream.cancel();
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
});
