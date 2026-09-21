// Shared owner-verification for the team-* Edge Functions.
//
// Every one of these endpoints is owner-only and enforced here, server-side —
// hiding the UI is not the control (Spec Section 8).

import { createClient } from "npm:@supabase/supabase-js@2";

/** The 14 permission keys (Spec Section 2). Mirrors src/lib/permissions.ts. */
export const PERMISSION_KEYS = [
  "social_posts",
  "bulk_generate",
  "repurposing_engine",
  "blog_posts",
  "email_marketing",
  "approval_board",
  "calendar",
  "content_library",
  "knowledge_base_view",
  "knowledge_base_edit",
  "brand_kit_view",
  "brand_kit_edit",
  "trending_format_matching",
  "prompt_library",
] as const;

export function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

export interface OwnerContext {
  userId: string;
  accountId: string;
}

/**
 * Resolves the caller to an account owner, or returns the Response to send.
 * Ownership is confirmed against accounts.owner_id, not just the profile's
 * member_role text, so a tampered profile row alone can't grant this.
 */
export async function requireOwner(
  req: Request,
  json: (body: unknown, status?: number) => Response
): Promise<OwnerContext | Response> {
  const caller = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } }
  );

  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData.user) return json({ error: "Not authenticated." }, 401);

  const admin = adminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, member_role")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (!profile || profile.member_role === "team_member") {
    return json({ error: "Only the account owner can manage team members." }, 403);
  }

  const { data: account } = await admin
    .from("accounts")
    .select("id")
    .eq("owner_id", userData.user.id)
    .maybeSingle();

  if (!account) {
    return json({ error: "Only the account owner can manage team members." }, 403);
  }

  return { userId: userData.user.id, accountId: account.id };
}

/** Confirms a target profile is a team member of the caller's account. */
export async function requireOwnedTeamMember(
  profileId: string,
  ctx: OwnerContext,
  json: (body: unknown, status?: number) => Response
): Promise<{ id: string } | Response> {
  const admin = adminClient();
  const { data: target } = await admin
    .from("profiles")
    .select("id, owner_account_id, member_role")
    .eq("id", profileId)
    .maybeSingle();

  if (!target || target.member_role !== "team_member" || target.owner_account_id !== ctx.accountId) {
    return json({ error: "That team member does not belong to your account." }, 403);
  }
  return { id: target.id };
}
