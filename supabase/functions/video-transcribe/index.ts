// Edge Function: video-transcribe
// Module 8 — Video Module. Kicks off transcription for an uploaded video.
// The client uploads to the video-uploads bucket and inserts a video_jobs row;
// this function (RLS-scoped to the caller) signs the file, submits it to
// AssemblyAI with a webhook, and flips the job to 'transcribing'. The
// video-webhook function finishes the job when AssemblyAI calls back.
//
// Deploy: supabase functions deploy video-transcribe
// Secrets: ASSEMBLYAI_API_KEY, ASSEMBLYAI_WEBHOOK_SECRET

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";

const ASSEMBLYAI_API_KEY = Deno.env.get("ASSEMBLYAI_API_KEY") ?? "";
const SIGNED_URL_TTL = 3600; // AssemblyAI must download within this window

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
  if (!ASSEMBLYAI_API_KEY) return json({ error: "ASSEMBLYAI_API_KEY is not configured." }, 500);

  let jobId = "";
  try {
    const body = await req.json();
    jobId = String(body.video_job_id ?? "").trim();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  if (!jobId) return json({ error: "video_job_id is required." }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) return json({ error: "Not authenticated." }, 401);

  // RLS guarantees the caller can only read their own account's job.
  const { data: job, error: jobError } = await supabase
    .from("video_jobs")
    .select("id, file_path, status, webhook_token")
    .eq("id", jobId)
    .maybeSingle();
  if (jobError) return json({ error: jobError.message }, 500);
  if (!job) return json({ error: "Video job not found." }, 404);
  if (job.status === "transcribing") return json({ status: "transcribing" });

  try {
    // Sign the private object so AssemblyAI can fetch it.
    const { data: signed, error: signError } = await supabase.storage
      .from("video-uploads")
      .createSignedUrl(job.file_path, SIGNED_URL_TTL);
    if (signError || !signed?.signedUrl) {
      throw new Error(signError?.message ?? "Could not sign the video file.");
    }

    // The per-job webhook_token (DB-generated) authenticates the callback —
    // no global secret needed. AssemblyAI echoes the full URL back to us.
    // PUBLIC_FUNCTIONS_URL is the functions base (e.g. https://<ref>.functions.supabase.co);
    // fall back to the project URL's /functions/v1 path if it isn't set.
    const functionsBase = Deno.env.get("PUBLIC_FUNCTIONS_URL") ?? `${supabaseUrl}/functions/v1`;
    const webhookUrl = `${functionsBase}/video-webhook?token=${job.webhook_token}`;
    const submitRes = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: {
        authorization: ASSEMBLYAI_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        audio_url: signed.signedUrl,
        punctuate: true,
        format_text: true,
        disfluencies: true, // keep um/uh so the webhook can mark filler words
        webhook_url: webhookUrl,
      }),
    });

    if (!submitRes.ok) {
      const detail = await submitRes.text();
      throw new Error(`AssemblyAI error ${submitRes.status}: ${detail.slice(0, 300)}`);
    }
    const transcript = await submitRes.json();

    const { error: updateError } = await supabase
      .from("video_jobs")
      .update({ status: "transcribing", provider_job_id: transcript.id, error_detail: null })
      .eq("id", jobId);
    if (updateError) throw new Error(updateError.message);

    return json({ status: "transcribing", provider_job_id: transcript.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transcription submit failed.";
    await supabase.from("video_jobs").update({ status: "failed", error_detail: message }).eq("id", jobId);
    return json({ error: message }, 502);
  }
});
