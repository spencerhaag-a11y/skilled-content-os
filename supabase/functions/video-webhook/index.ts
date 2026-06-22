// Edge Function: video-webhook  (PUBLIC — verify_jwt = false in config.toml)
// Module 8 — Video Module. AssemblyAI calls this when a transcript finishes.
// It authenticates with a shared secret header (no Supabase JWT is present),
// then writes results with the SERVICE ROLE so it can update any account's
// job row regardless of RLS. It pulls the transcript, SRT/VTT captions, and
// sentence timings from AssemblyAI, derives filler-word and dead-air edit
// markers in code, and asks Claude for the strongest clip moments.
//
// NOTE: Supabase blocks custom secrets prefixed SUPABASE_, so the service role
// key is read from SERVICE_ROLE_KEY (set: supabase secrets set SERVICE_ROLE_KEY=...).
//
// Auth: each video_jobs row carries its own webhook_token (DB-generated).
// video-transcribe puts it in the callback URL as ?token=…; this function
// matches it against the row, so there is no shared global secret to leak.
//
// Deploy: supabase functions deploy video-webhook --no-verify-jwt
// Secrets: ASSEMBLYAI_API_KEY, SERVICE_ROLE_KEY, ANTHROPIC_API_KEY

import { createClient } from "npm:@supabase/supabase-js@2";
import { callClaude, parseJsonBlock } from "../_shared/claude.ts";

