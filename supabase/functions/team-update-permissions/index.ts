// Edge Function: team-update-permissions
// Updates a team member's permission map. Also the revoke path — setting every
// key to false locks the member out of every module without deleting anything
// (Spec Section 4).
//
// Deploy: supabase functions deploy team-update-permissions

import { corsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import {
  adminClient,
  PERMISSION_KEYS,
  requireOwnedTeamMember,
  requireOwner,
} from "../_shared/teamAuth.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightIfNeeded(req);
  if (preflight) return preflight;

  const ctx = await requireOwner(req, json);
  if (ctx instanceof Response) return ctx;

  let body: { profile_id?: string; permissions?: Record<string, boolean> };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const profileId = String(body.profile_id ?? "").trim();
  const requested = body.permissions ?? {};
  if (!profileId) return json({ error: "profile_id is required." }, 400);

  const target = await requireOwnedTeamMember(profileId, ctx, json);
  if (target instanceof Response) return target;

  // Only keys actually present in the request are touched, so a partial
  // update can't silently reset the keys it didn't mention.
  const rows = PERMISSION_KEYS.filter((key) => key in requested).map((key) => ({
    profile_id: profileId,
    account_id: ctx.accountId,
    permission_key: key,
    allowed: requested[key] === true,
    updated_at: new Date().toISOString(),
  }));

  if (rows.length === 0) return json({ error: "No known permission keys supplied." }, 400);

  const { error } = await adminClient()
    .from("team_member_permissions")
    .upsert(rows, { onConflict: "profile_id,permission_key" });

  if (error) return json({ error: error.message }, 500);

  return json({ profile_id: profileId, updated: rows.length });
});
