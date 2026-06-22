// Edge Function: ghl-push
// Module 19 / Section 6 — One-way content push with a destination-type
// adapter pattern. Destination derives from content type (Section 6 mapping)
// unless explicitly overridden. Every attempt is logged to ghl_push_log.
//
// Deploy: supabase functions deploy ghl-push

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

interface Piece {
  id: string;
  account_id: string;
  type: string;
  platform: string | null;
  title: string;
  body: string;
  status: string;
}

interface PushResult {
  ghlItemId: string | null;
  url: string | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Section 6 mapping: content type → push destination.
function destinationForType(type: string): string {
  switch (type) {
    case "email":
      return "email_builder";
    case "blog":
      return "blog";
    case "sms":
      return "workflow_sms";
    case "reel_script":
    case "caption":
    case "carousel":
    case "story_frames":
    case "thread":
    case "linkedin_post":
    case "testimonial_block":
    case "gbp_post":
    default:
      return "social_planner";
  }
}

function ghlHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    Version: GHL_VERSION,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function ghlError(res: Response): Promise<string> {
  const detail = await res.text();
  return `GHL API ${res.status}: ${detail.slice(0, 400)}`;
}

function splitSubject(body: string): { subject: string; rest: string } {
  const m = body.match(/^Subject:\s*(.*)\n\n([\s\S]*)$/);
  return m ? { subject: m[1], rest: m[2] } : { subject: "", rest: body };
}

function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
}

// ── Adapters: each formats content to GHL field requirements ────────────────

async function pushSocial(apiKey: string, locationId: string, piece: Piece): Promise<PushResult> {
  const res = await fetch(
    `${GHL_BASE}/social-media-posting/${encodeURIComponent(locationId)}/posts`,
    {
      method: "POST",
      headers: ghlHeaders(apiKey),
      body: JSON.stringify({
        type: "post",
        status: "draft",
        summary: piece.body.slice(0, 5000),
        accountIds: [],
      }),
    }
  );
  if (!res.ok) throw new Error(await ghlError(res));
  const data = await res.json();
  const id = data?.post?.id ?? data?.id ?? null;
  return {
    ghlItemId: id,
    url: `https://app.gohighlevel.com/v2/location/${locationId}/marketing/social-planner`,
  };
}

async function pushEmail(apiKey: string, locationId: string, piece: Piece): Promise<PushResult> {
  const { subject, rest } = splitSubject(piece.body);
  const res = await fetch(`${GHL_BASE}/emails/builder`, {
    method: "POST",
    headers: ghlHeaders(apiKey),
    body: JSON.stringify({
      locationId,
      type: "html",
      title: piece.title.slice(0, 120),
      subjectLine: subject || piece.title.slice(0, 120),
      html: textToHtml(rest),
    }),
  });
  if (!res.ok) throw new Error(await ghlError(res));
  const data = await res.json();
  const id = data?.id ?? data?.redirect?.split("/").pop() ?? null;
  return {
    ghlItemId: id,
    url: `https://app.gohighlevel.com/v2/location/${locationId}/emails/builder`,
  };
}

async function pushBlog(apiKey: string, locationId: string, piece: Piece): Promise<PushResult> {
  // Strip the meta-description footer the Blog module appends (Phase 7).
  const metaSplit = piece.body.split(/\n---\nMeta description:/);
  const article = metaSplit[0].trim();
  const meta = metaSplit[1]?.trim() ?? "";

  const res = await fetch(`${GHL_BASE}/blogs/posts`, {
    method: "POST",
    headers: ghlHeaders(apiKey),
    body: JSON.stringify({
      locationId,
      title: piece.title.slice(0, 200),
      rawHTML: textToHtml(article),
      description: meta.slice(0, 160),
      status: "DRAFT",
    }),
  });
  if (!res.ok) throw new Error(await ghlError(res));
  const data = await res.json();
  return {
    ghlItemId: data?.data?._id ?? data?._id ?? data?.id ?? null,
    url: `https://app.gohighlevel.com/v2/location/${locationId}/blogs`,
  };
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightIfNeeded(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let contentPieceId = "";
  let destinationOverride = "";
  try {
    const body = await req.json();
    contentPieceId = String(body.content_piece_id ?? "");
    destinationOverride = String(body.destination ?? "");
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  if (!contentPieceId) return json({ error: "content_piece_id is required." }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } }
  );
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) return json({ error: "Not authenticated." }, 401);
  const userId = userData.user.id;

  // RLS scopes this read to the caller's account.
  const { data: piece, error: pieceError } = await supabase
    .from("content_pieces")
    .select("id, account_id, type, platform, title, body, status")
    .eq("id", contentPieceId)
    .maybeSingle();
  if (pieceError) return json({ error: pieceError.message }, 500);
  if (!piece) return json({ error: "Content not found." }, 404);
  if (!["approved", "scheduled", "published"].includes(piece.status)) {
    return json({ error: "Only approved, scheduled, or published content can be pushed to GHL." }, 422);
  }

  // Credentials via service role — account_secrets is deny-all to clients.
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const { data: secrets } = await admin
    .from("account_secrets")
    .select("ghl_api_key, ghl_location_id")
    .eq("account_id", piece.account_id)
    .maybeSingle();
  if (!secrets?.ghl_api_key || !secrets?.ghl_location_id) {
    return json({ error: "GHL isn't connected. Add your credentials in Settings." }, 422);
  }

  const destination = destinationOverride || destinationForType(piece.type);

  async function log(
    status: "success" | "failed",
    result: PushResult | null,
    errorDetail: string | null
  ) {
    await supabase.from("ghl_push_log").insert({
      account_id: piece!.account_id,
      content_piece_id: piece!.id,
      destination,
      status,
      ghl_item_id: result?.ghlItemId ?? null,
      ghl_url: result?.url ?? null,
      error_detail: errorDetail,
      created_by: userId,
    });
  }

  try {
    let result: PushResult;
    switch (destination) {
      case "social_planner":
        result = await pushSocial(secrets.ghl_api_key, secrets.ghl_location_id, piece as Piece);
        break;
      case "email_builder":
        result = await pushEmail(secrets.ghl_api_key, secrets.ghl_location_id, piece as Piece);
        break;
      case "blog":
        result = await pushBlog(secrets.ghl_api_key, secrets.ghl_location_id, piece as Piece);
        break;
      case "workflow_sms":
        // GHL's public API does not expose workflow-step creation. Logged as
        // failed with explicit guidance rather than silently mis-routing.
        throw new Error(
          "GHL's public API can't create workflow SMS steps. Copy the script into your GHL workflow manually — direct push lands with the GHL marketplace OAuth integration (v1.1)."
        );
      default:
        throw new Error(`Unknown destination: ${destination}`);
    }

    await log("success", result, null);
    await supabase
      .from("content_pieces")
      .update({ ghl_push_at: new Date().toISOString(), ghl_destination: destination })
      .eq("id", piece.id);

    return json({ ok: true, destination, ghl_item_id: result.ghlItemId, url: result.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "GHL push failed.";
    await log("failed", null, message);
    return json({ error: message }, 502);
  }
});
