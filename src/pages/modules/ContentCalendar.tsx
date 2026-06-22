import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
  X,
  Check,
  Download,
  Printer,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAccountStore } from "@/stores/accountStore";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
  published_at: string | null;
}

const STATUS_DOTS: Record<string, string> = {
  draft: "bg-zinc-400",
  in_review: "bg-amber-500",
  approved: "bg-emerald-500",
  scheduled: "bg-blue-500",
  published: "bg-primary",
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

// ── date helpers (no external dep) ──────────────────────────────────────────
function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay()); // Sunday start
  return x;
}
function monthGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function pieceDate(p: Piece): Date | null {
  const iso = p.scheduled_at ?? p.published_at;
  return iso ? new Date(iso) : null;
}

// ── components ──────────────────────────────────────────────────────────────
function CalCard({ piece, onOpen }: { piece: Piece; onOpen: (p: Piece) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: piece.id,
  });
  const date = pieceDate(piece);
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => {
        if (!isDragging) onOpen(piece);
      }}
      style={
        transform
          ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 40 }
          : undefined
      }
      className={cn(
        "cursor-grab rounded border bg-card px-1.5 py-1 text-[11px] leading-tight shadow-sm transition-shadow hover:shadow",
        isDragging && "cursor-grabbing opacity-90 shadow-lg"
      )}
      title={piece.title}
    >
      <span className="flex items-center gap-1">
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOTS[piece.status])} />
        <span className="truncate font-medium">{piece.title}</span>
      </span>
      <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
        {date?.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        {piece.platform ? ` · ${piece.platform}` : ""} · {TYPE_LABELS[piece.type] ?? piece.type}
      </span>
    </div>
  );
}

function DayCell({
  day,
  inMonth,
  pieces,
  onOpen,
  tall,
}: {
  day: Date;
  inMonth: boolean;
  pieces: Piece[];
  onOpen: (p: Piece) => void;
  tall?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dayKey(day) });
  const today = isSameDay(day, new Date());
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col gap-1 border-b border-r p-1.5 transition-colors",
        tall ? "min-h-[60vh]" : "min-h-[96px]",
        !inMonth && "bg-secondary/30 text-muted-foreground",
        isOver && "bg-accent"
      )}
    >
      <span
        className={cn(
          "self-end text-[11px] font-medium tabular-nums",
          today &&
            "flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
        )}
      >
        {day.getDate()}
      </span>
      {pieces.map((p) => (
        <CalCard key={p.id} piece={p} onOpen={onOpen} />
      ))}
    </div>
  );
}

