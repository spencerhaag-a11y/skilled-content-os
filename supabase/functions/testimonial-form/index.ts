// Edge Function: testimonial-form (PUBLIC — deploy with --no-verify-jwt)
// Module 7 — Shareable client feedback form. No login required for the
// client; the opaque share_link_token is validated server-side and all
// database access uses the service role, since testimonial_responses has
// no client INSERT policy (Section 3 Security Requirements).
//
// Deploy: supabase functions deploy testimonial-form --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";

const MAX_ANSWER_CHARS = 4000;
const MAX_NAME_CHARS = 120;

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

  let action = "";
  let token = "";
  let clientName = "";
  let answers: { question: string; answer: string }[] = [];
  try {
    const body = await req.json();
    action = String(body.action ?? "");
    token = String(body.token ?? "").trim();
    clientName = String(body.client_name ?? "").trim().slice(0, MAX_NAME_CHARS);
    if (Array.isArray(body.answers)) {
      answers = body.answers
        .filter((a: unknown) => a && typeof a === "object")
        .map((a: { question?: unknown; answer?: unknown }) => ({
          question: String(a.question ?? "").slice(0, 500),
          answer: String(a.answer ?? "").slice(0, MAX_ANSWER_CHARS),
        }))
        .slice(0, 12);
    }
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  if (!/^[0-9a-f]{48}$/.test(token)) return json({ error: "Invalid form link." }, 400);

  // Service role — bypasses RLS. The token IS the authorization.
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: form, error: formError } = await admin
    .from("testimonial_forms")
    .select("id, account_id, title, questions_json, is_active")
    .eq("share_link_token", token)
    .maybeSingle();
  if (formError) return json({ error: "Something went wrong. Try again." }, 500);
  if (!form || !form.is_active) return json({ error: "This form link is no longer active." }, 404);

  if (action === "get") {
    // Only the form's public face — never account internals.
    return json({ title: form.title, questions: form.questions_json });
  }

  if (action === "submit") {
    const filled = answers.filter((a) => a.answer.trim().length > 0);
    if (filled.length === 0) return json({ error: "Answer at least one question." }, 400);

    const { error: insertError } = await admin.from("testimonial_responses").insert({
      form_id: form.id,
      account_id: form.account_id,
      client_name: clientName,
      answers_json: filled,
    });
    if (insertError) return json({ error: "Couldn't save your answers. Try again." }, 500);

    // Mirror into the Review Manager so every response is also a taggable
    // testimonial (source: form).
    const rawText = filled.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join("\n\n");
    await admin.from("testimonials").insert({
      account_id: form.account_id,
      client_name: clientName,
      raw_text: rawText,
      source: "form",
    });

    return json({ ok: true });
  }

  return json({ error: "Unknown action." }, 400);
});
