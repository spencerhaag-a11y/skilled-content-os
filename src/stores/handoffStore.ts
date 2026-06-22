import { create } from "zustand";

/**
 * Cross-module handoff (the "send this idea to a content module" actions in
 * Niche Research, Website Scanner, Social Listener, SEO Tools, and the Video
 * Module). A source module drops a payload here and navigates to the target
 * route; the target module picks the payload up on mount and prefills its
 * form, then clears it so a refresh starts clean.
 */

/** Routes that can receive a handoff. Matches ModuleDef.path. */
export type HandoffTarget = "/social-posts" | "/blog-posts" | "/brainstorm" | "/repurpose";

export interface HandoffPayload {
  target: HandoffTarget;
  /** Short topic/idea line — prefills the topic or chat input. */
  topic?: string;
  /** Optional content pillar to preselect. */
  pillar?: string;
  /** Optional platform hint (Social Posts). */
  platform?: string;
  /** Long-form source text — used by Repurpose (input) and Brainstorm (brain dump). */
  body?: string;
  /** Suggested content format/type label, if the source proposed one. */
  format?: string;
  /** Human-readable origin shown to the user, e.g. "Niche Research". */
  source?: string;
}

interface HandoffState {
  pending: HandoffPayload | null;
  /** Stage a payload for a target module (call before navigate). */
  send: (payload: HandoffPayload) => void;
  /**
   * Consume the staged payload IF it targets this route. Returns the payload
   * and clears it; returns null when nothing is staged for the route. Safe to
   * call from a mount effect.
   */
  take: (target: HandoffTarget) => HandoffPayload | null;
  clear: () => void;
}

export const useHandoffStore = create<HandoffState>((set, get) => ({
  pending: null,

  send: (payload) => set({ pending: payload }),

  take: (target) => {
    const { pending } = get();
    if (!pending || pending.target !== target) return null;
    set({ pending: null });
    return pending;
  },

  clear: () => set({ pending: null }),
}));
