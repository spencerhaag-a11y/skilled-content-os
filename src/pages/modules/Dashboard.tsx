import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Loader2,
  ArrowRight,
  Check,
  FileText,
  CheckCircle2,
  Send,
  Layers,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/authStore";
import { useAccountStore } from "@/stores/accountStore";
import { useBrandKitStore } from "@/stores/brandKitStore";
import { useKnowledgeBaseStore } from "@/stores/knowledgeBaseStore";
import { MODULES } from "@/lib/modules";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface ContentRow {
  id: string;
  type: string;
  platform: string | null;
  title: string;
  status: string;
  created_at: string;
}

interface Metrics {
  total: number;
  drafts: number;
  approved: number;
  publishedThisMonth: number;
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-secondary text-secondary-foreground",
  in_review: "bg-amber-100 text-amber-800",
  approved: "bg-accent text-accent-foreground",
  scheduled: "bg-blue-100 text-blue-800",
  published: "bg-primary text-primary-foreground",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  scheduled: "Scheduled",
  published: "Published",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-medium",
        STATUS_STYLES[status] ?? "bg-secondary"
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

async function countContent(accountId: string, filter?: (q: ReturnType<typeof base>) => ReturnType<typeof base>) {
  function base() {
    return supabase
      .from("content_pieces")
      .select("*", { count: "exact", head: true })
      .eq("account_id", accountId);
  }
  const query = filter ? filter(base()) : base();
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export default function Dashboard() {
  const user = useAuthStore((s) => s.user);
  const account = useAccountStore((s) => s.account);
  const profile = useAccountStore((s) => s.profile);

  const brandScore = useBrandKitStore((s) => s.score);
  const brandKitId = useBrandKitStore((s) => s.kitId);
  const brandStatus = useBrandKitStore((s) => s.status);
  const loadBrandKit = useBrandKitStore((s) => s.load);

  const kbSections = useKnowledgeBaseStore((s) => s.sections);
  const kbFiles = useKnowledgeBaseStore((s) => s.filesBySection);
  const kbStatus = useKnowledgeBaseStore((s) => s.status);
  const loadKb = useKnowledgeBaseStore((s) => s.load);

  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [recent, setRecent] = useState<ContentRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!account) return;
    if (brandStatus === "idle") void loadBrandKit(account.id);
    if (kbStatus === "idle") void loadKb(account.id);

    let cancelled = false;
    async function loadMetrics(accountId: string) {
      try {
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);

        const [total, drafts, approved, publishedThisMonth, recentRes] = await Promise.all([
          countContent(accountId),
          countContent(accountId, (q) => q.eq("status", "draft")),
          countContent(accountId, (q) => q.in("status", ["approved", "scheduled"])),
          countContent(accountId, (q) =>
            q.eq("status", "published").gte("published_at", monthStart.toISOString())
          ),
          supabase
            .from("content_pieces")
            .select("id, type, platform, title, status, created_at")
            .eq("account_id", accountId)
            .order("created_at", { ascending: false })
            .limit(8),
        ]);
        if (recentRes.error) throw new Error(recentRes.error.message);
        if (!cancelled) {
          setMetrics({ total, drafts, approved, publishedThisMonth });
          setRecent((recentRes.data ?? []) as ContentRow[]);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Failed to load dashboard data.");
        }
      }
    }
    void loadMetrics(account.id);
    return () => {
      cancelled = true;
    };
  }, [account, brandStatus, kbStatus, loadBrandKit, loadKb]);

  if (!account) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const kbFilled = kbSections.filter((s) => (kbFiles[s.id] ?? []).length > 0).length;

  const setupSteps = [
    {
      label: "Complete your brand kit",
      detail: brandKitId ? `Brand score ${brandScore}%` : "Not started",
      done: brandScore >= 70,
      to: "/brand-kit",
    },
    {
      label: "Fill your knowledge base",
      detail: `${kbFilled}/${kbSections.length || 11} sections have files`,
      done: kbFilled >= 3,
      to: "/knowledge-base",
    },
    {
      label: "Connect GoHighLevel",
      detail: account.ghl_connected ? "Connected" : "Not connected",
      done: account.ghl_connected === true,
      to: "/settings",
    },
    {
      label: "Create your first content",
      detail: metrics ? `${metrics.total} pieces created` : "—",
      done: (metrics?.total ?? 0) > 0,
      to: "/repurpose",
    },
  ];
  const setupDone = setupSteps.filter((s) => s.done).length;

  const firstName =
    profile?.full_name?.split(" ")[0] || user?.email?.split("@")[0] || "there";

  const quickModules = MODULES.filter((m) =>
    ["/repurpose", "/social-posts", "/blog-posts", "/email", "/brainstorm", "/video"].includes(
      m.path
    )
  );

  const statTiles = [
    { label: "Total content", value: metrics?.total, icon: Layers },
    { label: "Drafts", value: metrics?.drafts, icon: FileText },
    { label: "Approved / scheduled", value: metrics?.approved, icon: CheckCircle2 },
    { label: "Published this month", value: metrics?.publishedThisMonth, icon: Send },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome back, {firstName}
        </h1>
        <p className="text-sm text-muted-foreground">
          Here's where {account.white_label_name || account.name} stands today.
        </p>
      </div>

      {loadError && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {loadError}
        </p>
      )}

      {/* ── Metrics ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {statTiles.map((tile) => (
          <Card key={tile.label}>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <tile.icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xl font-semibold tabular-nums leading-tight">
                  {tile.value ?? "—"}
                </p>
                <p className="truncate text-xs text-muted-foreground">{tile.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* ── Setup progress + brand score ── */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Setup progress</CardTitle>
            <CardDescription>
              {setupDone}/{setupSteps.length} complete — finish setup to unlock full content
              quality.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {setupSteps.map((step) => (
              <Link
                key={step.label}
                to={step.to}
                className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-secondary"
              >
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                    step.done
                      ? "bg-primary text-primary-foreground"
                      : "border border-input"
                  )}
                >
                  {step.done && <Check className="h-3 w-3" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{step.label}</span>
                  <span className="block text-xs text-muted-foreground">{step.detail}</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}

            <div className="mt-3 rounded-md border bg-secondary/40 px-3 py-3">
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span className="font-medium">Brand score</span>
                <span className="font-semibold tabular-nums">{brandScore}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${brandScore}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Recent content feed ── */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent content</CardTitle>
            <CardDescription>The latest pieces created across every module.</CardDescription>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <div className="rounded-md border border-dashed px-4 py-8 text-center">
                <p className="text-sm font-medium">Nothing created yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Start with the{" "}
                  <Link to="/repurpose" className="text-primary underline-offset-4 hover:underline">
                    Repurposing Engine
                  </Link>{" "}
                  — one input becomes a full content suite.
                </p>
              </div>
            ) : (
              <ul className="divide-y">
                {recent.map((piece) => (
                  <li key={piece.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{piece.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {piece.type.replace(/_/g, " ")}
                        {piece.platform ? ` · ${piece.platform}` : ""} ·{" "}
                        {new Date(piece.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <StatusBadge status={piece.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Module quick links ── */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Create something
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {quickModules.map((m) => (
            <Link key={m.path} to={m.path}>
              <Card className="h-full transition-colors hover:border-primary/50">
                <CardContent className="p-4">
                  <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <m.icon className="h-4 w-4" />
                  </div>
                  <p className="text-sm font-medium">{m.name}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {m.description}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
