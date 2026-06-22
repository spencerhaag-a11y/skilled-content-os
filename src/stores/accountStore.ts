import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { applyAccountTheme } from "@/lib/utils";

/** Mirrors the accounts table (Section 3, Core Database Tables) */
export interface Account {
  id: string;
  name: string;
  white_label_name: string | null;
  logo_url: string | null;
  primary_color: string | null;
  owner_id: string;
  plan: string;
  ghl_connected: boolean;
  is_active: boolean;
  /** Module paths the owner has switched off for this account (Module 21). */
  disabled_modules: string[];
  created_at: string;
}

export interface Profile {
  id: string;
  account_id: string | null;
  email: string;
  full_name: string | null;
  is_platform_owner: boolean;
}

type LoadStatus = "idle" | "loading" | "ready" | "error";

interface AccountState {
  account: Account | null;
  profile: Profile | null;
  status: LoadStatus;
  error: string | null;
  /** Platform name shown in the shell — white-label aware */
  platformName: string;
  /** Module paths the platform owner has disabled for this account (Module 21
   *  feature flags). The sidebar hides these. */
  disabledModules: string[];
  /** Loads profile + account for the signed-in user and applies branding. */
  loadForUser: (userId: string) => Promise<void>;
  clear: () => void;
}

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, account_id, email, full_name, is_platform_owner")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export const useAccountStore = create<AccountState>((set, get) => ({
  account: null,
  profile: null,
  status: "idle",
  error: null,
  platformName: "Skilled Content OS",
  disabledModules: [],

  loadForUser: async (userId) => {
    if (get().status === "loading") return;
    set({ status: "loading", error: null });
    try {
      // The signup trigger creates profile + account server-side. One short
      // retry covers replication lag immediately after first signup.
      let profile = await fetchProfile(userId);
      if (!profile) {
        await new Promise((r) => setTimeout(r, 700));
        profile = await fetchProfile(userId);
      }
      if (!profile) throw new Error("Profile not found for this user.");

      let account: Account | null = null;
      let disabledModules: string[] = [];
      if (profile.account_id) {
        const { data, error } = await supabase
          .from("accounts")
          .select("*")
          .eq("id", profile.account_id)
          .maybeSingle();
        if (error) throw new Error(error.message);
        account = data;
        // Feature flags live on the account row as a text[] (Module 21).
        disabledModules = account?.disabled_modules ?? [];
      }

      applyAccountTheme({ primaryColorHex: account?.primary_color });
      set({
        profile,
        account,
        disabledModules,
        status: "ready",
        platformName: account?.white_label_name?.trim() || "Skilled Content OS",
      });
    } catch (err) {
      set({
        status: "error",
        error: err instanceof Error ? err.message : "Failed to load account.",
      });
    }
  },

  clear: () =>
    set({
      account: null,
      profile: null,
      status: "idle",
      error: null,
      platformName: "Skilled Content OS",
      disabledModules: [],
    }),
}));
