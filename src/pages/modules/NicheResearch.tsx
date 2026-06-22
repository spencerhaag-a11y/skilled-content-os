import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Compass,
  Loader2,
  Share2,
  FileText,
  MessagesSquare,
  CalendarClock,
  HelpCircle,
  History,
} from "lucide-react";
import { invokeEdgeFunction, supabase } from "@/lib/supabase";
import { useAccountStore } from "@/stores/accountStore";
import { useHandoffStore, type HandoffTarget } from "@/stores/handoffStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Topic {
  topic: string;
  format: string;
  angle: string;
  rank: number;
}
interface Seasonal {
  opportunity: string;
  timing: string;
}
interface ResearchResults {
  topics: Topic[];
  faqs: string[];
  seasonal: Seasonal[];
}
interface ResearchSession {
  id: string;
  niche: string;
  results_json: ResearchResults;
  created_at: string;
}

const HANDOFFS: { target: HandoffTarget; label: string; icon: typeof Share2 }[] = [
  { target: "/social-posts", label: "Social", icon: Share2 },
  { target: "/blog-posts", label: "Blog", icon: FileText },
  { target: "/brainstorm", label: "Brainstorm", icon: MessagesSquare },
];

export default function NicheResearch() {
  const account = useAccountStore((s) => s.account);
  const send = useHandoffStore((s) => s.send);
  const navigate = useNavigate();

  const [niche, setNiche] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<ResearchSession | null>(null);
  const [history, setHistory] = useState<ResearchSession[]>([]);

  useEffect(() => {
    if (!account) return;
    void supabase
      .from("research_sessions")
      .select("id, niche, results_json, created_at")
      .eq("account_id", account.id)
      .order("created_at", { ascending: false })
      .limit(10)
      .then(({ data }) => setHistory((data ?? []) as ResearchSession[]));
  }, [account]);

  async function handleResearch() {
    setError(null);
    if (niche.trim().length < 2) {
      setError("Enter a niche or topic area.");
      return;
    }
    setLoading(true);
    setSession(null);
    try {
      const { session: s } = await invokeEdgeFunction<{ session: ResearchSession }>("niche-research", {
        niche: niche.trim(),
      });
      setSession(s);
      setHistory((h) => [s, ...h].slice(0, 10));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Research failed.");
    } finally {
      setLoading(false);
    }
  }

  function sendIdea(target: HandoffTarget, topic: Topic) {
    send({
      target,
      topic: topic.topic,
      format: topic.format,
      source: "Niche Research",
    });
    navigate(target);
  }

  const results = session?.results_json;

  return (
    <div className="mx-auto max-w-3xl pb-12">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Compass className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Niche Research</h1>
          <p className="text-sm text-muted-foreground">
            Trending topics, real audience questions, and seasonal openings — ready to send
            straight into a content module.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Research a niche</CardTitle>
          <CardDescription>
            Be specific — "youth hockey strength training" beats "fitness".
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleResearch()}
              placeholder="e.g. off-season training for high school hockey players"
              aria-label="Niche"
            />
            <Button onClick={() => void handleResearch()} disabled={loading} className="shrink-0">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? "Researching…" : "Research"}
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {results && (
        <div className="mt-8 space-y-6">
          {/* Content ideas */}
          <div>
            <h2 className="mb-3 text-lg font-semibold">Content ideas</h2>
            <div className="space-y-3">
              {results.topics.map((t, i) => (
                <Card key={i}>
                  <CardContent className="space-y-2 py-4">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {t.rank}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{t.topic}</p>
                        {t.angle && <p className="mt-0.5 text-sm text-muted-foreground">{t.angle}</p>}
                        <span className="mt-1 inline-block rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-secondary-foreground">
                          {t.format}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 pl-9">
                      {HANDOFFS.map((h) => (
                        <button
                          key={h.target}
                          type="button"
                          onClick={() => sendIdea(h.target, t)}
                          className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-secondary"
                        >
                          <h.icon className="h-3.5 w-3.5" />
                          {h.label}
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* FAQs */}
          {results.faqs.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <HelpCircle className="h-4 w-4 text-primary" /> Questions your audience asks
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5">
                  {results.faqs.map((q, i) => (
                    <li key={i} className="flex gap-2 text-sm">
                      <span className="text-muted-foreground">•</span>
                      {q}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Seasonal */}
          {results.seasonal.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarClock className="h-4 w-4 text-primary" /> Seasonal opportunities
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {results.seasonal.map((s, i) => (
                    <li key={i} className="text-sm">
                      <span className="font-medium">{s.opportunity}</span>
                      {s.timing && <span className="text-muted-foreground"> — {s.timing}</span>}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="mt-10">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <History className="h-4 w-4" /> Recent research
          </h2>
          <div className="flex flex-wrap gap-2">
            {history.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => {
                  setSession(h);
                  setNiche(h.niche);
                }}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm transition-colors hover:bg-secondary",
                  session?.id === h.id && "border-primary bg-secondary"
                )}
              >
                {h.niche}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
