// Edge Function: team-remove
// Deletes a team member outright — auth user, profile, and permission rows.
//
// Not named in the spec's function list, but Section 6's "Remove team member"
// button and test 9 ("the account is fully deleted and can no longer log in")
// cannot be satisfied without it: deleting the profile alone leaves a working
// auth user, and RLS gives the browser no delete path to auth.users at all.
//
// Deploy: supabase functions deploy team-remove

import { corsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { adminClient, requireOwnedTeamMember, requireOwner } from "../_shared/teamAuth.ts";

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

  let body: { profile_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const profileId = String(body.profile_id ?? "").trim();
  if (!profileId) return json({ error: "profile_id is required." }, 400);

  const target = await requireOwnedTeamMember(profileId, ctx, json);
  if (target instanceof Response) return target;

  const admin = adminClient();

  // Permissions first: if the auth delete fails halfway we'd rather leave a
  // member with no access than orphaned grants.
  await admin.from("team_member_permissions").delete().eq("profile_id", profileId);

  const { error: authError } = await admin.auth.admin.deleteUser(profileId);
  if (authError) return json({ error: authError.message }, 500);

  // profiles.id references auth.users on delete cascade, so the row is
  // normally gone already. This is a belt-and-braces sweep.
  await admin.from("profiles").delete().eq("id", profileId);

  return json({ profile_id: profileId, status: "removed" });
});
