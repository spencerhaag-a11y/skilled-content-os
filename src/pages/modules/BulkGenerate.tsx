import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Layers,
  Loader2,
  Play,
  ListPlus,
  Check,
  Kanban,
  Copy,
  Trash2,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { invokeEdgeFunction, supabase } from "@/lib/supabase";
import { useAccountStore } from "@/stores/accountStore";
import { useBrandKitStore } from "@/stores/brandKitStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const PLATFORMS = ["Instagram", "TikTok", "LinkedIn", "Facebook", "X"];

/** UI label ⇢ generate-social `format` value. Spec formats: single image,
 *  carousel, reel script. */
const FORMATS: { value: string; label: string }[] = [
  { value: "caption", label: "Single image" },
  { value: "carousel", label: "Carousel" },
  { value: "reel_script", label: "Reel script" },
];
const FORMAT_LABEL: Record<string, string> = Object.fromEntries(
  FORMATS.map((f) => [f.value, f.label])
);

interface Piece {
  id: string;
  type: string;
  platform: string | null;
  title: string;
  body: string;
  status: string;
  pillar: string | null;
  created_at: string;
}

type ItemStatus = "pending" | "generating" | "done" | "error";

interface QueueItem {
  id: string;
  topic: string;
  pillar: string; // "" = auto-detect
  format: string;
  status: ItemStatus;
  piece: Piece | null;
  error: string | null;
  approved: boolean;
  approving: boolean;
}

