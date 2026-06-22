import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FileText, Loader2, Check, Copy, Kanban, Square } from "lucide-react";
import { streamEdgeFunction, supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/authStore";
import { useAccountStore } from "@/stores/accountStore";
import { useBrandKitStore } from "@/stores/brandKitStore";
import { useHandoffStore } from "@/stores/handoffStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const LENGTH_OPTIONS = [
  { value: "500", label: "500 words" },
  { value: "1000", label: "1,000 words" },
  { value: "1500", label: "1,500 words" },
  { value: "2000", label: "2,000+ words" },
];

interface ParsedBlog {
  title: string;
  body: string; // markdown article without meta/keyword blocks
  meta: string;
  keywords: string[];
}

interface KeywordStat {
  keyword: string;
  count: number;
  density: number; // percentage
}

function parseBlogOutput(raw: string): ParsedBlog {
  let working = raw.trim();
  let meta = "";
  let keywords: string[] = [];

  const kwIdx = working.indexOf("---KEYWORDS---");
  if (kwIdx !== -1) {
    keywords = working
      .slice(kwIdx + "---KEYWORDS---".length)
      .trim()
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean)
      .slice(0, 8);
    working = working.slice(0, kwIdx).trim();
  }

  const metaIdx = working.indexOf("---META---");
  if (metaIdx !== -1) {
    meta = working.slice(metaIdx + "---META---".length).trim();
    working = working.slice(0, metaIdx).trim();
  }

  const h1Match = working.match(/^#\s+(.+)$/m);
  const title = h1Match?.[1]?.trim() ?? "Blog post";

  return { title, body: working, meta, keywords };
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function keywordStats(body: string, keywords: string[]): KeywordStat[] {
  const lower = body.toLowerCase();
  const totalWords = countWords(body);
  return keywords.map((keyword) => {
    const needle = keyword.toLowerCase();
    let count = 0;
    let idx = lower.indexOf(needle);
    while (idx !== -1) {
      count++;
      idx = lower.indexOf(needle, idx + needle.length);
    }
    const keywordWords = countWords(keyword) || 1;
    const density = totalWords > 0 ? ((count * keywordWords) / totalWords) * 100 : 0;
    return { keyword, count, density };
  });
}

export default function BlogPosts() {
  const user = useAuthStore((s) => s.user);
  const account = useAccountStore((s) => s.account);
  const pillars = useBrandKitStore((s) => s.kit.pillars);
  const brandStatus = useBrandKitStore((s) => s.status);
  const loadBrandKit = useBrandKitStore((s) => s.load);
  const takeHandoff = useHandoffStore((s) => s.take);

  const [topic, setTopic] = useState("");
  const [pillar, setPillar] = useState("");
  const [length, setLength] = useState("1000");
  const [targetKeyword, setTargetKeyword] = useState("");
  const [handoffSource, setHandoffSource] = useState<string | null>(null);

  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [parsed, setParsed] = useState<ParsedBlog | null>(null);
  const [editedBody, setEditedBody] = useState("");
  const [pieceId, setPieceId] = useState<string | null>(null);
  const [pieceStatus, setPieceStatus] = useState<"draft" | "in_review">("draft");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "review" | null>(null);
  const [copied, setCopied] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const streamBoxRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (account && brandStatus === "idle") void loadBrandKit(account.id);
  }, [account, brandStatus, loadBrandKit]);

  // Prefill from a cross-module handoff (Niche Research idea, SEO keyword, …).
  useEffect(() => {
    const p = takeHandoff("/blog-posts");
    if (!p) return;
    if (p.topic) setTopic(p.topic);
    if (p.pillar && pillars.includes(p.pillar)) setPillar(p.pillar);
    setHandoffSource(p.source ?? "another module");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [takeHandoff]);

  useEffect(() => {
    if (streaming && streamBoxRef.current) {
      streamBoxRef.current.scrollTop = streamBoxRef.current.scrollHeight;
    }
  }, [streamText, streaming]);

  async function handleGenerate() {
    setError(null);
    if (!topic.trim() && !pillar) {
      setError("Enter a topic or pick a pillar.");
      return;
    }
    setStreaming(true);
    setStreamText("");
    setParsed(null);
    setPieceId(null);
    setPieceStatus("draft");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const full = await streamEdgeFunction(
        "generate-blog",
        {
          topic: topic.trim(),
          pillar: pillar || undefined,
          length,
          target_keyword: targetKeyword.trim() || undefined,
        },
        (_chunk, fullSoFar) => setStreamText(fullSoFar),
        controller.signal
      );
      const result = parseBlogOutput(full);
      setParsed(result);
      setEditedBody(result.body);

      // Stream complete → save to library as Draft (Module 5).
      if (account && user) {
        const { data, error: insertError } = await supabase
          .from("content_pieces")
          .insert({
            account_id: account.id,
            created_by: user.id,
            type: "blog",
            platform: "Blog",
            title: result.title,
            body: result.meta
              ? `${result.body}\n\n---\nMeta description: ${result.meta}`
              : result.body,
            status: "draft",
            pillar: pillar || null,
          })
          .select("id")
          .single();
        if (insertError) setError(`Generated, but saving failed: ${insertError.message}`);
        else setPieceId(data.id);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Generation failed.");
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  async function saveEdits() {
    if (!pieceId || !parsed) return;
    setBusy("save");
    setError(null);
    const body = parsed.meta
      ? `${editedBody}\n\n---\nMeta description: ${parsed.meta}`
      : editedBody;
    const { error: updateError } = await supabase
      .from("content_pieces")
      .update({ body })
      .eq("id", pieceId);
    setBusy(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setParsed({ ...parsed, body: editedBody });
  }

  async function sendToKanban() {
    if (!pieceId) return;
    setBusy("review");
    setError(null);
    const { error: updateError } = await supabase
      .from("content_pieces")
      .update({ status: "in_review" })
      .eq("id", pieceId);
    setBusy(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setPieceStatus("in_review");
  }

  async function copyMarkdown() {
    const text = parsed
      ? `${editedBody}${parsed.meta ? `\n\nMeta description: ${parsed.meta}` : ""}`
      : streamText;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const dirty = parsed !== null && editedBody !== parsed.body;
  const stats =
    parsed && parsed.keywords.length > 0 ? keywordStats(editedBody, parsed.keywords) : [];
  const wordCount = parsed ? countWords(editedBody) : countWords(streamText);

  return (
    <div className="mx-auto max-w-3xl pb-12">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <FileText className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Blog Posts</h1>
          <p className="text-sm text-muted-foreground">
            Long-form SEO content aligned to your pillars, voice, and knowledge base.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Post setup</CardTitle>
          <CardDescription>
            Topic ideas can also come from Niche Research once that module ships (Phase 21).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {handoffSource && (
            <p className="rounded-md bg-accent/40 px-3 py-2 text-sm">
              Topic prefilled from <span className="font-medium">{handoffSource}</span>.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="blog-topic">Topic</Label>
              <Input
                id="blog-topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. how hockey players should train in the off-season"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="blog-pillar">Content pillar (optional)</Label>
              <select
                id="blog-pillar"
                value={pillar}
                onChange={(e) => setPillar(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">— None —</option>
                {pillars.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Length</Label>
              <div className="flex flex-wrap gap-2">
                {LENGTH_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setLength(opt.value)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm transition-colors",
                      length === opt.value
                        ? "border-primary bg-primary text-primary-foreground"
                        : "hover:bg-secondary"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="blog-keyword">Primary keyword (optional)</Label>
              <Input
                id="blog-keyword"
                value={targetKeyword}
                onChange={(e) => setTargetKeyword(e.target.value)}
                placeholder="e.g. hockey return to sport"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            {streaming && (
              <Button type="button" variant="outline" onClick={handleStop}>
                <Square className="h-4 w-4" />
                Stop
              </Button>
            )}
            <Button onClick={() => void handleGenerate()} disabled={streaming}>
              {streaming && <Loader2 className="h-4 w-4 animate-spin" />}
              {streaming ? "Writing live…" : "Generate blog post"}
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {/* ── Live stream ── */}
      {streaming && (
        <Card className="mt-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Writing… {wordCount} words</CardTitle>
          </CardHeader>
          <CardContent>
            <pre
              ref={streamBoxRef}
              className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-md bg-secondary/40 p-4 text-sm leading-relaxed"
            >
              {streamText}
              <span className="animate-pulse">▍</span>
            </pre>
          </CardContent>
        </Card>
      )}

      {/* ── Finished post ── */}
      {parsed && !streaming && (
        <>
          <Card className="mt-6">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">{parsed.title}</CardTitle>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-xs font-medium",
                    pieceStatus === "in_review"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-secondary text-secondary-foreground"
                  )}
                >
                  {pieceStatus === "in_review" ? "In review" : "Draft"}
                </span>
              </div>
              <CardDescription>
                {countWords(editedBody)} words
                {parsed.meta ? ` · Meta description: "${parsed.meta}"` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={editedBody}
                onChange={(e) => setEditedBody(e.target.value)}
                rows={18}
                className="font-mono text-xs leading-relaxed"
                aria-label="Blog post markdown"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void saveEdits()}
                  disabled={!dirty || busy !== null || !pieceId}
                >
                  {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Save edits
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void sendToKanban()}
                  disabled={busy !== null || pieceStatus !== "draft" || !pieceId}
                >
                  {busy === "review" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Kanban className="h-4 w-4" />}
                  {pieceStatus === "draft" ? "Send to approval board" : "On the board"}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => void copyMarkdown()}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied" : "Copy markdown"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Saved to your{" "}
                <Link to="/library" className="text-primary underline-offset-4 hover:underline">
                  library
                </Link>{" "}
                as a draft. Push to a GHL funnel page or blog arrives with the GHL integration
                (Phase 15).
              </p>
            </CardContent>
          </Card>

          {/* ── Keyword density report ── */}
          {stats.length > 0 && (
            <Card className="mt-6">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Keyword density report</CardTitle>
                <CardDescription>
                  Healthy density is roughly 0.5–2.5% per keyword. Recalculates as you edit and
                  save.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">Keyword</th>
                        <th className="py-2 pr-4 font-medium">Occurrences</th>
                        <th className="py-2 font-medium">Density</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.map((s) => {
                        const healthy = s.density >= 0.5 && s.density <= 2.5;
                        return (
                          <tr key={s.keyword} className="border-b last:border-0">
                            <td className="py-2 pr-4 font-medium">{s.keyword}</td>
                            <td className="py-2 pr-4 tabular-nums">{s.count}</td>
                            <td className="py-2">
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
                                  healthy
                                    ? "bg-accent text-accent-foreground"
                                    : s.count === 0
                                      ? "bg-destructive/10 text-destructive"
                                      : "bg-amber-100 text-amber-800"
                                )}
                              >
                                {s.density.toFixed(2)}%
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