const ASSEMBLYAI_API_KEY = Deno.env.get("ASSEMBLYAI_API_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ?? "";

const FILLERS = new Set([
  "um", "uh", "umm", "uhh", "er", "erm", "hmm", "mm", "like", "y'know", "ya know",
]);
const DEAD_AIR_MS = 2500; // gap between words long enough to flag for a cut

interface AaiWord {
  text: string;
  start: number; // ms
  end: number; // ms
}
interface AaiSentence {
  text: string;
  start: number;
  end: number;
}
interface EditMarker {
  kind: "filler" | "dead_air" | "highlight" | "cut";
  label: string;
  start: number; // seconds
  end: number; // seconds
  note: string;
}
interface Clip {
  title: string;
  start: number; // seconds
  end: number; // seconds
  why: string;
}

function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const sec = (ms: number) => Math.round((ms / 1000) * 10) / 10;

async function aaiGet(id: string, suffix = ""): Promise<Response> {
  return fetch(`https://api.assemblyai.com/v2/transcript/${id}${suffix}`, {
    headers: { authorization: ASSEMBLYAI_API_KEY },
  });
}

/** Filler words + long silences, derived deterministically from word timings. */
function deriveCodeMarkers(words: AaiWord[]): EditMarker[] {
  const markers: EditMarker[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const clean = w.text.toLowerCase().replace(/[.,!?]/g, "");
    if (FILLERS.has(clean)) {
      markers.push({
        kind: "filler",
        label: `Filler: "${w.text}"`,
        start: sec(w.start),
        end: sec(w.end),
        note: "Filler word — candidate to cut.",
      });
    }
    if (i > 0) {
      const gap = w.start - words[i - 1].end;
      if (gap >= DEAD_AIR_MS) {
        markers.push({
          kind: "dead_air",
          label: `Dead air ${(gap / 1000).toFixed(1)}s`,
          start: sec(words[i - 1].end),
          end: sec(w.start),
          note: "Long pause — tighten or cut.",
        });
      }
    }
  }
  return markers.slice(0, 60);
}

async function deriveClips(sentences: AaiSentence[]): Promise<{ clips: Clip[]; markers: EditMarker[] }> {
  if (sentences.length === 0) return { clips: [], markers: [] };
  // Compact timeline for the model: "[12.4-15.0] sentence text"
  const timeline = sentences
    .map((s) => `[${sec(s.start)}-${sec(s.end)}] ${s.text}`)
    .join("\n")
    .slice(0, 14_000);

  const system =
    "You are a short-form video editor reviewing a transcript with timestamps (seconds). " +
    "Identify the strongest standalone moments to clip and a few quality edit notes. " +
    "Respond with ONLY a JSON object — no markdown fences. Schema: " +
    `{ "clips": [ { "title": string, "start": number, "end": number, "why": string } ] (3-5 clips, each 15-60s, using real timestamps from the timeline), ` +
    `"markers": [ { "kind": "highlight" | "cut", "label": string, "start": number, "end": number, "note": string } ] (3-8 notes: highlights to keep, weak takes to cut) }`;

  const raw = await callClaude({ system, userContent: `Transcript timeline:\n${timeline}`, maxTokens: 1500 });
  const parsed = parseJsonBlock<{ clips?: Clip[]; markers?: EditMarker[] }>(raw);

  const clips = Array.isArray(parsed.clips)
    ? parsed.clips
        .filter((c) => c && typeof c.start === "number" && typeof c.end === "number" && c.end > c.start)
        .slice(0, 5)
        .map((c) => ({
          title: String(c.title ?? "Clip").slice(0, 120),
          start: c.start,
          end: c.end,
          why: String(c.why ?? ""),
        }))
    : [];
  const markers = Array.isArray(parsed.markers)
    ? parsed.markers
        .filter((m) => m && (m.kind === "highlight" || m.kind === "cut"))
        .slice(0, 10)
        .map((m) => ({
          kind: m.kind,
          label: String(m.label ?? "").slice(0, 80),
          start: typeof m.start === "number" ? m.start : 0,
          end: typeof m.end === "number" ? m.end : 0,
          note: String(m.note ?? ""),
        }))
    : [];
  return { clips, markers };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return ok({ error: "Method not allowed" }, 405);
  if (!SERVICE_ROLE_KEY || !ASSEMBLYAI_API_KEY) {
    return ok({ error: "Function is not fully configured." }, 500);
  }

  const token = new URL(req.url).searchParams.get("token") ?? "";

  let transcriptId = "";
  let aaiStatus = "";
  try {
    const body = await req.json();
    transcriptId = String(body.transcript_id ?? "").trim();
    aaiStatus = String(body.status ?? "").trim();
  } catch {
    return ok({ error: "Invalid JSON body." }, 400);
  }
  if (!transcriptId) return ok({ error: "transcript_id missing." }, 400);

  // Service role bypasses RLS — required: the webhook has no user session.
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: job } = await admin
    .from("video_jobs")
    .select("id, webhook_token")
    .eq("provider_job_id", transcriptId)
    .maybeSingle();
  if (!job) return ok({ received: true, note: "No matching job." }); // ack so AssemblyAI stops retrying

  // Authenticate against this job's own token (set when transcription started).
  if (!token || token !== job.webhook_token) return ok({ error: "Unauthorized" }, 401);

  if (aaiStatus === "error") {
    await admin
      .from("video_jobs")
      .update({ status: "failed", error_detail: "AssemblyAI reported a transcription error." })
      .eq("id", job.id);
    return ok({ received: true });
  }

  try {
    const [tRes, srtRes, vttRes, sentRes] = await Promise.all([
      aaiGet(transcriptId),
      aaiGet(transcriptId, "/srt"),
      aaiGet(transcriptId, "/vtt"),
      aaiGet(transcriptId, "/sentences"),
    ]);
    if (!tRes.ok) throw new Error(`AssemblyAI transcript fetch ${tRes.status}`);

    const transcript = await tRes.json();
    const words: AaiWord[] = Array.isArray(transcript.words) ? transcript.words : [];
    const srt = srtRes.ok ? await srtRes.text() : "";
    const vtt = vttRes.ok ? await vttRes.text() : "";
    const sentences: AaiSentence[] = sentRes.ok ? (await sentRes.json()).sentences ?? [] : [];

    const codeMarkers = deriveCodeMarkers(words);
    let clips: Clip[] = [];
    let aiMarkers: EditMarker[] = [];
    try {
      const derived = await deriveClips(sentences);
      clips = derived.clips;
      aiMarkers = derived.markers;
    } catch {
      // Captions + transcript still ship even if the clip pass fails.
    }

    const { error: updateError } = await admin
      .from("video_jobs")
      .update({
        status: "done",
        transcript: transcript.text ?? "",
        transcript_json: { words },
        srt,
        vtt,
        edit_markers: [...aiMarkers, ...codeMarkers],
        clip_suggestions: clips,
        duration_seconds: transcript.audio_duration ?? null,
        error_detail: null,
      })
      .eq("id", job.id);
    if (updateError) throw new Error(updateError.message);

    return ok({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Webhook processing failed.";
    await admin.from("video_jobs").update({ status: "failed", error_detail: message }).eq("id", job.id);
    return ok({ received: true, error: message });
  }
});
