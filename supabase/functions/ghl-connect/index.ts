// Edge Function: ghl-connect
// Section 6 — Connection setup. Validates the GHL Private Integration token
// against the Location API, then stores credentials in account_secrets via
// the SERVICE ROLE (the table has zero client policies — Section 3).
// The key is never returned to the browser after save.
//
// Deploy: supabase functions deploy ghl-connect

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

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

  let action = "connect";
  let apiKey = "";
  let locationId = "";
  try {
    const body = await req.json();
    action = String(body.action ?? "connect");
    apiKey = String(body.api_key ?? "").trim();
    locationId = String(body.location_id ?? "").trim();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  // Identify the caller with their own JWT (RLS-scoped).
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
  const accountId = profile.account_id;

  // Secrets writes require the service role — account_secrets is deny-all.
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  if (action === "disconnect") {
    const { error: clearError } = await admin
      .from("account_secrets")
      .upsert({ account_id: accountId, ghl_api_key: null, ghl_location_id: null });
    if (clearError) return json({ error: clearError.message }, 500);
    await admin.from("accounts").update({ ghl_connected: false }).eq("id", accountId);
    return json({ connected: false });
  }

  if (!apiKey || !locationId) {
    return json({ error: "Both the Private Integration token and Location ID are required." }, 400);
  }

  // Connection test (Section 6): verify the key can read its own location.
  const testRes = await fetch(`${GHL_BASE}/locations/${encodeURIComponent(locationId)}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Version: GHL_VERSION,
      Accept: "application/json",
    },
  });
  if (!testRes.ok) {
    const detail = await testRes.text();
    return json(
      {
        error: `GHL rejected the credentials (${testRes.status}). Check the token and Location ID. Detail: ${detail.slice(0, 200)}`,
      },
      422
    );
  }

  const { error: saveError } = await admin
    .from("account_secrets")
    .upsert({ account_id: accountId, ghl_api_key: apiKey, ghl_location_id: locationId });
  if (saveError) return json({ error: saveError.message }, 500);

  await admin.from("accounts").update({ ghl_connected: true }).eq("id", accountId);

  // Note: the key is verified and stored — and never echoed back.
  return json({ connected: true });
});