export default function ContentCalendar() {
  const account = useAccountStore((s) => s.account);
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<"month" | "week">("month");
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [platformFilter, setPlatformFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [selected, setSelected] = useState<Piece | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    async function load(accountId: string) {
      setLoading(true);
      const { data, error: loadError } = await supabase
        .from("content_pieces")
        .select("id, type, platform, title, body, status, pillar, scheduled_at, published_at")
        .eq("account_id", accountId)
        .or("scheduled_at.not.is.null,published_at.not.is.null");
      if (cancelled) return;
      if (loadError) setError(loadError.message);
      else setPieces((data ?? []) as Piece[]);
      setLoading(false);
    }
    void load(account.id);
    return () => {
      cancelled = true;
    };
  }, [account]);

  const days = useMemo(
    () =>
      view === "month"
        ? monthGrid(anchor)
        : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i)),
    [view, anchor]
  );

  const visible = pieces.filter(
    (p) =>
      pieceDate(p) !== null &&
      (!platformFilter || p.platform === platformFilter) &&
      (!typeFilter || p.type === typeFilter) &&
      (!statusFilter || p.status === statusFilter)
  );

  const byDay = useMemo(() => {
    const map: Record<string, Piece[]> = {};
    for (const p of visible) {
      const d = pieceDate(p);
      if (!d) continue;
      (map[dayKey(d)] ??= []).push(p);
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => (pieceDate(a)!.getTime() - pieceDate(b)!.getTime()));
    }
    return map;
  }, [visible]);

  const platforms = useMemo(
    () => Array.from(new Set(pieces.map((p) => p.platform).filter(Boolean))) as string[],
    [pieces]
  );
  const types = useMemo(() => Array.from(new Set(pieces.map((p) => p.type))), [pieces]);

  function navigate(direction: -1 | 1) {
    setAnchor((d) =>
      view === "month"
        ? new Date(d.getFullYear(), d.getMonth() + direction, 1)
        : addDays(d, direction * 7)
    );
  }

  async function handleDragEnd(event: DragEndEvent) {
    const pieceId = String(event.active.id);
    const targetKey = event.over?.id ? String(event.over.id) : null;
    if (!targetKey) return;
    const piece = pieces.find((p) => p.id === pieceId);
    const current = piece ? pieceDate(piece) : null;
    if (!piece || !current) return;
    if (dayKey(current) === targetKey) return;

    // Preserve the original time of day; move to the dropped date.
    const [y, m, d] = targetKey.split("-").map(Number);
    const next = new Date(current);
    next.setFullYear(y, m - 1, d);
    const nextIso = next.toISOString();

    const prev = pieces;
    setPieces((arr) =>
      arr.map((p) => (p.id === piece.id ? { ...p, scheduled_at: nextIso } : p))
    );
    const { error: updateError } = await supabase
      .from("content_pieces")
      .update({ scheduled_at: nextIso, status: piece.status === "published" ? "published" : "scheduled" })
      .eq("id", piece.id);
    if (updateError) {
      setPieces(prev);
      setError(updateError.message);
    }
  }

  function openEditor(piece: Piece) {
    setSelected(piece);
    setEditTitle(piece.title);
    setEditBody(piece.body);
  }

  async function saveEditor() {
    if (!selected) return;
    if (!editTitle.trim() || !editBody.trim()) {
      setError("Title and body can't be empty.");
      return;
    }
    setSaving(true);
    const { error: updateError } = await supabase
      .from("content_pieces")
      .update({ title: editTitle.trim(), body: editBody })
      .eq("id", selected.id);
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setPieces((arr) =>
      arr.map((p) =>
        p.id === selected.id ? { ...p, title: editTitle.trim(), body: editBody } : p
      )
    );
    setSelected(null);
  }

  function exportCsv() {
    const rangeLabel =
      view === "month"
        ? anchor.toLocaleDateString([], { month: "long", year: "numeric" })
        : `week of ${startOfWeek(anchor).toLocaleDateString()}`;
    const inRange = visible.filter((p) => days.some((d) => isSameDay(pieceDate(p)!, d)));
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = [
      ["Date", "Time", "Title", "Type", "Platform", "Status", "Pillar"].join(","),
      ...inRange.map((p) => {
        const d = pieceDate(p)!;
        return [
          d.toLocaleDateString(),
          d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
          esc(p.title),
          TYPE_LABELS[p.type] ?? p.type,
          p.platform ?? "",
          p.status,
          esc(p.pillar ?? ""),
        ].join(",");
      }),
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `content-calendar-${rangeLabel.replace(/\s+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const heading =
    view === "month"
      ? anchor.toLocaleDateString([], { month: "long", year: "numeric" })
      : `${startOfWeek(anchor).toLocaleDateString([], { month: "short", day: "numeric" })} – ${addDays(startOfWeek(anchor), 6).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <div className="pb-12 print:p-0">
      <div className="mb-5 flex flex-col gap-4 print:hidden lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <CalendarDays className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Content Calendar</h1>
            <p className="text-sm text-muted-foreground">
              Drag cards to reschedule. Click to edit content.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            aria-label="Filter by platform"
          >
            <option value="">All platforms</option>
            {platforms.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            aria-label="Filter by type"
          >
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t] ?? t}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {["scheduled", "published", "approved", "in_review", "draft"].map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <Button type="button" variant="outline" size="sm" onClick={exportCsv}>
            <Download className="h-4 w-4" />
            CSV
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            PDF
          </Button>
        </div>
      </div>

      <div className="mb-4 flex items-center justify-between print:mb-2">
        <div className="flex items-center gap-1 print:hidden">
          <Button type="button" variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Previous">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAnchor(startOfDay(new Date()))}
          >
            Today
          </Button>
          <Button type="button" variant="ghost" size="icon" onClick={() => navigate(1)} aria-label="Next">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <h2 className="text-lg font-semibold">{heading}</h2>
        <div className="flex rounded-lg border p-0.5 print:hidden">
          {(["month", "week"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                "rounded-md px-3 py-1 text-sm font-medium capitalize transition-colors",
                view === v ? "bg-primary text-primary-foreground" : "hover:bg-secondary"
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive print:hidden">
          {error}
        </p>
      )}

      <DndContext sensors={sensors} onDragEnd={(e) => void handleDragEnd(e)}>
        <div className="overflow-x-auto rounded-lg border border-b-0 border-r-0">
          <div className="grid min-w-[760px] grid-cols-7 border-b border-r bg-secondary/40">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div
                key={d}
                className="border-r px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground last:border-r-0"
              >
                {d}
              </div>
            ))}
          </div>
          <div className={cn("grid min-w-[760px] grid-cols-7")}>
            {days.map((day) => (
              <DayCell
                key={dayKey(day)}
                day={day}
                inMonth={view === "week" || day.getMonth() === anchor.getMonth()}
                pieces={byDay[dayKey(day)] ?? []}
                onOpen={openEditor}
                tall={view === "week"}
              />
            ))}
          </div>
        </div>
      </DndContext>

      {/* ── Content editor modal ── */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-10 print:hidden"
          onClick={() => setSelected(null)}
        >
          <div
            className="w-full max-w-2xl rounded-lg border bg-background shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-center justify-between border-b p-4">
              <div className="flex items-center gap-2">
                <span className={cn("h-2 w-2 rounded-full", STATUS_DOTS[selected.status])} />
                <p className="text-sm font-medium capitalize">
                  {selected.status.replace(/_/g, " ")} ·{" "}
                  {pieceDate(selected)?.toLocaleString([], {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded p-1.5 text-muted-foreground hover:bg-secondary"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-4">
              <div className="space-y-1.5">
                <Label htmlFor="cal-title">Title</Label>
                <Input
                  id="cal-title"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cal-body">Content</Label>
                <Textarea
                  id="cal-body"
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  rows={14}
                  className="text-sm"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setSelected(null)}>
                  Cancel
                </Button>
                <Button type="button" onClick={() => void saveEditor()} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Save
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
