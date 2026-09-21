import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import {
  emptyPermissionMap,
  type ModuleAccess,
  type PermissionKey,
} from "@/lib/permissions";

export type MemberRole = "owner" | "team_member";

type LoadStatus = "idle" | "loading" | "ready" | "error";

interface TeamPermissionsState {
  memberRole: MemberRole;
  /** Only meaningful for team members; owners bypass it entirely. */
  permissions: Record<PermissionKey, boolean>;
  status: LoadStatus;
  error: string | null;
  /** True once an owner is known to be an owner, or a member's rows are in. */
  isOwner: () => boolean;
  /** Does the signed-in user hold this permission? Owners always do. */
  can: (key: PermissionKey) => boolean;
  /** Does the signed-in user satisfy a module's access rule? */
  canAccess: (access: ModuleAccess) => boolean;
  loadForProfile: (profile: { id: string; member_role?: string | null }) => Promise<void>;
  clear: () => void;
}

const OWNER_STATE = {
  memberRole: "owner" as MemberRole,
  permissions: emptyPermissionMap(),
  status: "ready" as LoadStatus,
  error: null,
};

export const useTeamPermissionsStore = create<TeamPermissionsState>((set, get) => ({
  ...OWNER_STATE,
  status: "idle",

  isOwner: () => get().memberRole === "owner",

  can: (key) => (get().memberRole === "owner" ? true : get().permissions[key] === true),

  canAccess: (access) => {
    if (access === "all") return true;
    const owner = get().memberRole === "owner";
    if (access === "owner") return owner;
    return owner || get().permissions[access] === true;
  },

  loadForProfile: async (profile) => {
    const role: MemberRole = profile.member_role === "team_member" ? "team_member" : "owner";

    // Owners are never restricted and never cost a round trip (Spec 5).
    if (role === "owner") {
      set({ ...OWNER_STATE });
      return;
    }

    set({ memberRole: role, status: "loading", error: null });
    try {
      const { data, error } = await supabase
        .from("team_member_permissions")
        .select("permission_key, allowed")
        .eq("profile_id", profile.id);
      if (error) throw new Error(error.message);

      // Start from all-No so a key with no row is denied, not undefined.
      const map = emptyPermissionMap();
      for (const row of data ?? []) {
        if (row.permission_key in map) {
          map[row.permission_key as PermissionKey] = row.allowed === true;
        }
      }
      set({ permissions: map, status: "ready", error: null });
    } catch (err) {
      // Fail closed: a team member whose permissions can't load gets nothing.
      set({
        permissions: emptyPermissionMap(),
        status: "error",
        error: err instanceof Error ? err.message : "Failed to load permissions.",
      });
    }
  },

  clear: () => set({ ...OWNER_STATE, status: "idle" }),
}));

/**
 * Reactive permission check for use inside components.
 *
 * Prefer this over `useTeamPermissionsStore((s) => s.can)`: selecting `can`
 * returns a stable function reference, so the component would never re-render
 * when the underlying grants change. This selector returns a boolean, which
 * does.
 */
export function useCan(key: PermissionKey): boolean {
  return useTeamPermissionsStore((s) =>
    s.memberRole === "owner" ? true : s.permissions[key] === true
  );
}
