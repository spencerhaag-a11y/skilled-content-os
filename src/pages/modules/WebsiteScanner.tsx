import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Globe,
  Loader2,
  AlertTriangle,
  Target,
  MessagesSquare,
  History,
  Tag,
} from "lucide-react";
import { invokeEdgeFunction, supabase } from "@/lib/supabase";
import { useAccountStore } from "@/stores/accountStore";
import { useHandoffStore } from "@/stores/handoffStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface ScanResults {
  summary: {
    business_name: string;
    services: string[];
    tone: string;
    audience: string;
    keywords: string[];
  };
  issues: {
    missing_pages: string[];
    weak_ctas: string[];
    seo_gaps: string[];
    thin_content: string[];
  };
  positioning?: string;
}
interface Scan {
  id: string;
  url: string;
  scan_type: "website" | "competitor";
  results_json: ScanResults;
  created_at: string;
}

const ISSUE_GROUPS: { key: keyof ScanResults["issues"]; label: string }[] = [
  { key: "missing_pages", label: "Missing pages" },
  { key: "weak_ctas", label: "Weak CTAs" },
  { key: "seo_gaps", label: "SEO gaps" },
  { key: "thin_content", label: "Thin content" },
];

export default function WebsiteScanner() {
  const account = useAccountStore((s) => s.account);
  const send = useHandoffStore((s) => s.send);
  const navigate = useNavigate();

  const [url, setUrl] = useState("");
  const [scanType, setScanType] = useState<"website" | "competitor">("website");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [history, setHistory] = useState<Scan[]>([]);

  useEffect(() => {
    if (!account) return;
    void supabase
      .from("scan_history")
      .select("id, url, scan_type, results_json, created_at")
      .eq("account_id", account.id)
      .in("scan_type", ["website", "competitor"])
      .order("created_at", { ascending: false })
      .limit(10)
      .then(({ data }) => setHistory((data ?? []) as Scan[]));
  }, [account]);

  async function handleScan() {
    setError(null);
    if (url.trim().length < 3) {
      setError("Enter a website URL.");
      return;
    }
    setLoading(true);
    setScan(null);
    try {
      const { scan: s } = await invokeEdgeFunction<{ scan: Scan }>("website-scanner", {
        url: url.trim(),
        scan_type: scanType,
      });
      setScan(s);
      setHistory((h) => [s, ...h].slice(0, 10));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed.");
    } finally {
      setLoading(false);
    }
  }

  function sendToBrainstorm() {
    if (!scan) return;
    const r = scan.results_json;
    const body =
      `Brand summary scanned from ${scan.url}:\n` +
      `Business: ${r.summary.business_name}\n` +
      `Services: ${r.summary.services.join(", ")}\n` +
      `Audience: ${r.summary.audience}\n` +
      `Tone: ${r.summary.tone}\n` +
      `Keywords: ${r.summary.keywords.join(", ")}`;
    send({ target: "/brainstorm", body, source: "Website Scanner" });
    navigate("/brainstorm");
  }

  const r = scan?.results_json;

  return (
    <div className="mx-auto max-w-3xl pb-12">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Globe className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Website Scanner</h1>
          <p className="text-sm text-muted-foreground">
            Scan any URL for brand signals, content gaps, and — in competitor mode — positioning.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scan a site</CardTitle>
          <CardDescription>Your own site to audit it, or a competitor to read their positioning.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(["website", "competitor"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setScanType(t)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm transition-colors",
                  scanType === t ? "border-primary bg-primary text-primary-foreground" : "hover:bg-secondary"
                )}
              >
                {t === "website" ? "My site" : "Competitor"}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleScan()}
              placeholder="example.com"
              aria-label="Website URL"
            />
            <Button onClick={() => void handleScan()} disabled={loading} className="shrink-0">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? "Scanning…" : "Scan"}
            </Button>
          </div>
          {loading && (
            <p className="text-sm text-muted-foreground">Reading the page and analyzing — about 15–30 seconds.</p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {r && (
        <div className="mt-8 space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{r.summary.business_name || scan?.url}</CardTitle>
              <CardDescription>{r.summary.tone}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {r.summary.audience && (
                <p>
                  <span className="font-medium">Audience:</span> {r.summary.audience}
                </p>
              )}
              {r.summary.services.length > 0 && (
                <div>
                  <p className="mb-1 font-medium">Services</p>
                  <div className="flex flex-wrap gap-1.5">
                    {r.summary.services.map((s, i) => (
                      <span key={i} className="rounded-full bg-secondary px-2.5 py-0.5 text-xs">{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {r.summary.keywords.length > 0 && (
                <div>
                  <p className="mb-1 flex items-center gap-1.5 font-medium">
                    <Tag className="h-3.5 w-3.5" /> Keywords
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {r.summary.keywords.map((k, i) => (
                      <span key={i} className="rounded-full border px-2.5 py-0.5 text-xs">{k}</span>
                    ))}
                  </div>
                </div>
              )}
              <Button type="button" variant="outline" size="sm" onClick={sendToBrainstorm}>
                <MessagesSquare className="h-4 w-4" /> Send summary to Brainstorm
              </Button>
            </CardContent>
          </Card>

          {r.positioning && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Target className="h-4 w-4 text-primary" /> Competitor positioning
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed">{r.positioning}</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4 text-amber-500" /> Gaps & opportunities
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              {ISSUE_GROUPS.map(({ key, label }) => {
                const items = r.issues[key];
                return (
                  <div key={key}>
                    <p className="mb-1.5 text-sm font-medium">{label}</p>
                    {items.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Nothing flagged.</p>
                    ) : (
                      <ul className="space-y-1 text-sm">
                        {items.map((it, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="text-amber-500">•</span>
                            {it}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-10">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <History className="h-4 w-4" /> Recent scans
          </h2>
          <div className="flex flex-wrap gap-2">
            {history.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => {
                  setScan(h);
                  setUrl(h.url);
                  setScanType(h.scan_type);
                }}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs transition-colors hover:bg-secondary",
                  scan?.id === h.id && "border-primary bg-secondary"
                )}
              >
                {h.scan_type === "competitor" ? "🔍 " : ""}
                {h.url.replace(/^https?:\/\//, "")}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
