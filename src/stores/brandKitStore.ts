import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { calculateBrandScore } from "@/lib/brandScore";

export interface IcpFields {
  demographics: string;
  pain_points: string;
  goals: string;
  objections: string;
}

export interface PlatformEntry {
  platform: string;
  handle: string;
}

/** Editable shape used by the form and score calculator. */
export interface BrandKitDraft {
  business_name: string;
  tagline: string;
  mission: string;
  voice: string[];
  icp: IcpFields;
  pillars: string[];
  platforms: PlatformEntry[];
  competitors: string[];
  url: string;
  brand_colors: string[];
  typography: string;
}

export const EMPTY_BRAND_KIT: BrandKitDraft = {
  business_name: "",
  tagline: "",
  mission: "",
  voice: [],
  icp: { demographics: "", pain_points: "", goals: "", objections: "" },
  pillars: [],
  platforms: [],
  competitors: [],
  url: "",
  brand_colors: [],
  typography: "",
};

type Status = "idle" | "loading" | "ready" | "saving" | "error";

interface BrandKitState {
  kit: BrandKitDraft;
  /** Row id when a kit exists in the DB */
  kitId: string | null;
  score: number;
  status: Status;
  error: string | null;
  load: (accountId: string) => Promise<void>;
  save: (accountId: string, userId: string, kit: BrandKitDraft) => Promise<boolean>;
}

function rowToDraft(row: Record<string, unknown>): BrandKitDraft {
  const icp = (row.icp ?? {}) as Partial<IcpFields>;
  return {
    business_name: (row.business_name as string) ?? "",
    tagline: (row.tagline as string) ?? "",
    mission: (row.mission as string) ?? "",
    voice: (row.voice as string[]) ?? [],
    icp: {
      demographics: icp.demographics ?? "",
      pain_points: icp.pain_points ?? "",
      goals: icp.goals ?? "",
      objections: icp.objections ?? "",
    },
    pillars: (row.pillars as string[]) ?? [],
    platforms: (row.platforms as PlatformEntry[]) ?? [],
    competitors: (row.competitors as string[]) ?? [],
    url: (row.url as string) ?? "",
    brand_colors: (row.brand_colors as string[]) ?? [],
    typography: (row.typography as string) ?? "",
  };
}

export const useBrandKitStore = create<BrandKitState>((set) => ({
  kit: EMPTY_BRAND_KIT,
  kitId: null,
  score: 0,
  status: "idle",
  error: null,

  load: async (accountId) => {
    set({ status: "loading", error: null });
    const { data, error } = await supabase
      .from("brand_kits")
      .select("*")
      .eq("account_id", accountId)
      .maybeSingle();
    if (error) {
      set({ status: "error", error: error.message });
      return;
    }
    if (!data) {
      set({ kit: EMPTY_BRAND_KIT, kitId: null, score: 0, status: "ready" });
      return;
    }
    const draft = rowToDraft(data);
    set({ kit: draft, kitId: data.id, score: calculateBrandScore(draft), status: "ready" });
  },

  save: async (accountId, userId, kit) => {
    set({ status: "saving", error: null });
    const score = calculateBrandScore(kit);
    const { data, error } = await supabase
      .from("brand_kits")
      .upsert(
        {
          account_id: accountId,
          created_by: userId,
          business_name: kit.business_name.trim() || null,
          tagline: kit.tagline.trim() || null,
          mission: kit.mission.trim() || null,
          voice: kit.voice,
          icp: kit.icp,
          pillars: kit.pillars,
          platforms: kit.platforms,
          competitors: kit.competitors,
          url: kit.url.trim() || null,
          brand_colors: kit.brand_colors,
          typography: kit.typography.trim() || null,
          score,
        },
        { onConflict: "account_id" }
      )
      .select("id")
      .single();
    if (error) {
      set({ status: "error", error: error.message });
      return false;
    }
    set({ kit, kitId: data.id, score, status: "ready" });
    return true;
  },
}));
