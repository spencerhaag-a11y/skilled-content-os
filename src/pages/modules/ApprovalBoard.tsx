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
import { Kanban as KanbanIcon, Loader2, X, Check, CalendarClock, Send, Trash2 } from "lucide-react";
import { invokeEdgeFunction, supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/authStore";
import { useAccountStore } from "@/stores/accountStore";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const LANES = [
  { status: "draft", label: "Draft" },
  { status: "in_review", label: "In Review" },
  { status: "approved", label: "Approved" },
  { status: "scheduled", label: "Scheduled" },
  { status: "published", label: "Published" },
] as const;

type LaneStatus = (typeof LANES)[number]["status"];

interface Piece {
  id: string;
  type: string;
  platform: string | null;
  title: string;
  body: string;
  status: LaneStatus;
  pillar: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
}

interface Comment {
  id: string;
  body: string;
  created_by: string | null;
  created_at: string;
}

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

function typeBadge(type: string) {
  return TYPE_LABELS[type] ?? type.replace(/_/g, " ");
}

function BoardCard({ piece, onOpen }: { piece: Piece; onOpen: (p: Piece) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: piece.id,
  });

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
          ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
          : undefined
      }
      className={cn(
        "cursor-grab rounded-md border bg-card p-3 shadow-sm transition-shadow hover:shadow",
        isDragging && "z-50 cursor-grabbing opacity-90 shadow-lg"
      )}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
          {typeBadge(piece.type)}
        </span>
        {piece.platform && (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium">
            {piece.platform}
          </span>
        )}
      </div>
      <p className="line-clamp-2 text-sm font-medium leading-snug">{piece.title}</p>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {piece.status === "scheduled" && piece.scheduled_at
          ? `Scheduled ${new Date(piece.scheduled_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}`
          : new Date(piece.created_at).toLocaleDateString()}
      </p>
    </div>
  );
}

