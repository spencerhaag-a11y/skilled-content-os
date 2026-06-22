import { useEffect, useMemo, useState } from "react";
import { BarChart3, Loader2, Download, FileBarChart } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAccountStore } from "@/stores/accountStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface PieceRow {
  type: string;
  status: string;
  created_at: string;
}
interface PushRow {
  pushed_at: string;
}

const LANES = ["draft", "in_review", "approved", "scheduled", "published"] as const;
const LANE_LABEL: Record<string, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  scheduled: "Scheduled",
  published: "Published",
};
const TYPE_LABEL: Record<string, string> = {
  caption: "Captions",
  linkedin_post: "LinkedIn posts",
  email: "Emails",
  blog: "Blog posts",
  reel_script: "Reel scripts",
  carousel: "Carousels",
  story_frames: "Story frames",
  thread: "Threads",
  sms: "SMS",
  gbp_post: "GBP posts",
};

function monthKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short", year: "2-digit" });
}

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 truncate text-sm text-muted-foreground">{label}</span>
      <div className="h-5 flex-1 overflow-hidden rounded bg-secondary">
        <div className="flex h-full items-center rounded bg-primary px-2 text-[11px] font-medium text-primary-foreground" style={{ width: `${Math.max(pct, value > 0 ? 8 : 0)}%` }}>
          {value > 0 ? value : ""}
        </div>
      </div>
    </div>
  );
}

export default function Analytics() {
  const account = useAccountStore((s) => s.account);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pieces, setPieces] = useState<PieceRow[]>([]);
  const [pushes, setPushes] = useState<PushRow[]>([]);
  const [brandScore, setBrandScore] = useState<number | null>(null);
  const [kb, setKb] = useState<{ total: number; filled: number }>({ total: 0, filled: 0 });
  const [promptCount, setPromptCount] = useState(0);

  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [piecesRes, pushRes, brandRes, sectionsRes, filesRes, promptsRes] = await Promise.all([
          supabase.from("content_pieces").select("type, status, created_at").eq("account_id", account.id),
          supabase.from("ghl_push_log").select("pushed_at").eq("account_id", account.id),
          supabase.from("brand_kits").select("score").eq("account_id", account.id).maybeSingle(),
          supabase.from("knowledge_base_sections").select("id").eq("account_id", account.id),
          supabase.from("knowledge_base_files").select("section_id").eq("account_id", account.id),
          supabase.from("prompt_library").select("id", { count: "exact", head: true }).eq("account_id", account.id),
        ]);
        if (cancelled) return;
        if (piecesRes.error) throw new Error(piecesRes.error.message);
        setPieces((piecesRes.data ?? []) as PieceRow[]);
        setPushes((pushRes.data ?? []) as PushRow[]);
        setBrandScore(brandRes.data?.score ?? null);
        const sectionIds = (sectionsRes.data ?? []).map((s) => s.id as string);
        const filledIds = new Set((filesRes.data ?? []).map((f) => f.section_id as string));
        setKb({ total: sectionIds.length, filled: sectionIds.filter((id) => filledIds.has(id)).length });
        setPromptCount(promptsRes.count ?? 0);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load analytics.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account]);

  const byType = useMemo(() => {
    const m = new Map<string, number>();
    pieces.forEach((p) => m.set(p.type, (m.get(p.type) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [pieces]);

  const byMonth = useMemo(() => {
    const m = new Map<string, number>();
    pieces.forEach((p) => m.set(monthKey(p.created_at), (m.get(monthKey(p.created_at)) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-6);
  }, [pieces]);

  const pipeline = useMemo(() => {
    const m = new Map<string, number>();
    pieces.forEach((p) => m.set(p.status, (m.get(p.status) ?? 0) + 1));
    return LANES.map((l) => ({ lane: l, count: m.get(l) ?? 0 }));
  }, [pieces]);

  const pushByWeek = useMemo(() => {
    const m = new Map<string, number>();
    pushes.forEach((p) => {
      const d = new Date(p.pushed_at);
      const onejan = new Date(d.getFullYear(), 0, 1);
      const week = Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
      m.set(`${d.getFullYear()}-W${week}`, (m.get(`${d.getFullYear()}-W${week}`) ?? 0) + 1);
    });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-8);
  }, [pushes]);

  const maxType = Math.max(1, ...byType.map(([, v]) => v));
  const maxMonth = Math.max(1, ...byMonth.map(([, v]) => v));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl pb-12">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
            <p className="text-sm text-muted-foreground">Content volume, pipeline, brand setup, and GHL push history.</p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => window.print()} className="print:hidden">
          <Download className="h-4 w-4" /> Export PDF
        </Button>
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {/* Top metrics */}
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        {[
          { label: "Total content", value: pieces.length },
          { label: "Published", value: pipeline.find((p) => p.lane === "published")?.count ?? 0 },
          { label: "Brand score", value: brandScore !== null ? `${brandScore}%` : "—" },
          { label: "Saved prompts", value: promptCount },
        ].map((m) => (
          <Card key={m.label}>
            <CardContent className="py-5">
              <p className="text-2xl font-bold tabular-nums">{m.value}</p>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{m.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Content by month */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Content created by month</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {byMonth.length === 0 ? (
              <p className="text-sm text-muted-foreground">No content yet.</p>
            ) : (
              byMonth.map(([k, v]) => <Bar key={k} label={monthLabel(k)} value={v} max={maxMonth} />)
            )}
          </CardContent>
        </Card>

        {/* Pipeline */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pipeline status</CardTitle>
            <CardDescription>Kanban lane counts</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-5 gap-2 text-center">
              {pipeline.map((p) => (
                <div key={p.lane} className="rounded-md bg-secondary/50 py-3">
                  <p className="text-xl font-bold tabular-nums">{p.count}</p>
                  <p className="text-[11px] text-muted-foreground">{LANE_LABEL[p.lane]}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Most used (by type) */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Most created content types</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {byType.length === 0 ? (
              <p className="text-sm text-muted-foreground">No content yet.</p>
            ) : (
              byType.slice(0, 8).map(([t, v]) => <Bar key={t} label={TYPE_LABEL[t] ?? t} value={v} max={maxType} />)
            )}
          </CardContent>
        </Card>

        {/* GHL pushes + KB completeness */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">GHL pushes & knowledge base</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="mb-1 text-sm font-medium">GHL pushes (recent weeks)</p>
              {pushByWeek.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing pushed to GHL yet.</p>
              ) : (
                <div className="flex items-end gap-1.5">
                  {pushByWeek.map(([w, v]) => (
                    <div key={w} className="flex flex-1 flex-col items-center gap-1">
                      <div className="w-full rounded-t bg-primary" style={{ height: `${Math.max(8, v * 14)}px` }} title={`${v}`} />
                      <span className="text-[10px] text-muted-foreground">{w.split("-")[1]}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <p className="text-sm font-medium">Knowledge base filled</p>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {kb.filled}/{kb.total}
                </span>
              </div>
              <div className="h-3 overflow-hidden rounded bg-secondary">
                <div className="h-full rounded bg-primary" style={{ width: `${kb.total > 0 ? (kb.filled / kb.total) * 100 : 0}%` }} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {pieces.length === 0 && (
        <div className="mt-8 flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center">
          <FileBarChart className="h-8 w-8 text-muted-foreground/40" />
          <p className="font-medium">No data yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Create content in any module and your analytics populate here automatically.
          </p>
        </div>
      )}
    </div>
  );
}