// Stable per-pillar tag color from a small palette (deterministic by name).
const PILLAR_COLORS = [
  "bg-rose-100 text-rose-800",
  "bg-amber-100 text-amber-800",
  "bg-emerald-100 text-emerald-800",
  "bg-sky-100 text-sky-800",
  "bg-violet-100 text-violet-800",
  "bg-teal-100 text-teal-800",
];
function pillarColor(pillar: string): string {
  let hash = 0;
  for (let i = 0; i < pillar.length; i++) hash = (hash * 31 + pillar.charCodeAt(i)) >>> 0;
  return PILLAR_COLORS[hash % PILLAR_COLORS.length];
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export default function BulkGenerate() {
  const account = useAccountStore((s) => s.account);
  const pillars = useBrandKitStore((s) => s.kit.pillars);
  const brandStatus = useBrandKitStore((s) => s.status);
  const loadBrandKit = useBrandKitStore((s) => s.load);

  const [raw, setRaw] = useState("");
  const [defaultPlatform, setDefaultPlatform] = useState("Instagram");
  const [defaultPillar, setDefaultPillar] = useState("");
  const [defaultFormat, setDefaultFormat] = useState("caption");

  const [items, setItems] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (account && brandStatus === "idle") void loadBrandKit(account.id);
  }, [account, brandStatus, loadBrandKit]);

  const parsedPreview = useMemo(
    () => raw.split("\n").map((l) => l.trim()).filter(Boolean),
    [raw]
  );

  function loadList() {
    setError(null);
    const topics = parsedPreview;
    if (topics.length === 0) {
      setError("Paste at least one topic (one per line).");
      return;
    }
    setItems(
      topics.map((topic) => ({
        id: newId(),
        topic,
        pillar: defaultPillar,
        format: defaultFormat,
        status: "pending",
        piece: null,
        error: null,
        approved: false,
        approving: false,
      }))
    );
    setDoneCount(0);
  }

  function patchItem(id: string, patch: Partial<QueueItem>) {
    setItems((arr) => arr.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  function removeItem(id: string) {
    setItems((arr) => arr.filter((it) => it.id !== id));
  }

  /** Apply the current global defaults to every item that hasn't generated yet. */
  function applyDefaults() {
    setItems((arr) =>
      arr.map((it) =>
        it.status === "done"
          ? it
          : { ...it, pillar: defaultPillar, format: defaultFormat }
      )
    );
  }

  async function generateAll() {
    if (!account || items.length === 0 || running) return;
    setRunning(true);
    setError(null);
    // Re-run only items that haven't succeeded yet.
    const queue = items.filter((it) => it.status !== "done");
    setDoneCount(items.length - queue.length);

    for (const item of queue) {
      patchItem(item.id, { status: "generating", error: null });
      try {
        const { piece } = await invokeEdgeFunction<{ piece: Piece }>("generate-social", {
          platform: defaultPlatform,
          format: item.format,
          pillar: item.pillar || undefined,
          topic: item.topic,
        });
        patchItem(item.id, { status: "done", piece });
      } catch (err) {
        patchItem(item.id, {
          status: "error",
          error: err instanceof Error ? err.message : "Generation failed.",
        });
      }
      setDoneCount((c) => c + 1);
    }
    setRunning(false);
  }

  async function approve(item: QueueItem) {
    if (!item.piece || item.approved) return;
    patchItem(item.id, { approving: true });
    const { error: updateError } = await supabase
      .from("content_pieces")
      .update({ status: "in_review" })
      .eq("id", item.piece.id);
    if (updateError) {
      patchItem(item.id, { approving: false, error: updateError.message });
      return;
    }
    patchItem(item.id, {
      approving: false,
      approved: true,
      piece: { ...item.piece, status: "in_review" },
    });
  }

  async function copyApproved() {
    const approved = items.filter((it) => it.approved && it.piece);
    if (approved.length === 0) return;
    const text = approved
      .map((it) => {
        const p = it.piece!;
        const tag = it.pillar ? ` [${it.pillar}]` : "";
        return `# ${p.title}${tag}\nTopic: ${it.topic}\nPlatform: ${p.platform} · ${FORMAT_LABEL[p.type] ?? p.type}\n\n${p.body}`;
      })
      .join("\n\n———\n\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const total = items.length;
  const generatedCount = items.filter((it) => it.status === "done").length;
  const approvedCount = items.filter((it) => it.approved).length;

  return (
    <div className="mx-auto max-w-3xl pb-12">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Layers className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bulk Generate</h1>
          <p className="text-sm text-muted-foreground">
            Paste a list of topics, set a pillar and format for each, and generate every post in
            one run.
          </p>
        </div>
      </div>

      {/* ── Step 1 — topics + global defaults ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1 · Topics</CardTitle>
          <CardDescription>One topic per line. Defaults below apply to each new item.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={7}
            placeholder={"off-season ankle stability\nwhy athletes skip rehab\nreturn-to-sport testing explained"}
            aria-label="Topic list"
          />

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="def-platform">Platform</Label>
              <select
                id="def-platform"
                value={defaultPlatform}
                onChange={(e) => setDefaultPlatform(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="def-pillar">Default pillar</Label>
              <select
                id="def-pillar"
                value={defaultPillar}
                onChange={(e) => setDefaultPillar(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Auto-detect</option>
                {pillars.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="def-format">Default format</Label>
              <select
                id="def-format"
                value={defaultFormat}
                onChange={(e) => setDefaultFormat(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={loadList} disabled={parsedPreview.length === 0}>
              <ListPlus className="h-4 w-4" />
              {items.length > 0 ? "Rebuild queue" : "Load topics"}
            </Button>
            {parsedPreview.length > 0 && (
              <span className="text-sm text-muted-foreground">
                {parsedPreview.length} topic{parsedPreview.length === 1 ? "" : "s"} detected
              </span>
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {/* ── Step 2 — per-item pillar/format ── */}
      {items.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">2 · Review queue ({items.length})</CardTitle>
                <CardDescription>Override the pillar or format on any item.</CardDescription>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={applyDefaults} disabled={running}>
                <RefreshCw className="h-4 w-4" />
                Apply defaults to all
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {items.map((item) => (
              <div key={item.id} className="rounded-md border p-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{item.topic}</p>
                  </div>
                  <StatusPill item={item} />
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    disabled={running}
                    className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                    aria-label="Remove item"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  <select
                    value={item.pillar}
                    onChange={(e) => patchItem(item.id, { pillar: e.target.value })}
                    disabled={running || item.status === "done"}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                    aria-label={`Pillar for ${item.topic}`}
                  >
                    <option value="">Auto-detect pillar</option>
                    {pillars.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <select
                    value={item.format}
                    onChange={(e) => patchItem(item.id, { format: e.target.value })}
                    disabled={running || item.status === "done"}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                    aria-label={`Format for ${item.topic}`}
                  >
                    {FORMATS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>

                {item.error && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5" /> {item.error}
                  </p>
                )}

                {/* ── Step 3 result ── */}
                {item.piece && (
                  <div className="mt-3 rounded-md border bg-secondary/30 p-3">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {item.piece.platform} · {FORMAT_LABEL[item.piece.type] ?? item.piece.type}
                      </span>
                      {item.piece.pillar && (
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] font-medium",
                            pillarColor(item.piece.pillar)
                          )}
                        >
                          {item.piece.pillar}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium">{item.piece.title}</p>
                    <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed">
                      {item.piece.body}
                    </pre>
                    <div className="mt-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={item.approved ? "outline" : "default"}
                        onClick={() => void approve(item)}
                        disabled={item.approving || item.approved}
                      >
                        {item.approving ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : item.approved ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Kanban className="h-4 w-4" />
                        )}
                        {item.approved ? "On the board" : "Approve → board"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Step 3 controls — sticky action bar ── */}
      {items.length > 0 && (
        <div className="sticky bottom-0 z-10 mt-6 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur lg:-mx-8 lg:px-8">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              {running ? (
                <span className="flex items-center gap-2 font-medium text-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Generating {doneCount} of {total}…
                </span>
              ) : (
                <>
                  {generatedCount}/{total} generated · {approvedCount} approved
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void copyApproved()} disabled={approvedCount === 0}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied" : `Export all (${approvedCount})`}
              </Button>
              <Button type="button" onClick={() => void generateAll()} disabled={running || total === 0}>
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {generatedCount === total ? "Regenerate remaining" : "Generate all"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {items.some((it) => it.approved) && (
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Approved posts are in review on the{" "}
          <Link to="/kanban" className="text-primary underline-offset-4 hover:underline">
            approval board
          </Link>{" "}
          and in your{" "}
          <Link to="/library" className="text-primary underline-offset-4 hover:underline">
            content library
          </Link>
          .
        </p>
      )}
    </div>
  );
}

function StatusPill({ item }: { item: QueueItem }) {
  const map: Record<ItemStatus, { label: string; cls: string }> = {
    pending: { label: "Queued", cls: "bg-secondary text-secondary-foreground" },
    generating: { label: "Generating…", cls: "bg-amber-100 text-amber-800" },
    done: { label: "Generated", cls: "bg-accent text-accent-foreground" },
    error: { label: "Failed", cls: "bg-destructive/10 text-destructive" },
  };
  const { label, cls } = map[item.status];
  return (
    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", cls)}>
      {label}
    </span>
  );
}
