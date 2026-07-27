import { useEffect, useRef, useState } from "react";
import { Loader2, TrendingUp, X, AlertTriangle } from "lucide-react";
import { invokeEdgeFunction } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A trend format option returned by the trend-match Edge Function. */
export interface TrendOption {
  format_name: string;
  description: string;
  why_trending: string;
}

/** The subset of a content piece trend matching needs to reformat it. */
export interface TrendMatchTarget {
  id: string;
  title: string;
  body: string;
  type: string;
  platform: string | null;
  pillar: string | null;
}

/** The reformatted piece handed back by trend-match-apply. */
export interface TrendMatchResult {
  body: string;
  trend_format: string;
  original_concept: string;
}

interface TrendMatchModalProps {
  piece: TrendMatchTarget;
  onClose: () => void;
  onApplied: (result: TrendMatchResult) => void;
}

/**
 * Two-step trend matching, shared by Approval Board and Bulk Generate.
 * Step 1 loads 3 trending format options; nothing is applied until the user
 * picks one, which triggers step 2 (the reformat).
 */
export default function TrendMatchModal({ piece, onClose, onApplied }: TrendMatchModalProps) {
  const [options, setOptions] = useState<TrendOption[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Trend search is a slow (~30s), paid call, and React StrictMode double-
  // invokes effects in dev. The ref both dedupes the request and identifies
  // which piece the in-flight result belongs to.
  //
  // Deliberately no cleanup-cancel flag: StrictMode's simulated unmount would
  // set it before the response lands, so the request would succeed and its
  // result be thrown away — a spinner that never resolves. Guarding on the
  // ref instead keeps the result if we still care about this piece, and drops
  // it only when the modal has genuinely moved on.
  const startedFor = useRef<string | null>(null);

  useEffect(() => {
    if (startedFor.current === piece.id) return;
    startedFor.current = piece.id;

    async function loadOptions() {
      setLoading(true);
      setError(null);
      try {
        const result = await invokeEdgeFunction<{ options: TrendOption[] }>("trend-match", {
          concept: piece.body,
          platform: (piece.platform ?? "Instagram").toLowerCase(),
          pillar: piece.pillar ?? "",
        });
        if (startedFor.current !== piece.id) return;
        setOptions(result.options ?? []);
      } catch (err) {
        if (startedFor.current !== piece.id) return;
        setError(err instanceof Error ? err.message : "Could not find trending formats.");
      } finally {
        if (startedFor.current === piece.id) setLoading(false);
      }
    }
    void loadOptions();
  }, [piece.id, piece.body, piece.platform, piece.pillar]);

  async function applyFormat(option: TrendOption) {
    if (applying) return;
    setApplying(option.format_name);
    setError(null);
    try {
      const result = await invokeEdgeFunction<{
        content: { body: string };
        trend_format: string;
        original_concept: string;
      }>("trend-match-apply", {
        content_piece_id: piece.id,
        format_name: option.format_name,
        format_description: option.description,
      });
      onApplied({
        body: result.content.body,
        trend_format: result.trend_format,
        original_concept: result.original_concept,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply this trend format.");
      setApplying(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-10"
      onClick={() => {
        if (!applying) onClose();
      }}
    >
      <div
        className="w-full max-w-xl rounded-lg border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Match to a trending format"
      >
        <div className="flex items-start justify-between gap-3 border-b p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <TrendingUp className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold">Match to a trending format</h2>
              <p className="line-clamp-1 text-xs text-muted-foreground">
                {piece.title || piece.body.slice(0, 60)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={applying !== null}
            className="rounded p-1.5 text-muted-foreground hover:bg-secondary disabled:opacity-40"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-4">
          {loading && (
            <div className="flex flex-col items-center justify-center gap-3 py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Searching for trending {piece.platform ?? "Instagram"} formats…
              </p>
            </div>
          )}

          {error && (
            <p className="mb-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </p>
          )}

          {!loading && options && options.length > 0 && (
            <>
              <p className="mb-3 text-sm text-muted-foreground">
                Pick a format. Your message and voice stay the same — only the structure changes.
              </p>
              <ul className="space-y-2">
                {options.map((option) => {
                  const isApplying = applying === option.format_name;
                  return (
                    <li key={option.format_name}>
                      <button
                        type="button"
                        onClick={() => void applyFormat(option)}
                        disabled={applying !== null}
                        className={cn(
                          "w-full rounded-md border p-3 text-left transition-colors",
                          "hover:border-primary hover:bg-accent",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          applying !== null && !isApplying && "opacity-50",
                          isApplying && "border-primary bg-accent"
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold">{option.format_name}</p>
                          {isApplying && (
                            <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-primary">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Matching to trend…
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{option.description}</p>
                        {option.why_trending && (
                          <p className="mt-1.5 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">Why now: </span>
                            {option.why_trending}
                          </p>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {!loading && options && options.length === 0 && !error && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No trending formats came back. Try again in a moment.
            </p>
          )}

          {!loading && error && !options && (
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" onClick={onClose}>
                Close
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
