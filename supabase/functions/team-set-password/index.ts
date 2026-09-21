// Edge Function: team-set-password
// Sets the signed-in user's own password and clears must_change_password.
//
// Both halves run server-side under the service role deliberately.
// protect_profile_fields blocks a signed-in user from writing
// must_change_password themselves, so the rotation gate cannot be turned off
// by PATCHing your own profile row — it only clears as a side effect of
// actually setting a new password here.
//
// Deploy: supabase functions deploy team-set-password

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { adminClient } from "../_shared/teamAuth.ts";

const MIN_LENGTH = 10;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightIfNeeded(req);
  if (preflight) return preflight;

  const caller = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } }
  );

  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData.user) return json({ error: "Not authenticated." }, 401);

  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const password = String(body.password ?? "");
  if (password.length < MIN_LENGTH) {
    return json({ error: `Password must be at least ${MIN_LENGTH} characters.` }, 400);
  }

  const admin = adminClient();

  const { error: updateError } = await admin.auth.admin.updateUserById(userData.user.id, {
    password,
  });
  if (updateError) return json({ error: updateError.message }, 400);

  // Only after the password actually changed.
  const { error: profileError } = await admin
    .from("profiles")
    .update({ must_change_password: false })
    .eq("id", userData.user.id);

  if (profileError) {
    return json(
      { error: `Password changed, but the account flag did not clear: ${profileError.message}` },
      500
    );
  }

  return json({ status: "password_set" });
});
