// Edge Function: team-invite
// Creates a team member on the caller's account with a server-generated
// temporary password, mails them their credentials, and seeds permissions.
//
// createUser rather than inviteUserByEmail: the member signs in at the normal
// login page with a password, and profiles.must_change_password (set by
// handle_new_user) forces them to replace it before the app opens.
//
// email_confirm is set so the account is usable immediately — there is no
// confirmation link in this flow to click.
//
// Deploy: supabase functions deploy team-invite

import { corsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { adminClient, PERMISSION_KEYS, requireOwner } from "../_shared/teamAuth.ts";
import { generatePassword } from "../_shared/password.ts";
import { inviteEmailBody, sendEmail } from "../_shared/email.ts";

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
  const appUrl = Deno.env.get("SITE_URL") ?? "https://app.skilledft.com";
  const tempPassword = generatePassword(16);

  // The metadata is what handle_new_user branches on to file the profile under
  // this owner's account and set must_change_password.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: {
      member_role: "team_member",
      owner_account_id: ctx.accountId,
      full_name: firstName,
    },
  });

  if (createError || !created?.user) {
    const message = createError?.message ?? "Could not create that team member.";
    return json(
      { error: message },
      /already|exist|registered/i.test(message) ? 409 : 400
    );
  }

  const profileId = created.user.id;

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
      { error: `Account created, but permissions failed to save: ${permError.message}` },
      500
    );
  }

  const mail = inviteEmailBody({ appUrl, firstName, email, password: tempPassword });
  const delivery = await sendEmail({ to: email, ...mail });

  // The password is returned either way. When mail is configured this is
  // belt-and-braces; when it isn't, it is the only delivery path the owner
  // has, so the UI shows it once and tells them to pass it on directly.
  return json({
    profile_id: profileId,
    email,
    temp_password: tempPassword,
    email_sent: delivery.sent,
    email_error: delivery.reason ?? null,
    login_url: appUrl,
  });
});
