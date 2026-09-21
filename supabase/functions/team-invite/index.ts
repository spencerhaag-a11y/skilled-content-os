// Edge Function: team-invite
// Invites a team member to the caller's account and seeds their permissions.
//
// The invitee sets their own password via the emailed invite link — no
// password is ever created here (Spec Section 3).
//
// Deploy: supabase functions deploy team-invite

import { corsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { adminClient, PERMISSION_KEYS, requireOwner } from "../_shared/teamAuth.ts";

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

  let body: { email?: string; first_name?: string; permissions?: Record<string, boolean> };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const firstName = String(body.first_name ?? "").trim();
  const requested = body.permissions ?? {};
  if (!email) return json({ error: "An email address is required." }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: "That email address looks invalid." }, 400);
  }

  const admin = adminClient();

  // Where the invite link lands. The SITE_URL secret wins when set (staging,
  // preview builds); the literal keeps production links correct without
  // depending on a secret existing, which is what produced localhost links.
  //
  // Supabase only honours redirectTo when it matches the project's Redirect
  // URLs allow-list. If it doesn't, the link silently falls back to the Auth
  // Site URL — so this value must also be allow-listed in the dashboard.
  const appUrl = Deno.env.get("SITE_URL") ?? "https://app.skilledft.com";

  // The metadata here is what handle_new_user branches on to file the new
  // profile under this owner's account instead of minting a fresh one.
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: {
      member_role: "team_member",
      owner_account_id: ctx.accountId,
      full_name: firstName,
    },
    redirectTo: appUrl,
  });

  if (inviteError || !invited?.user) {
    return json(
      { error: inviteError?.message ?? "Could not send the invite." },
      inviteError?.message?.toLowerCase().includes("already") ? 409 : 400
    );
  }

  const profileId = invited.user.id;

  // One row per known key so an unlisted key in the request can't create a
  // permission the app doesn't recognise, and every key has an explicit value.
  const rows = PERMISSION_KEYS.map((key) => ({
    profile_id: profileId,
    account_id: ctx.accountId,
    permission_key: key,
    allowed: requested[key] === true,
  }));

  const { error: permError } = await admin
    .from("team_member_permissions")
    .upsert(rows, { onConflict: "profile_id,permission_key" });

  if (permError) {
    return json(
      { error: `Invite sent, but permissions failed to save: ${permError.message}` },
      500
    );
  }

  return json({ profile_id: profileId, email, status: "invited" });
});
