import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Recycle, Loader2, Check, Trash2, Pencil, X } from "lucide-react";
import { invokeEdgeFunction, supabase } from "@/lib/supabase";
import { useAccountStore } from "@/stores/accountStore";
import { useBrandKitStore } from "@/stores/brandKitStore";
import { useHandoffStore } from "@/stores/handoffStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const INPUT_TYPES = [
  { value: "blog_post", label: "Blog post" },
  { value: "video_transcript", label: "Video transcript" },
  { value: "audio_brain_dump", label: "Audio brain dump" },
  { value: "raw_notes", label: "Raw notes" },
  { value: "social_post", label: "Social post" },
];

const TYPE_LABELS: Record<string, string> = {
  caption: "Caption",
  linkedin_post: "LinkedIn post",
  email: "Email newsletter",
  blog: "Blog expansion",
  reel_script: "Reel script",
  carousel: "Carousel outline",
  story_frames: "Story frames",
};

const TYPE_ORDER = ["caption", "linkedin_post", "email", "blog", "reel_script", "carousel", "story_frames"];

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

function PieceCard({
  piece,
  onUpdated,
  onDiscarded,
}: {
  piece: Piece;
  onUpdated: (next: Piece) => void;
  onDiscarded: (id: string) => void;
}) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [accepted, setAccepted] = useState(false);
  const [draftBody, setDraftBody] = useState(piece.body);
  const [draftTitle, setDraftTitle] = useState(piece.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveEdit() {
    if (!draftBody.trim() || !draftTitle.trim()) {
      setError("Title and body can't be empty.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: updateError } = await supabase
      .from("content_pieces")
      .update({ title: draftTitle.trim(), body: draftBody })
      .eq("id", piece.id);
    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    onUpdated({ ...piece, title: draftTitle.trim(), body: draftBody });
    setMode("view");
  }

  async function discard() {
    setBusy(true);
    setError(null);
    const { error: deleteError } = await supabase
      .from("content_pieces")
      .delete()
      .eq("id", piece.id);
    setBusy(false);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    onDiscarded(piece.id);
  }

  return (
    <Card className={cn(accepted && "border-primary/50")}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {TYPE_LABELS[piece.type] ?? piece.type}
              {piece.platform ? ` · ${piece.platform}` : ""}
            </p>
            {mode === "edit" ? (
              <input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Title"
              />
            ) : (
              <CardTitle className="mt-0.5 text-sm">{piece.title}</CardTitle>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {mode === "view" ? (
              <>
                <button
                  type="button"
                  onClick={() => setAccepted(true)}
                  disabled={busy}
                  className={cn(
                    "rounded p-1.5 transition-colors",
                    accepted
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                  aria-label="Accept"
                  title={accepted ? "Accepted — saved as draft" : "Accept"}
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setMode("edit")}
                  disabled={busy}
                  className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  aria-label="Edit"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => void discard()}
                  disabled={busy}
                  className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  aria-label="Discard"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </button>
              </>
            ) : (
              <>
                <Button type="button" size="sm" onClick={() => void saveEdit()} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Save
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setDraftBody(piece.body);
                    setDraftTitle(piece.title);
                    setMode("view");
                  }}
                  className="rounded p-1.5 text-muted-foreground hover:bg-secondary"
                  aria-label="Cancel edit"
                >
                  <X className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {mode === "edit" ? (
          <Textarea
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            rows={10}
            className="font-mono text-xs"
          />
        ) : (
          <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-md bg-secondary/40 p-3 text-xs leading-relaxed">
            {piece.body}
          </pre>
        )}
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

export default function RepurposingEngine() {
  const account = useAccountStore((s) => s.account);
  const pillars = useBrandKitStore((s) => s.kit.pillars);
  const brandStatus = useBrandKitStore((s) => s.status);
  const loadBrandKit = useBrandKitStore((s) => s.load);
  const takeHandoff = useHandoffStore((s) => s.take);

  const [inputType, setInputType] = useState("raw_notes");
  const [inputText, setInputText] = useState("");
  const [pillar, setPillar] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [suitePillar, setSuitePillar] = useState<string | null>(null);
  const [handoffSource, setHandoffSource] = useState<string | null>(null);

  useEffect(() => {
    if (account && brandStatus === "idle") void loadBrandKit(account.id);
  }, [account, brandStatus, loadBrandKit]);

  // Prefill from a handoff (e.g. a video transcript from the Video Module).
  useEffect(() => {
    const p = takeHandoff("/repurpose");
    if (!p) return;
    const seed = p.body || p.topic || "";
    if (seed) setInputText(seed);
    if (p.format && INPUT_TYPES.some((t) => t.value === p.format)) setInputType(p.format);
    if (p.pillar && pillars.includes(p.pillar)) setPillar(p.pillar);
    setHandoffSource(p.source ?? "another module");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [takeHandoff]);

  async function handleGenerate() {
    setError(null);
    if (inputText.trim().length < 50) {
      setError("Paste at least 50 characters of source content.");
      return;
    }
    setGenerating(true);
    setPieces([]);
    try {
      const result = await invokeEdgeFunction<{ pillar: string | null; pieces: Piece[] }>(
        "repurpose",
        {
          input_text: inputText.trim(),
          input_type: inputType,
          pillar: pillar || undefined,
        }
      );
      setPieces(result.pieces);
      setSuitePillar(result.pillar);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  const sortedPieces = [...pieces].sort(
    (a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)
  );

  return (
    <div className="mx-auto max-w-3xl pb-12">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Recycle className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Repurposing Engine</h1>
          <p className="text-sm text-muted-foreground">
            One input in — a full multi-platform content suite out, saved straight to your
            library as drafts.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Source content</CardTitle>
          <CardDescription>
            Paste a blog post, transcript, brain dump, notes, or an existing social post.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {handoffSource && (
            <p className="rounded-md bg-accent/40 px-3 py-2 text-sm">
              Loaded from <span className="font-medium">{handoffSource}</span> — review the source below, then generate the suite.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {INPUT_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setInputType(t.value)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm transition-colors",
                  inputType === t.value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "hover:bg-secondary"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <Textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            rows={10}
            placeholder="Paste your source content here…"
            aria-label="Source content"
          />

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1.5">
              <Label htmlFor="pillar">Content pillar (optional — auto-detected otherwise)</Label>
              <select
                id="pillar"
                value={pillar}
                onChange={(e) => setPillar(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-64"
              >
                <option value="">Auto-detect</option>
                {pillars.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <Button onClick={() => void handleGenerate()} disabled={generating} className="sm:w-auto">
              {generating && <Loader2 className="h-4 w-4 animate-spin" />}
              {generating ? "Generating suite…" : "Generate full suite"}
            </Button>
          </div>

          {generating && (
            <p className="text-sm text-muted-foreground">
              Writing 5 captions, a LinkedIn post, an email, a reel script, a carousel, and
              story frames — this takes 30–60 seconds.
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {sortedPieces.length > 0 && (
        <div className="mt-8 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">
              {sortedPieces.length} pieces saved as drafts
              {suitePillar ? (
                <span className="ml-2 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium">
                  {suitePillar}
                </span>
              ) : null}
            </h2>
            <p className="text-sm text-muted-foreground">
              Everything below is already in your{" "}
              <Link to="/library" className="text-primary underline-offset-4 hover:underline">
                library
              </Link>{" "}
              and on the{" "}
              <Link to="/kanban" className="text-primary underline-offset-4 hover:underline">
                approval board
              </Link>
              .
            </p>
          </div>
          {sortedPieces.map((piece) => (
            <PieceCard
              key={piece.id}
              piece={piece}
              onUpdated={(next) =>
                setPieces((arr) => arr.map((p) => (p.id === next.id ? next : p)))
              }
              onDiscarded={(id) => setPieces((arr) => arr.filter((p) => p.id !== id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
