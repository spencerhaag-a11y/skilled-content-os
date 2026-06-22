import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Loader2, FileText, Gauge, Tags, KeyRound, Copy, Check } from "lucide-react";
import { invokeEdgeFunction } from "@/lib/supabase";
import { useHandoffStore } from "@/stores/handoffStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Task = "keyword_research" | "onpage_score" | "meta_generate";

const TABS: { value: Task; label: string; icon: typeof Search }[] = [
  { value: "keyword_research", label: "Keyword research", icon: KeyRound },
  { value: "onpage_score", label: "On-page scorer", icon: Gauge },
  { value: "meta_generate", label: "Meta generator", icon: Tags },
];

interface KeywordRow {
  keyword: string;
  intent: string;
  volume: "low" | "medium" | "high";
  difficulty: number;
}
interface KeywordResults {
  seed: string;
  keywords: KeywordRow[];
  clusters: { name: string; keywords: string[] }[];
}
interface OnpageResults {
  url: string;
  score: number;
  found: { title: string; meta_description: string; h1: string; word_count_estimate: number };
  actions: { priority: "high" | "medium" | "low"; action: string }[];
}
interface MetaResults {
  titles: string[];
  meta_descriptions: string[];
}

const VOLUME_STYLE: Record<string, string> = {
  high: "bg-accent text-accent-foreground",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-secondary text-secondary-foreground",
};
const PRIORITY_STYLE: Record<string, string> = {
  high: "bg-destructive/10 text-destructive",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-secondary text-secondary-foreground",
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
      aria-label="Copy"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export default function SeoTools() {
  const navigate = useNavigate();
  const send = useHandoffStore((s) => s.send);

  const [task, setTask] = useState<Task>("keyword_research");
  const [input, setInput] = useState("");
  const [url, setUrl] = useState("");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<unknown>(null);

  async function run() {
    setError(null);
    setResults(null);
    setLoading(true);
    try {
      const payload: Record<string, unknown> = { task };
      if (task === "onpage_score") payload.url = url.trim();
      else payload.input = input.trim();
      if (task === "meta_generate" && keyword.trim()) payload.keyword = keyword.trim();

      const res = await invokeEdgeFunction<{ task: Task; results: unknown }>("seo-tools", payload);
      setResults(res.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "SEO task failed.");
    } finally {
      setLoading(false);
    }
  }

  function writeBlog(kw: string) {
    send({ target: "/blog-posts", topic: kw, source: "SEO Tools" });
    navigate("/blog-posts");
  }

  return (
    <div className="mx-auto max-w-3xl pb-12">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Search className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">SEO Tools</h1>
          <p className="text-sm text-muted-foreground">
            Keyword research, on-page scoring, and meta generation. Volumes are AI estimates, not
            live search data.
          </p>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => {
              setTask(t.value);
              setResults(null);
              setError(null);
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
              task === t.value ? "border-primary bg-primary text-primary-foreground" : "hover:bg-secondary"
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="space-y-4 py-5">
          {task === "onpage_score" ? (
            <div className="space-y-1.5">
              <Label htmlFor="seo-url">Page URL</Label>
              <Input id="seo-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="example.com/services" />
            </div>
          ) : task === "keyword_research" ? (
            <div className="space-y-1.5">
              <Label htmlFor="seo-seed">Seed keyword</Label>
              <Input id="seo-seed" value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. hockey return to sport" />
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="seo-topic">Page topic</Label>
                <Input id="seo-topic" value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. ACL rehab program" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="seo-kw">Primary keyword (optional)</Label>
                <Input id="seo-kw" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="e.g. ACL recovery timeline" />
              </div>
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={() => void run()} disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? "Working…" : "Run"}
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {/* Keyword research results */}
      {results !== null && task === "keyword_research" && (
        <div className="mt-6 space-y-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Keywords</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Keyword</th>
                      <th className="py-2 pr-4 font-medium">Intent</th>
                      <th className="py-2 pr-4 font-medium">Volume</th>
                      <th className="py-2 pr-4 font-medium">Difficulty</th>
                      <th className="py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(results as KeywordResults).keywords.map((k, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-2 pr-4 font-medium">{k.keyword}</td>
                        <td className="py-2 pr-4 text-muted-foreground">{k.intent}</td>
                        <td className="py-2 pr-4">
                          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", VOLUME_STYLE[k.volume] ?? VOLUME_STYLE.low)}>
                            {k.volume}
                          </span>
                        </td>
                        <td className="py-2 pr-4 tabular-nums">{k.difficulty}</td>
                        <td className="py-2 text-right">
                          <button type="button" onClick={() => writeBlog(k.keyword)} className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-secondary">
                            <FileText className="h-3.5 w-3.5" /> Blog
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
          {(results as KeywordResults).clusters?.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Topical clusters</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(results as KeywordResults).clusters.map((c, i) => (
                  <div key={i}>
                    <p className="mb-1 text-sm font-medium">{c.name}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {c.keywords.map((k, j) => (
                        <span key={j} className="rounded-full bg-secondary px-2.5 py-0.5 text-xs">{k}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* On-page score */}
      {results !== null && task === "onpage_score" && (
        <Card className="mt-6">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">On-page score</CardTitle>
              <span className="text-2xl font-bold tabular-nums text-primary">
                {(results as OnpageResults).score}
                <span className="text-base text-muted-foreground">/100</span>
              </span>
            </div>
            <CardDescription className="truncate">{(results as OnpageResults).url}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-xs uppercase text-muted-foreground">Title</dt><dd>{(results as OnpageResults).found.title || "—"}</dd></div>
              <div><dt className="text-xs uppercase text-muted-foreground">H1</dt><dd>{(results as OnpageResults).found.h1 || "—"}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs uppercase text-muted-foreground">Meta description</dt><dd>{(results as OnpageResults).found.meta_description || "—"}</dd></div>
              <div><dt className="text-xs uppercase text-muted-foreground">Words (est.)</dt><dd className="tabular-nums">{(results as OnpageResults).found.word_count_estimate}</dd></div>
            </dl>
            <div>
              <p className="mb-2 text-sm font-medium">Fixes</p>
              <ul className="space-y-1.5">
                {(results as OnpageResults).actions.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className={cn("mt-0.5 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize", PRIORITY_STYLE[a.priority] ?? PRIORITY_STYLE.low)}>{a.priority}</span>
                    {a.action}
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Meta generator */}
      {results !== null && task === "meta_generate" && (
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Title tags</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(results as MetaResults).titles.map((t, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                  <span className="flex-1">{t}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{t.length}</span>
                  <CopyButton text={t} />
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Meta descriptions</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(results as MetaResults).meta_descriptions.map((m, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                  <span className="flex-1">{m}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{m.length}</span>
                  <CopyButton text={m} />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