function Lane({
  status,
  label,
  pieces,
  onOpen,
}: {
  status: LaneStatus;
  label: string;
  pieces: Piece[];
  onOpen: (p: Piece) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div className="flex w-64 shrink-0 flex-col">
      <div className="mb-2 flex items-center justify-between px-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium tabular-nums">
          {pieces.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-[60vh] flex-col gap-2 rounded-lg border border-dashed bg-secondary/30 p-2 transition-colors",
          isOver && "border-primary bg-accent"
        )}
      >
        {pieces.map((p) => (
          <BoardCard key={p.id} piece={p} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

export default function ApprovalBoard() {
  const user = useAuthStore((s) => s.user);
  const account = useAccountStore((s) => s.account);
  const profile = useAccountStore((s) => s.profile);

  const [pieces, setPieces] = useState<Piece[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [platformFilter, setPlatformFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const [selected, setSelected] = useState<Piece | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [modalBusy, setModalBusy] = useState<string | null>(null);
  const [scheduleFor, setScheduleFor] = useState<Piece | null>(null);
  const [scheduleAt, setScheduleAt] = useState("");
  const [ghlResult, setGhlResult] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    async function load(accountId: string) {
      setLoading(true);
      const { data, error: loadError } = await supabase
        .from("content_pieces")
        .select(
          "id, type, platform, title, body, status, pillar, scheduled_at, published_at, created_by, created_at"
        )
        .eq("account_id", accountId)
        .order("created_at", { ascending: false });
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

  const platforms = useMemo(
    () => Array.from(new Set(pieces.map((p) => p.platform).filter(Boolean))) as string[],
    [pieces]
  );
  const types = useMemo(() => Array.from(new Set(pieces.map((p) => p.type))), [pieces]);

  const visible = pieces.filter(
    (p) =>
      (!platformFilter || p.platform === platformFilter) && (!typeFilter || p.type === typeFilter)
  );

  async function moveTo(piece: Piece, nextStatus: LaneStatus, scheduledAt?: string) {
    const prev = pieces;
    const update: Partial<Piece> & Record<string, unknown> = { status: nextStatus };
    if (nextStatus === "scheduled") update.scheduled_at = scheduledAt ?? piece.scheduled_at;
    if (nextStatus === "published") update.published_at = new Date().toISOString();
    if (piece.status === "scheduled" && nextStatus !== "scheduled" && nextStatus !== "published") {
      update.scheduled_at = null;
    }

    setPieces((arr) => arr.map((p) => (p.id === piece.id ? { ...p, ...update } : p)));
    setSelected((s) => (s && s.id === piece.id ? { ...s, ...update } : s));

    const { error: updateError } = await supabase
      .from("content_pieces")
      .update(update)
      .eq("id", piece.id);
    if (updateError) {
      setPieces(prev); // revert optimistic update
      setError(updateError.message);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const pieceId = String(event.active.id);
    const lane = event.over?.id ? (String(event.over.id) as LaneStatus) : null;
    if (!lane) return;
    const piece = pieces.find((p) => p.id === pieceId);
    if (!piece || piece.status === lane) return;

    if (lane === "scheduled") {
      // Scheduling needs a date — open the picker; the move happens on confirm.
      setScheduleFor(piece);
      setScheduleAt("");
      return;
    }
    void moveTo(piece, lane);
  }

  async function openPiece(piece: Piece) {
    setSelected(piece);
    setGhlResult(null);
    setComments([]);
    const { data } = await supabase
      .from("content_comments")
      .select("id, body, created_by, created_at")
      .eq("content_piece_id", piece.id)
      .order("created_at");
    setComments((data ?? []) as Comment[]);
  }

  async function addComment() {
    if (!selected || !account || !user || !commentDraft.trim()) return;
    setModalBusy("comment");
    const { data, error: insertError } = await supabase
      .from("content_comments")
      .insert({
        account_id: account.id,
        content_piece_id: selected.id,
        body: commentDraft.trim(),
        created_by: user.id,
      })
      .select("id, body, created_by, created_at")
      .single();
    setModalBusy(null);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setComments((arr) => [...arr, data as Comment]);
    setCommentDraft("");
  }

  async function deletePiece(piece: Piece) {
    setModalBusy("delete");
    const { error: deleteError } = await supabase
      .from("content_pieces")
      .delete()
      .eq("id", piece.id);
    setModalBusy(null);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setPieces((arr) => arr.filter((p) => p.id !== piece.id));
    setSelected(null);
  }

  async function pushToGhl(piece: Piece) {
    setModalBusy("ghl");
    setGhlResult(null);
    try {
      const result = await invokeEdgeFunction<{ url?: string }>("ghl-push", {
        content_piece_id: piece.id,
      });
      setGhlResult(result.url ? `Pushed to GHL — draft: ${result.url}` : "Pushed to GHL.");
      const now = new Date().toISOString();
      setPieces((arr) => arr.map((p) => (p.id === piece.id ? { ...p, ghl_push_at: now } : p)) as Piece[]);
    } catch (err) {
      setGhlResult(err instanceof Error ? err.message : "GHL push failed.");
    } finally {
      setModalBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="pb-12">
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <KanbanIcon className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Approval Board</h1>
            <p className="text-sm text-muted-foreground">
              Drag cards between lanes. Click a card for details, comments, and actions.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            className="h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Filter by type"
          >
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {typeBadge(t)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {LANES.map((lane) => (
            <Lane
              key={lane.status}
              status={lane.status}
              label={lane.label}
              pieces={visible.filter((p) => p.status === lane.status)}
              onOpen={(p) => void openPiece(p)}
            />
          ))}
        </div>
      </DndContext>

      {/* ── Card detail modal ── */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-10"
          onClick={() => setSelected(null)}
        >
          <div
            className="w-full max-w-2xl rounded-lg border bg-background shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-start justify-between gap-3 border-b p-4">
              <div className="min-w-0">
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                    {typeBadge(selected.type)}
                  </span>
                  {selected.platform && (
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium">
                      {selected.platform}
                    </span>
                  )}
                  {selected.pillar && (
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium">
                      {selected.pillar}
                    </span>
                  )}
                </div>
                <h2 className="text-base font-semibold">{selected.title}</h2>
                <p className="text-xs text-muted-foreground">
                  Created {new Date(selected.created_at).toLocaleDateString()} by{" "}
                  {selected.created_by === user?.id
                    ? profile?.full_name || user?.email || "you"
                    : "a teammate"}
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

            <div className="max-h-[70vh] overflow-y-auto p-4">
              <pre className="mb-4 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md bg-secondary/40 p-3 text-xs leading-relaxed">
                {selected.body}
              </pre>

              <div className="mb-5 flex flex-wrap gap-2">
                {selected.status !== "approved" && selected.status !== "published" && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void moveTo(selected, "approved")}
                    disabled={modalBusy !== null}
                  >
                    <Check className="h-4 w-4" />
                    Approve
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setScheduleFor(selected);
                    setScheduleAt(selected.scheduled_at?.slice(0, 16) ?? "");
                  }}
                  disabled={modalBusy !== null}
                >
                  <CalendarClock className="h-4 w-4" />
                  Schedule
                </Button>
                {account?.ghl_connected &&
                  (selected.status === "approved" || selected.status === "scheduled") && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void pushToGhl(selected)}
                      disabled={modalBusy !== null}
                    >
                      {modalBusy === "ghl" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      Push to GHL
                    </Button>
                  )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void deletePiece(selected)}
                  disabled={modalBusy !== null}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  {modalBusy === "delete" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  Delete
                </Button>
              </div>
              {ghlResult && <p className="mb-4 text-sm text-primary">{ghlResult}</p>}

              <div>
                <Label className="mb-2 block">Comments</Label>
                {comments.length === 0 ? (
                  <p className="mb-3 text-sm text-muted-foreground">
                    No feedback yet. Leave a note before approving.
                  </p>
                ) : (
                  <ul className="mb-3 space-y-2">
                    {comments.map((c) => (
                      <li key={c.id} className="rounded-md border p-2.5 text-sm">
                        <p>{c.body}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {new Date(c.created_at).toLocaleString([], {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex gap-2">
                  <Textarea
                    value={commentDraft}
                    onChange={(e) => setCommentDraft(e.target.value)}
                    rows={2}
                    placeholder="Leave feedback for edits…"
                    className="text-sm"
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void addComment()}
                    disabled={!commentDraft.trim() || modalBusy !== null}
                    className="self-end"
                  >
                    {modalBusy === "comment" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Post"
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Schedule modal ── */}
      {scheduleFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setScheduleFor(null)}
        >
          <div
            className="w-full max-w-sm rounded-lg border bg-background p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h2 className="mb-1 text-base font-semibold">Schedule content</h2>
            <p className="mb-4 line-clamp-1 text-sm text-muted-foreground">{scheduleFor.title}</p>
            <div className="space-y-1.5">
              <Label htmlFor="schedule-at">Date & time</Label>
              <input
                id="schedule-at"
                type="datetime-local"
                value={scheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setScheduleFor(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!scheduleAt}
                onClick={() => {
                  void moveTo(scheduleFor, "scheduled", new Date(scheduleAt).toISOString());
                  setScheduleFor(null);
                }}
              >
                <CalendarClock className="h-4 w-4" />
                Schedule
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
