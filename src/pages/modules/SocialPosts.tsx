import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Share2, Loader2, Check, Copy, Kanban, RefreshCw } from "lucide-react";
import { invokeEdgeFunction, supabase } from "@/lib/supabase";
import { useAccountStore } from "@/stores/accountStore";
import { useBrandKitStore } from "@/stores/brandKitStore";
import { useHandoffStore } from "@/stores/handoffStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const PLATFORMS = ["Instagram", "TikTok", "LinkedIn", "Facebook", "X"];

const FORMATS: { value: string; label: string; platforms: string[] }[] = [
  { value: "caption", label: "Single image caption", platforms: PLATFORMS },
  { value: "reel_script", label: "Reel script", platforms: ["Instagram", "TikTok", "Facebook"] },
  { value: "carousel", label: "Carousel", platforms: ["Instagram", "LinkedIn", "TikTok"] },
  { value: "story_frames", label: "Story frames", platforms: ["Instagram", "Facebook"] },
  { value: "thread", label: "Thread", platforms: ["X", "LinkedIn"] },
];

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

export default function SocialPosts() {
  const account = useAccountStore((s) => s.account);
  const pillars = useBrandKitStore((s) => s.kit.pillars);
  const brandStatus = useBrandKitStore((s) => s.status);
  const loadBrandKit = useBrandKitStore((s) => s.load);
  const takeHandoff = useHandoffStore((s) => s.take);

  const [platform, setPlatform] = useState("Instagram");
  const [format, setFormat] = useState("caption");
  const [pillar, setPillar] = useState("");
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState("");
  const [handoffSource, setHandoffSource] = useState<string | null>(null);

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [piece, setPiece] = useState<Piece | null>(null);
  const [editedBody, setEditedBody] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "review" | null>(null);
  const [sentToReview, setSentToReview] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (account && brandStatus === "idle") void loadBrandKit(account.id);
  }, [account, brandStatus, loadBrandKit]);

  // Prefill from a cross-module handoff (e.g. a Niche Research idea).
  useEffect(() => {
    const p = takeHandoff("/social-posts");
    if (!p) return;
    if (p.topic) setTopic(p.topic);
    if (p.pillar && pillars.includes(p.pillar)) setPillar(p.pillar);
    if (p.platform && PLATFORMS.includes(p.platform)) setPlatform(p.platform);
    setHandoffSource(p.source ?? "another module");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [takeHandoff]);

  const availableFormats = FORMATS.filter((f) => f.platforms.includes(platform));

  useEffect(() => {
    if (!availableFormats.some((f) => f.value === format)) {
      setFormat(availableFormats[0]?.value ?? "caption");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform]);

  async function handleGenerate() {
    setError(null);
    if (!pillar && topic.trim().length < 3) {
      setError("Pick a content pillar or enter a topic.");
      return;
    }
    setGenerating(true);
    setPiece(null);
    setSentToReview(false);
    try {
      const result = await invokeEdgeFunction<{ piece: Piece }>("generate-social", {
        platform,
        format,
        pillar: pillar || undefined,
        topic: topic.trim() || undefined,
        tone: tone.trim() || undefined,
      });
      setPiece(result.piece);
      setEditedBody(result.piece.body);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  async function saveEdits() {
    if (!piece) return;
    setBusy("save");
    setError(null);
    const { error: updateError } = await supabase
      .from("content_pieces")
      .update({ body: editedBody })
      .eq("id", piece.id);
    setBusy(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setPiece({ ...piece, body: editedBody });
    setDirty(false);
  }

  async function sendToKanban() {
    if (!piece) return;
    setBusy("review");
    setError(null);
    const body = dirty ? editedBody : piece.body;
    const { error: updateError } = await supabase
      .from("content_pieces")
      .update({ status: "in_review", body })
      .eq("id", piece.id);
    setBusy(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setPiece({ ...piece, status: "in_review", body });
    setDirty(false);
    setSentToReview(true);
  }

  async function copyBody() {
    if (!piece) return;
    await navigator.clipboard.writeText(dirty ? editedBody : piece.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="mx-auto max-w-3xl pb-12">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Share2 className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Social Posts</h1>
          <p className="text-sm text-muted-foreground">
            Platform-specific posts built from your brand kit and knowledge base.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What are we making?</CardTitle>
          <CardDescription>Pick a platform and format, then point it at a topic.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {handoffSource && (
            <p className="rounded-md bg-accent/40 px-3 py-2 text-sm">
              Prefilled from <span className="font-medium">{handoffSource}</span> — tweak anything below before generating.
            </p>
          )}
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
                    platform === p
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-secondary"
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Format</Label>
            <div className="flex flex-wrap gap-2">
              {availableFormats.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFormat(f.value)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm transition-colors",
                    format === f.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-secondary"
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pillar">Content pillar</Label>
              <select
                id="pillar"
                value={pillar}
                onChange={(e) => setPillar(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">— None (use topic) —</option>
                {pillars.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="topic">{pillar ? "Specific angle (optional)" : "Custom topic"}</Label>
              <Input
                id="topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder={
                  pillar ? "e.g. off-season ankle stability" : "e.g. why athletes skip rehab"
                }
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tone">Tone override (optional — defaults to brand voice)</Label>
            <Input
              id="tone"
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              placeholder="e.g. playful and punchy"
            />
          </div>

          <div className="flex justify-end">
            <Button onClick={() => void handleGenerate()} disabled={generating}>
              {generating && <Loader2 className="h-4 w-4 animate-spin" />}
              {generating ? "Writing…" : piece ? "Generate another" : "Generate post"}
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {piece && (
        <Card className="mt-6">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {piece.platform} · {piece.type.replace(/_/g, " ")}
                  {piece.pillar ? ` · ${piece.pillar}` : ""}
                </p>
                <CardTitle className="mt-0.5 text-base">{piece.title}</CardTitle>
              </div>
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs font-medium",
                  piece.status === "in_review"
                    ? "bg-amber-100 text-amber-800"
                    : "bg-secondary text-secondary-foreground"
                )}
              >
                {piece.status === "in_review" ? "In review" : "Draft"}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={editedBody}
              onChange={(e) => {
                setEditedBody(e.target.value);
                setDirty(e.target.value !== piece.body);
              }}
              rows={12}
              className="text-sm"
              aria-label="Post body"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void saveEdits()}
                disabled={!dirty || busy !== null}
              >
                {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Save edits
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void sendToKanban()}
                disabled={busy !== null || piece.status !== "draft"}
              >
                {busy === "review" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Kanban className="h-4 w-4" />}
                {piece.status === "draft" ? "Send to approval board" : "On the board"}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => void copyBody()}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void handleGenerate()}
                disabled={generating}
              >
                <RefreshCw className={cn("h-4 w-4", generating && "animate-spin")} />
                Regenerate
              </Button>
            </div>
            {sentToReview && (
              <p className="text-sm text-primary">
                Moved to In Review on the{" "}
                <Link to="/kanban" className="underline underline-offset-4">
                  approval board
                </Link>
                . GHL push unlocks once it's approved (Phase 15 wiring).
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Saved to your{" "}
              <Link to="/library" className="text-primary underline-offset-4 hover:underline">
                content library
              </Link>{" "}
              as a draft the moment it was generated.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
