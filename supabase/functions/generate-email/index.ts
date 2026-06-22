// Edge Function: generate-email
// Module 6 — Email Marketing. Two modes:
//   single   → one email + 5 subject line options (subject generator)
//   sequence → multi-email drip campaign (sequence builder)
// All outputs saved as Drafts. GHL campaign push wires in at Phase 15.
//
// Deploy: supabase functions deploy generate-email

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { callClaude, parseJsonBlock } from "../_shared/claude.ts";
import { fetchAccountContext, buildBrandSystemPrompt } from "../_shared/context.ts";

const SINGLE_TYPES = ["newsletter", "promotional_offer", "client_follow_up", "re_engagement"];
const SEQUENCE_TYPES = ["welcome_sequence", "nurture", "re_engagement"];
const KB_SECTIONS = ["services", "pricing", "promotions", "faqs", "events", "testimonials"];

interface SingleOutput {
  title?: string;
  subjects?: string[];
  body?: string;
}

interface SequenceOutput {
  sequence_title?: string;
  emails?: { day: number; title: string; subject: string; body: string }[];
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

  let mode = "";
  let emailType = "";
  let pillar = "";
  let topic = "";
  let details = "";
  let count = 5;
  try {
    const body = await req.json();
    mode = String(body.mode ?? "single");
    emailType = String(body.email_type ?? "").trim();
    pillar = String(body.pillar ?? "").trim().slice(0, 200);
    topic = String(body.topic ?? "").trim().slice(0, 500);
    details = String(body.details ?? "").trim().slice(0, 3000);
    count = Math.min(7, Math.max(3, Number(body.count ?? 5) || 5));
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  if (mode === "single" && !SINGLE_TYPES.includes(emailType)) {
    return json({ error: "Invalid email type." }, 400);
  }
  if (mode === "sequence" && !SEQUENCE_TYPES.includes(emailType)) {
    return json({ error: "Invalid sequence type." }, 400);
  }
  if (!pillar && !topic && !details) {
    return json({ error: "Give the email a topic, pillar, or offer details." }, 400);
  }

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
    const brandPrompt = buildBrandSystemPrompt(ctx);

    const inputBlock =
      (pillar ? `Content pillar: ${pillar}\n` : "") +
      (topic ? `Topic/angle: ${topic}\n` : "") +
      (details ? `Offer/context details (authoritative):\n${details}\n` : "");

    if (mode === "single") {
      const system =
        `${brandPrompt}\n\n## Task\n` +
        `Write one ${emailType.replace(/_/g, " ")} email. Plain text with short paragraphs, ` +
        `a single clear CTA, and a sign-off matching the brand. No subject inside the body.\n` +
        `Also produce exactly 5 subject line options in different styles ` +
        `(curiosity, benefit-led, direct, urgency, personal).\n` +
        `Respond with ONLY a JSON object — no fences, no preamble. Schema:\n` +
        `{"title": string (short internal label), "subjects": [string, string, string, string, string], "body": string}`;

      const raw = await callClaude({ system, userContent: inputBlock || "Write it.", maxTokens: 2200 });
      const out = parseJsonBlock<SingleOutput>(raw);
      const subjects = (out.subjects ?? []).filter((s) => typeof s === "string").slice(0, 5);
      if (!out.body || subjects.length === 0) {
        return json({ error: "Generation produced no usable output. Try again." }, 422);
      }

      const { data: piece, error: insertError } = await supabase
        .from("content_pieces")
        .insert({
          account_id: accountId,
          created_by: userId,
          type: "email",
          platform: "Email",
          title: out.title || `${emailType.replace(/_/g, " ")} email`,
          body: `Subject: ${subjects[0]}\n\n${out.body}`,
          status: "draft",
          pillar: pillar || null,
        })
        .select("id, type, platform, title, body, status, pillar, created_at")
        .single();
      if (insertError) throw new Error(insertError.message);

      return json({ mode: "single", piece, subjects, raw_body: out.body });
    }

    // ── Sequence mode ──
    const system =
      `${brandPrompt}\n\n## Task\n` +
      `Build a ${count}-email ${emailType.replace(/_/g, " ")} drip campaign. ` +
      `Each email: plain text, short paragraphs, one CTA, and a day offset from sequence start ` +
      `(email 1 = day 0; space the rest sensibly). The emails must build on each other — ` +
      `no repetition, a clear arc from first touch to final CTA.\n` +
      `Respond with ONLY a JSON object — no fences, no preamble. Schema:\n` +
      `{"sequence_title": string, "emails": [{"day": number, "title": string (short internal label), "subject": string, "body": string}] (exactly ${count} items, ordered by day)}`;

    const raw = await callClaude({ system, userContent: inputBlock || "Build it.", maxTokens: 7000 });
    const out = parseJsonBlock<SequenceOutput>(raw);
    const emails = (out.emails ?? []).filter((e) => e?.body && e?.subject).slice(0, count);
    if (emails.length === 0) {
      return json({ error: "Generation produced no usable output. Try again." }, 422);
    }

    const seqTitle = out.sequence_title || `${emailType.replace(/_/g, " ")} sequence`;
    const rows = emails.map((e, i) => ({
      account_id: accountId,
      created_by: userId,
      type: "email",
      platform: "Email",
      title: `${seqTitle} — ${i + 1}/${emails.length} (day ${e.day ?? i * 2}): ${e.title ?? ""}`.trim(),
      body: `Subject: ${e.subject}\n\n${e.body}`,
      status: "draft",
      pillar: pillar || null,
    }));

    const { data: pieces, error: insertError } = await supabase
      .from("content_pieces")
      .insert(rows)
      .select("id, type, platform, title, body, status, pillar, created_at");
    if (insertError) throw new Error(insertError.message);

    return json({ mode: "sequence", sequence_title: seqTitle, pieces });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed.";
    return json({ error: message }, 500);
  }
});
