// Edge Function: team-reset-password
// Owner-triggered password reset for one of their team members.
//
// Generates a fresh temporary password, sets it, and re-raises
// must_change_password so the member is forced to replace it on next sign-in —
// the same state a newly invited member starts in.
//
// This is the standing recovery path when email delivery is unconfigured or
// failing: the new password comes back in the response for the owner to read
// off screen and pass on directly. It is mailed as well when a provider is
// configured, so the member gets it without the owner relaying it.
//
// Deploy: supabase functions deploy team-reset-password

import { corsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { adminClient, requireOwnedTeamMember, requireOwner } from "../_shared/teamAuth.ts";
import { generatePassword } from "../_shared/password.ts";
import { resetEmailBody, sendEmail } from "../_shared/email.ts";

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
  const appUrl = Deno.env.get("SITE_URL") ?? "https://app.skilledft.com";
  const tempPassword = generatePassword(16);

  const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(profileId, {
    password: tempPassword,
  });
  if (updateError || !updated?.user) {
    return json({ error: updateError?.message ?? "Could not reset that password." }, 400);
  }

  // Re-arm the rotation gate. Service role, so protect_profile_fields allows
  // it — a signed-in user could not make this write themselves.
  const { data: profile, error: flagError } = await admin
    .from("profiles")
    .update({ must_change_password: true })
    .eq("id", profileId)
    .select("email, full_name")
    .maybeSingle();

  if (flagError) {
    return json(
      { error: `Password reset, but the rotation flag did not set: ${flagError.message}` },
      500
    );
  }

  const email = profile?.email ?? updated.user.email ?? "";
  const firstName = (profile?.full_name ?? "").trim();

  const mail = resetEmailBody({ appUrl, firstName, email, password: tempPassword });
  const delivery = await sendEmail({ to: email, ...mail });

  console.log(JSON.stringify({
    event: "team_reset_password",
    profile_id: profileId,
    to: email,
    email_sent: delivery.sent,
    email_provider: delivery.sent ? "resend" : null,
    email_reason: delivery.reason ?? null,
  }));

  return json({
    profile_id: profileId,
    email,
    temp_password: tempPassword,
    email_sent: delivery.sent,
    email_error: delivery.reason ?? null,
    login_url: appUrl,
  });
});
