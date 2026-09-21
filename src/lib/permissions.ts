/**
 * Team member permission keys (Spec Section 2).
 *
 * This list is the contract shared by the permission grid, the route guards,
 * and both team-* Edge Functions. Adding a key here surfaces it in the owner's
 * grid automatically; it still needs an access mapping in modules.ts to gate
 * anything.
 */
export const PERMISSIONS = [
  { key: "social_posts", label: "Social Posts", controls: "Access to the Social Posts module" },
  { key: "bulk_generate", label: "Bulk Generate", controls: "Access to the Bulk Generate module" },
  { key: "repurposing_engine", label: "Repurposing Engine", controls: "Access to the Repurposing Engine module" },
  { key: "blog_posts", label: "Blog Posts", controls: "Access to the Blog Posts module" },
  { key: "email_marketing", label: "Email Marketing", controls: "Access to the Email Marketing module" },
  { key: "approval_board", label: "Approval Board", controls: "View, approve, reject content and push approved content to GHL" },
  { key: "calendar", label: "Calendar", controls: "Access to the Calendar module" },
  { key: "content_library", label: "Content Library", controls: "Access to the Content Library module" },
  { key: "knowledge_base_view", label: "Knowledge Base — View", controls: "Read-only access to Knowledge Base documents" },
  { key: "knowledge_base_edit", label: "Knowledge Base — Edit", controls: "Upload, edit, or delete Knowledge Base documents" },
  { key: "brand_kit_view", label: "Brand Kit — View", controls: "Read-only access to Brand Kit fields" },
  { key: "brand_kit_edit", label: "Brand Kit — Edit", controls: "Edit Brand Kit fields" },
  { key: "trending_format_matching", label: "Trending Format Matching", controls: "Access to the Match Trend feature" },
  { key: "prompt_library", label: "Prompt Library", controls: "Access to the Prompt Library module" },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

export const PERMISSION_KEYS: PermissionKey[] = PERMISSIONS.map((p) => p.key);

/** Every key set to No — the starting state for a new team member. */
export function emptyPermissionMap(): Record<PermissionKey, boolean> {
  return Object.fromEntries(PERMISSION_KEYS.map((k) => [k, false])) as Record<
    PermissionKey,
    boolean
  >;
}

/**
 * How a route is gated.
 *  - "all"   → any signed-in user, owner or team member (Dashboard only)
 *  - "owner" → account owners only, never grantable to a team member
 *  - a key   → team members need that permission; owners always pass
 */
export type ModuleAccess = "all" | "owner" | PermissionKey;
