// Edge Function: brainstorm (STREAMING)
// Module 12 — AI Brainstorm Chat. "Like a custom GPT that knows your entire
// business": brand kit + knowledge base injected as system context on every
// turn. Three modes: chat, multi_format (3-5 pieces per prompt), brain_dump.
//
// Deploy: supabase functions deploy brainstorm

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { CLAUDE_MODEL } from "../_shared/claude.ts";
import { fetchAccountContext, buildBrandSystemPrompt } from "../_shared/context.ts";

const KB_SECTIONS = [
  "services", "pricing", "promotions", "faqs",
  "events", "team-bios", "testimonials", "offer-sheets",
];
const MAX_TURNS = 20;
const MAX_MSG_CHARS = 12_000;

const PIECE_MARKER_SPEC =
  `When you produce a finished, saveable content piece (a caption, post, email, script, etc.), ` +
  `wrap EACH piece exactly like this so the platform can offer one-click saving:\n` +
  `===PIECE: {type} | {platform} | {short title}===\n{the complete piece}\n===END===\n` +
  `Valid types: caption, linkedin_post, email, blog, reel_script, carousel, story_frames, thread, sms. ` +
  `Valid platforms: Instagram, TikTok, LinkedIn, Facebook, X, Email, Blog. ` +
  `Conversation, ideas, and analysis stay OUTSIDE the markers.`;

const MODE_INSTRUCTIONS: Record<string, string> = {
  chat:
    "You are the brand's creative partner. Brainstorm, refine, and draft content " +
    "conversationally. Be direct and concrete — give angles and hooks, not generic advice.",
  multi_format:
    "MULTI-FORMAT MODE: For every user prompt, respond with 3 to 5 distinct finished content " +
    "pieces in clearly different styles or formats (e.g. an educational caption, a story-driven " +
    "post, a hook-led reel script, a thread). Wrap every piece in PIECE markers. Add at most " +
    "two sentences of commentary outside the markers.",
  brain_dump:
    "BRAIN DUMP MODE: The user will paste raw notes or a transcript. First, structure it: list " +
    "the strongest content ideas you can mine from it (one line each, with the angle). Then draft " +
    "the top 2-3 ideas as finished pieces wrapped in PIECE markers.",
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

  let mode = "chat";
  let messages: { role: string; content: string }[] = [];
  try {
    const body = await req.json();
    mode = ["chat", "multi_format", "brain_dump"].includes(String(body.mode))
      ? String(body.mode)
      : "chat";
    if (Array.isArray(body.messages)) {
      messages = body.messages
        .filter(
          (m: unknown): m is { role: string; content: string } =>
            !!m &&
            typeof m === "object" &&
            ["user", "assistant"].includes((m as { role?: string }).role ?? "") &&
            typeof (m as { content?: unknown }).content === "string"
        )
        .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MSG_CHARS) }))
        .slice(-MAX_TURNS);
    }
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return json({ error: "Send at least one user message." }, 400);
  }

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

  const ctx = await fetchAccountContext(supabase, profile.account_id, KB_SECTIONS, 8000);
  const system =
    `${buildBrandSystemPrompt(ctx)}\n\n## Mode\n${MODE_INSTRUCTIONS[mode]}\n\n## Output markers\n${PIECE_MARKER_SPEC}`;

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      stream: true,
      system,
      messages,
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
            } catch {
              /* keep-alive noise */
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
    headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
  });
});
