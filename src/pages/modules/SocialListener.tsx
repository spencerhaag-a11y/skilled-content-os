import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Radio, Loader2, Lightbulb, MessagesSquare, History, Info } from "lucide-react";
import { invokeEdgeFunction, supabase } from "@/lib/supabase";
import { useAccountStore } from "@/stores/accountStore";
import { useHandoffStore } from "@/stores/handoffStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const PLATFORMS = ["Instagram", "TikTok", "LinkedIn"];

interface ListenerResults {
  voice_summary: string;
  style_report: {
    tone: string;
    formats: string[];
    caption_structure: string;
    hashtag_strategy: string;
    posting_frequency: string;
  };
  opportunities: string[];
  grounded: boolean;
}
interface Scan {
  id: string;
  url: string;
  platform: string | null;
  results_json: ListenerResults;
  created_at: string;
}

const STYLE_ROWS: { key: keyof ListenerResults["style_report"]; label: string }[] = [
  { key: "tone", label: "Tone" },
  { key: "caption_structure", label: "Caption structure" },
  { key: "hashtag_strategy", label: "Hashtag strategy" },
  { key: "posting_frequency", label: "Posting frequency" },
];

export default function SocialListener() {
  const account = useAccountStore((s) => s.account);
  const send = useHandoffStore((s) => s.send);
  const navigate = useNavigate();

  const [handle, setHandle] = useState("");
  const [platform, setPlatform] = useState("Instagram");
  const [mode, setMode] = useState<"own" | "competitor">("own");
  const [samplePosts, setSamplePosts] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [history, setHistory] = useState<Scan[]>([]);

  useEffect(() => {
    if (!account) return;
    void supabase
      .from("scan_history")
      .select("id, url, platform, results_json, created_at")
      .eq("account_id", account.id)
      .eq("scan_type", "social")
      .order("created_at", { ascending: false })
      .limit(10)
      .then(({ data }) => setHistory((data ?? []) as Scan[]));
  }, [account]);

  async function handleAnalyze() {
    setError(null);
    if (handle.trim().length < 2) {
      setError("Enter a handle or profile URL.");
      return;
    }
    setLoading(true);
    setScan(null);
    try {
      const { scan: s } = await invokeEdgeFunction<{ scan: Scan }>("social-listener", {
        handle: handle.trim(),
        platform,
        mode,
        sample_posts: samplePosts.trim() || undefined,
      });
      setScan(s);
      setHistory((h) => [s, ...h].slice(0, 10));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  function opportunityToBrainstorm(text: string) {
    send({ target: "/brainstorm", topic: text, source: "Social Listener" });
    navigate("/brainstorm");
  }

  const r = scan?.results_json;

  return (
    <div className="mx-auto max-w-3xl pb-12">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Radio className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Social Listener</h1>
          <p className="text-sm text-muted-foreground">
            Read any account's tone, formats, and caption patterns to inform your own content.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Analyze an account</CardTitle>
          <CardDescription>Your own account for a voice baseline, or a competitor for gaps.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Platform</Label>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPlatform(p)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm transition-colors",
                      platform === p ? "border-primary bg-primary text-primary-foreground" : "hover:bg-secondary"
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Mode</Label>
              <div className="flex flex-wrap gap-2">
                {(["own", "competitor"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm transition-colors",
                      mode === m ? "border-primary bg-primary text-primary-foreground" : "hover:bg-secondary"
                    )}
                  >
                    {m === "own" ? "My account" : "Competitor"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="handle">Handle or profile URL</Label>
            <Input
              id="handle"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="@skilledfitnesstherapy"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="samples">Paste recent captions (optional, but grounds the report)</Label>
            <Textarea
              id="samples"
              value={samplePosts}
              onChange={(e) => setSamplePosts(e.target.value)}
              rows={5}
              placeholder="Paste a handful of recent captions, one per line…"
            />
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {platform} doesn't expose post data to apps without a platform API (not in v1.0), so
              pasting real captions makes this analysis far sharper.
            </p>
          </div>

          <div className="flex justify-end">
            <Button onClick={() => void handleAnalyze()} disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? "Analyzing…" : "Analyze"}
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {r && (
        <div className="mt-8 space-y-6">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">Voice summary</CardTitle>
                {!r.grounded && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                    Baseline — no posts pasted
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm leading-relaxed">{r.voice_summary}</p>
              <dl className="grid gap-3 sm:grid-cols-2">
                {STYLE_ROWS.map(({ key, label }) => (
                  <div key={key}>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
                    <dd className="text-sm">{r.style_report[key] as string}</dd>
                  </div>
                ))}
              </dl>
              {r.style_report.formats.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Formats</p>
                  <div className="flex flex-wrap gap-1.5">
                    {r.style_report.formats.map((f, i) => (
                      <span key={i} className="rounded-full bg-secondary px-2.5 py-0.5 text-xs">{f}</span>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {r.opportunities.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Lightbulb className="h-4 w-4 text-primary" /> Opportunities
                </CardTitle>
                <CardDescription>Send any of these straight into Brainstorm Chat.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {r.opportunities.map((o, i) => (
                    <li key={i} className="flex items-start justify-between gap-3 text-sm">
                      <span className="flex gap-2">
                        <span className="text-primary">•</span>
                        {o}
                      </span>
                      <button
                        type="button"
                        onClick={() => opportunityToBrainstorm(o)}
                        className="flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-secondary"
                      >
                        <MessagesSquare className="h-3.5 w-3.5" /> Brainstorm
                      </button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-10">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <History className="h-4 w-4" /> Recent analyses
          </h2>
          <div className="flex flex-wrap gap-2">
            {history.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => setScan(h)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs transition-colors hover:bg-secondary",
                  scan?.id === h.id && "border-primary bg-secondary"
                )}
              >
                {h.platform ? `${h.platform}: ` : ""}
                {h.url}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
