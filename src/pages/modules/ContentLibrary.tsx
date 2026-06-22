import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Library as LibraryIcon,
  Loader2,
  X,
  Check,
  Trash2,
  CopyPlus,
  CalendarClock,
  Send,
  History,
  ExternalLink,
  Search,
} from "lucide-react";
import { invokeEdgeFunction, supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/authStore";
import { useAccountStore } from "@/stores/accountStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface Piece {
  id: string;
  type: string;
  platform: string | null;
  title: string;
  body: string;
  status: string;
  pillar: string | null;
  scheduled_at: string | null;
  created_at: string;
}

interface Version {
  id: string;
  title: string;
  body: string;
  status: string;
  created_at: string;
}

interface AssetRow {
  id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  file_url: string;
  created_at: string;
  sectionTitle: string;
}

const STATUSES = ["draft", "in_review", "approved", "scheduled", "published"];

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-secondary text-secondary-foreground",
  in_review: "bg-amber-100 text-amber-800",
  approved: "bg-accent text-accent-foreground",
  scheduled: "bg-blue-100 text-blue-800",
  published: "bg-primary text-primary-foreground",
};

const TYPE_LABELS: Record<string, string> = {
  caption: "Caption",
  linkedin_post: "LinkedIn",
  email: "Email",
  blog: "Blog",
  reel_script: "Reel",
  carousel: "Carousel",
  story_frames: "Stories",
  thread: "Thread",
  testimonial_block: "Testimonial",
  sms: "SMS",
  gbp_post: "GBP",
};

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export default function ContentLibrary() {
  const user = useAuthStore((s) => s.user);
  const account = useAccountStore((s) => s.account);

  const [tab, setTab] = useState<"content" | "assets">("content");
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [platformFilter, setPlatformFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [pillarFilter, setPillarFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [bulkRescheduleOpen, setBulkRescheduleOpen] = useState(false);
  const [bulkScheduleAt, setBulkScheduleAt] = useState("");
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);

  const [selected, setSelected] = useState<Piece | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editStatus, setEditStatus] = useState("draft");
  const [versions, setVersions] = useState<Version[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [modalBusy, setModalBusy] = useState(false);

  const load = useCallback(async (accountId: string) => {
    setLoading(true);
    const [piecesRes, sectionsRes, filesRes] = await Promise.all([
      supabase
        .from("content_pieces")
        .select("id, type, platform, title, body, status, pillar, scheduled_at, created_at")
        .eq("account_id", accountId)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("knowledge_base_sections")
        .select("id, title")
        .eq("account_id", accountId),
      supabase
        .from("knowledge_base_files")
        .select("id, section_id, file_name, file_type, file_size, file_url, created_at")
        .eq("account_id", accountId)
        .order("created_at", { ascending: false }),
    ]);
    const firstError = piecesRes.error ?? sectionsRes.error ?? filesRes.error;
    if (firstError) setError(firstError.message);
    setPieces((piecesRes.data ?? []) as Piece[]);
    const sectionTitles = new Map(
      ((sectionsRes.data ?? []) as { id: string; title: string }[]).map((s) => [s.id, s.title])
    );
    setAssets(
      ((filesRes.data ?? []) as (AssetRow & { section_id: string })[]).map((f) => ({
        ...f,
        sectionTitle: sectionTitles.get(f.section_id) ?? "Knowledge base",
      }))
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    if (account) void load(account.id);
  }, [account, load]);

  const pillars = useMemo(
    () => Array.from(new Set(pieces.map((p) => p.pillar).filter(Boolean))) as string[],
    [pieces]
  );
  const platforms = useMemo(
    () => Array.from(new Set(pieces.map((p) => p.platform).filter(Boolean))) as string[],
    [pieces]
  );
  const types = useMemo(() => Array.from(new Set(pieces.map((p) => p.type))), [pieces]);

  const visible = pieces.filter((p) => {
    if (typeFilter && p.type !== typeFilter) return false;
    if (platformFilter && p.platform !== platformFilter) return false;
    if (statusFilter && p.status !== statusFilter) return false;
    if (pillarFilter && p.pillar !== pillarFilter) return false;
    if (dateFrom && new Date(p.created_at) < new Date(dateFrom)) return false;
    if (dateTo && new Date(p.created_at) > new Date(`${dateTo}T23:59:59`)) return false;
    if (query) {
      const q = query.toLowerCase();
      if (!p.title.toLowerCase().includes(q) && !p.body.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const allVisibleChecked = visible.length > 0 && visible.every((p) => checked.has(p.id));

  function toggleAll() {
    setChecked(allVisibleChecked ? new Set() : new Set(visible.map((p) => p.id)));
  }

  function toggleOne(id: string) {
    setChecked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const checkedIds = Array.from(checked);

  async function bulkUpdate(update: Record<string, unknown>, label: string) {
    setBulkBusy(label);
    setBulkMessage(null);
    const { error: updateError } = await supabase
      .from("content_pieces")
      .update(update)
      .in("id", checkedIds);
    setBulkBusy(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setPieces((arr) =>
      arr.map((p) => (checked.has(p.id) ? ({ ...p, ...update } as Piece) : p))
    );
    setBulkMessage(`${checkedIds.length} pieces ${label}.`);
    setChecked(new Set());
  }

  async function bulkDelete() {
    setBulkBusy("delete");
    setBulkMessage(null);
    const { error: deleteError } = await supabase
      .from("content_pieces")
      .delete()
      .in("id", checkedIds);
    setBulkBusy(null);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setPieces((arr) => arr.filter((p) => !checked.has(p.id)));
    setBulkMessage(`${checkedIds.length} pieces deleted.`);
    setChecked(new Set());
  }

  async function bulkDuplicate() {
    if (!account || !user) return;
    setBulkBusy("duplicate");
    setBulkMessage(null);
    const sources = pieces.filter((p) => checked.has(p.id));
    const copies = sources.map((p) => ({
      account_id: account.id,
      created_by: user.id,
      type: p.type,
      platform: p.platform,
      title: `${p.title} (copy)`,
      body: p.body,
      status: "draft",
      pillar: p.pillar,
    }));
    const { data, error: insertError } = await supabase
      .from("content_pieces")
      .insert(copies)
      .select("id, type, platform, title, body, status, pillar, scheduled_at, created_at");
    setBulkBusy(null);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setPieces((arr) => [...((data ?? []) as Piece[]), ...arr]);
    setBulkMessage(`${copies.length} duplicates created as drafts.`);
    setChecked(new Set());
  }

  async function bulkGhlPush() {
    setBulkBusy("ghl");
    setBulkMessage(null);
    let ok = 0;
    let failed = 0;
    for (const id of checkedIds) {
      try {
        await invokeEdgeFunction("ghl-push", { content_piece_id: id });
        ok++;
      } catch {
        failed++;
      }
    }
    setBulkBusy(null);
    setBulkMessage(`GHL push: ${ok} succeeded${failed ? `, ${failed} failed` : ""}.`);
    setChecked(new Set());
  }

  async function openPiece(piece: Piece) {
    setSelected(piece);
    setEditTitle(piece.title);
    setEditBody(piece.body);
    setEditStatus(piece.status);
    setShowVersions(false);
    const { data } = await supabase
      .from("content_versions")
      .select("id, title, body, status, created_at")
      .eq("content_piece_id", piece.id)
      .order("created_at", { ascending: false })
      .limit(25);
    setVersions((data ?? []) as Version[]);
  }

  async function saveSelected() {
    if (!selected) return;
    if (!editTitle.trim() || !editBody.trim()) {
      setError("Title and body can't be empty.");
      return;
    }
    setModalBusy(true);
    const update = { title: editTitle.trim(), body: editBody, status: editStatus };
    const { error: updateError } = await supabase
      .from("content_pieces")
      .update(update)
      .eq("id", selected.id);
    setModalBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setPieces((arr) => arr.map((p) => (p.id === selected.id ? { ...p, ...update } : p)));
    setSelected(null);
  }

  function restoreVersion(v: Version) {
    // Restoring loads the snapshot into the editor; saving snapshots the
    // current state first via the DB trigger — nothing is ever lost.
    setEditTitle(v.title);
    setEditBody(v.body);
    setShowVersions(false);
  }

  async function openAsset(asset: AssetRow) {
    const { data } = await supabase.storage
      .from("knowledge-base")
      .createSignedUrl(asset.file_url, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl pb-24">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <LibraryIcon className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Content Library</h1>
          <p className="text-sm text-muted-foreground">
            Everything you've created, searchable — plus every asset on the account.
          </p>
        </div>
      </div>

      <div className="mb-6 flex w-full max-w-xs rounded-lg border p-1">
        {(
          [
            ["content", `Content (${pieces.length})`],
            ["assets", `Assets (${assets.length})`],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              tab === value ? "bg-primary text-primary-foreground" : "hover:bg-secondary"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {tab === "content" && (
        <>
          {/* ── Search + filters ── */}
          <div className="mb-4 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search titles and content…"
                className="pl-9"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" aria-label="Type">
                <option value="">All types</option>
                {types.map((t) => (
                  <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>
                ))}
              </select>
              <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" aria-label="Platform">
                <option value="">All platforms</option>
                {platforms.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" aria-label="Status">
                <option value="">All statuses</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                ))}
              </select>
              <select value={pillarFilter} onChange={(e) => setPillarFilter(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" aria-label="Pillar">
                <option value="">All pillars</option>
                {pillars.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" aria-label="From date" />
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" aria-label="To date" />
            </div>
          </div>

          {/* ── List ── */}
          <div className="overflow-hidden rounded-lg border">
            <div className="flex items-center gap-3 border-b bg-secondary/40 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <input
                type="checkbox"
                checked={allVisibleChecked}
                onChange={toggleAll}
                className="h-4 w-4 accent-[hsl(var(--primary))]"
                aria-label="Select all"
              />
              <span>{visible.length} pieces</span>
            </div>
            {visible.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                Nothing matches. Adjust filters or create content.
              </p>
            ) : (
              <ul className="divide-y">
                {visible.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-secondary/30">
                    <input
                      type="checkbox"
                      checked={checked.has(p.id)}
                      onChange={() => toggleOne(p.id)}
                      className="h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
                      aria-label={`Select ${p.title}`}
                    />
                    <button
                      type="button"
                      onClick={() => void openPiece(p)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="truncate text-sm font-medium">{p.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {TYPE_LABELS[p.type] ?? p.type}
                        {p.platform ? ` · ${p.platform}` : ""}
                        {p.pillar ? ` · ${p.pillar}` : ""} ·{" "}
                        {new Date(p.created_at).toLocaleDateString()}
                      </p>
                    </button>
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_STYLES[p.status])}>
                      {p.status.replace(/_/g, " ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {bulkMessage && <p className="mt-3 text-sm text-primary">{bulkMessage}</p>}

          {/* ── Bulk action bar ── */}
          {checkedIds.length > 0 && (
            <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 px-4 py-3 backdrop-blur lg:left-64">
              <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2">
                <span className="mr-2 text-sm font-medium">{checkedIds.length} selected</span>
                <Button size="sm" disabled={bulkBusy !== null} onClick={() => void bulkUpdate({ status: "approved" }, "approved")}>
                  {bulkBusy === "approved" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Approve
                </Button>
                <Button size="sm" variant="outline" disabled={bulkBusy !== null} onClick={() => setBulkRescheduleOpen(true)}>
                  <CalendarClock className="h-4 w-4" />
                  Reschedule
                </Button>
                <Button size="sm" variant="outline" disabled={bulkBusy !== null} onClick={() => void bulkDuplicate()}>
                  {bulkBusy === "duplicate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CopyPlus className="h-4 w-4" />}
                  Duplicate
                </Button>
                {account?.ghl_connected && (
                  <Button size="sm" variant="outline" disabled={bulkBusy !== null} onClick={() => void bulkGhlPush()}>
                    {bulkBusy === "ghl" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Push to GHL
                  </Button>
                )}
                <Button size="sm" variant="ghost" disabled={bulkBusy !== null} onClick={() => void bulkDelete()} className="text-destructive hover:bg-destructive/10 hover:text-destructive">
                  {bulkBusy === "delete" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Delete
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setChecked(new Set())}>
                  Clear
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Asset manager ── */}
      {tab === "assets" && (
        <div className="overflow-hidden rounded-lg border">
          {assets.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              No assets yet. Upload files in the Knowledge Base.
            </p>
          ) : (
            <ul className="divide-y">
              {assets.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{a.file_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.sectionTitle} · {a.file_type.toUpperCase()} · {formatBytes(a.file_size)} ·{" "}
                      {new Date(a.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void openAsset(a)}
                    className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                    aria-label={`Open ${a.file_name}`}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Detail / editor modal ── */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-10" onClick={() => setSelected(null)}>
          <div className="w-full max-w-2xl rounded-lg border bg-background shadow-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="flex items-center justify-between border-b p-4">
              <h2 className="text-base font-semibold">Edit content</h2>
              <button type="button" onClick={() => setSelected(null)} className="rounded p-1.5 text-muted-foreground hover:bg-secondary" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[75vh] space-y-4 overflow-y-auto p-4">
              <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                <div className="space-y-1.5">
                  <Label htmlFor="lib-title">Title</Label>
                  <Input id="lib-title" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lib-status">Status</Label>
                  <select id="lib-status" value={editStatus} onChange={(e) => setEditStatus(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lib-body">Content</Label>
                <Textarea id="lib-body" value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={14} className="text-sm" />
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => setShowVersions((v) => !v)}
                  className="flex items-center gap-1.5 text-sm font-medium text-primary"
                >
                  <History className="h-4 w-4" />
                  Version history ({versions.length})
                </button>
                {showVersions && (
                  <ul className="mt-2 space-y-2">
                    {versions.length === 0 && (
                      <li className="text-sm text-muted-foreground">
                        No previous versions — every save from now on is snapshotted.
                      </li>
                    )}
                    {versions.map((v) => (
                      <li key={v.id} className="rounded-md border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs text-muted-foreground">
                            {new Date(v.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}{" "}
                            · {v.status.replace(/_/g, " ")}
                          </p>
                          <Button type="button" variant="outline" size="sm" onClick={() => restoreVersion(v)}>
                            Restore
                          </Button>
                        </div>
                        <p className="mt-1 truncate text-sm font-medium">{v.title}</p>
                        <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">{v.body}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex justify-end gap-2 border-t pt-4">
                <Button type="button" variant="ghost" onClick={() => setSelected(null)}>Cancel</Button>
                <Button type="button" onClick={() => void saveSelected()} disabled={modalBusy}>
                  {modalBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Save
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk reschedule modal ── */}
      {bulkRescheduleOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setBulkRescheduleOpen(false)}>
          <div className="w-full max-w-sm rounded-lg border bg-background p-5 shadow-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="mb-4 text-base font-semibold">Reschedule {checkedIds.length} pieces</h2>
            <div className="space-y-1.5">
              <Label htmlFor="bulk-schedule">New date & time</Label>
              <input
                id="bulk-schedule"
                type="datetime-local"
                value={bulkScheduleAt}
                onChange={(e) => setBulkScheduleAt(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setBulkRescheduleOpen(false)}>Cancel</Button>
              <Button
                type="button"
                disabled={!bulkScheduleAt}
                onClick={() => {
                  void bulkUpdate(
                    { status: "scheduled", scheduled_at: new Date(bulkScheduleAt).toISOString() },
                    "rescheduled"
                  );
                  setBulkRescheduleOpen(false);
                }}
              >
                <CalendarClock className="h-4 w-4" />
                Reschedule
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
