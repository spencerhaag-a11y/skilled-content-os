import { create } from "zustand";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

interface AuthState {
  session: Session | null;
  user: User | null;
  /** True once the initial getSession() resolves — gates route rendering */
  initialized: boolean;
  /** Master owner role, read from the platform_owner JWT custom claim (Section 3) */
  isPlatformOwner: boolean;
  initialize: () => Promise<void>;
  signOut: () => Promise<void>;
}

function readPlatformOwnerClaim(session: Session | null): boolean {
  if (!session) return false;
  const meta = session.user.app_metadata as Record<string, unknown> | undefined;
  return meta?.platform_owner === true;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  initialized: false,
  isPlatformOwner: false,

  initialize: async () => {
    if (get().initialized) return;
    const { data } = await supabase.auth.getSession();
    set({
      session: data.session,
      user: data.session?.user ?? null,
      isPlatformOwner: readPlatformOwnerClaim(data.session),
      initialized: true,
    });
    supabase.auth.onAuthStateChange((_event, session) => {
      set({
        session,
        user: session?.user ?? null,
        isPlatformOwner: readPlatformOwnerClaim(session),
      });
    });
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, user: null, isPlatformOwner: false });
  },
}));
