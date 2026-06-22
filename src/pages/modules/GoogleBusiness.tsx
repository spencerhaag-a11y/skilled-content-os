import { useState } from "react";
import { Link } from "react-router-dom";
import {
  MapPin,
  Loader2,
  ClipboardCheck,
  Megaphone,
  MessageSquareReply,
  HelpCircle,
  Tags,
  Copy,
  Check,
} from "lucide-react";
import { invokeEdgeFunction } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Task = "profile_audit" | "gbp_post" | "review_response" | "qa_generate" | "local_keywords";

const TABS: { value: Task; label: string; icon: typeof MapPin; needsInput: boolean; placeholder: string }[] = [
  { value: "profile_audit", label: "Profile audit", icon: ClipboardCheck, needsInput: true, placeholder: "Paste your current GBP fields: name, categories, description, hours, services, attributes…" },
  { value: "gbp_post", label: "Post generator", icon: Megaphone, needsInput: false, placeholder: "Optional: what's the post about? (offer, event, update). Leave blank to use your brand context." },
  { value: "review_response", label: "Review reply", icon: MessageSquareReply, needsInput: true, placeholder: "Paste the customer review you want to respond to…" },
  { value: "qa_generate", label: "Q&A", icon: HelpCircle, needsInput: false, placeholder: "Optional: focus area for the Q&A. Leave blank for general." },
  { value: "local_keywords", label: "Local keywords", icon: Tags, needsInput: false, placeholder: "Optional: location + category, e.g. 'physical therapy, Monticello MN'." },
];

const POST_TYPES = ["update", "offer", "event"];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

export default function GoogleBusiness() {
  const [task, setTask] = useState<Task>("profile_audit");
  const [input, setInput] = useState("");
  const [postType, setPostType] = useState("update");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, unknown> | null>(null);
  const [savedPieceId, setSavedPieceId] = useState<string | null>(null);

  const active = TABS.find((t) => t.value === task)!;

  async function run() {
    setError(null);
    setResults(null);
    setSavedPieceId(null);
    if (active.needsInput && input.trim().length < 5) {
      setError("Paste the required content first.");
      return;
    }
    setLoading(true);
    try {
      const res = await invokeEdgeFunction<{ results: Record<string, unknown>; saved_piece_id: string | null }>(
        "google-business",
        { task, input: input.trim() || undefined, post_type: task === "gbp_post" ? postType : undefined }
      );
      setResults(res.results);
      setSavedPieceId(res.saved_piece_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Task failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl pb-12">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <MapPin className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Google Business</h1>
          <p className="text-sm text-muted-foreground">
            Profile audits, GBP posts, review replies, Q&A, and local keywords — all in your brand voice.
          </p>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => {
              setTask(t.value);
              setResults(null);
              setError(null);
              setInput("");
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
              task === t.value ? "border-primary bg-primary text-primary-foreground" : "hover:bg-secondary"
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="space-y-4 py-5">
          {task === "gbp_post" && (
            <div className="space-y-1.5">
              <Label>Post type</Label>
              <div className="flex flex-wrap gap-2">
                {POST_TYPES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPostType(p)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm capitalize transition-colors",
                      postType === p ? "border-primary bg-primary text-primary-foreground" : "hover:bg-secondary"
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="gbp-input">
              {active.needsInput ? "Input" : "Input (optional)"}
            </Label>
            <Textarea
              id="gbp-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={task === "review_response" || task === "profile_audit" ? 6 : 3}
              placeholder={active.placeholder}
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={() => void run()} disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? "Working…" : "Generate"}
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {results && (
        <Card className="mt-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{active.label}</CardTitle>
            {task === "gbp_post" && savedPieceId && (
              <CardDescription>
                Saved to your{" "}
                <Link to="/library" className="text-primary underline-offset-4 hover:underline">content library</Link>{" "}
                as a draft.
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {/* Profile audit */}
            {task === "profile_audit" && (
              <>
                {typeof results.score === "number" && (
                  <p className="text-2xl font-bold text-primary">
                    {results.score as number}<span className="text-base text-muted-foreground">/100</span>
                  </p>
                )}
                {Array.isArray(results.gaps) && (
                  <div>
                    <p className="mb-2 font-medium">Gaps to fix</p>
                    <ul className="space-y-2">
                      {(results.gaps as { field: string; issue: string; fix: string }[]).map((g, i) => (
                        <li key={i} className="rounded-md border p-2">
                          <p className="font-medium">{g.field}</p>
                          <p className="text-muted-foreground">{g.issue}</p>
                          <p className="mt-0.5 text-primary">→ {g.fix}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {Array.isArray(results.strengths) && (results.strengths as string[]).length > 0 && (
                  <div>
                    <p className="mb-1 font-medium">Strengths</p>
                    <ul className="list-disc pl-5 text-muted-foreground">
                      {(results.strengths as string[]).map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  </div>
                )}
              </>
            )}

            {/* GBP post */}
            {task === "gbp_post" && (
              <div className="space-y-2">
                <pre className="whitespace-pre-wrap rounded-md bg-secondary/40 p-3 text-sm leading-relaxed">{String(results.body ?? "")}</pre>
                {results.cta_label ? <p className="text-xs text-muted-foreground">CTA: {String(results.cta_label)}</p> : null}
                <CopyButton text={String(results.body ?? "")} />
              </div>
            )}

            {/* Review response */}
            {task === "review_response" && (
              <div className="space-y-2">
                <pre className="whitespace-pre-wrap rounded-md bg-secondary/40 p-3 leading-relaxed">{String(results.response ?? "")}</pre>
                <CopyButton text={String(results.response ?? "")} />
              </div>
            )}

            {/* Q&A */}
            {task === "qa_generate" && Array.isArray(results.qa) && (
              <ul className="space-y-3">
                {(results.qa as { question: string; answer: string }[]).map((qa, i) => (
                  <li key={i}>
                    <p className="font-medium">{qa.question}</p>
                    <p className="text-muted-foreground">{qa.answer}</p>
                  </li>
                ))}
              </ul>
            )}

            {/* Local keywords */}
            {task === "local_keywords" && (
              <>
                {Array.isArray(results.keywords) && (
                  <div className="flex flex-wrap gap-1.5">
                    {(results.keywords as string[]).map((k, i) => (
                      <span key={i} className="rounded-full bg-secondary px-2.5 py-0.5 text-xs">{k}</span>
                    ))}
                  </div>
                )}
                {Array.isArray(results.post_ideas) && (
                  <div>
                    <p className="mb-1 mt-2 font-medium">Post ideas</p>
                    <ul className="list-disc pl-5 text-muted-foreground">
                      {(results.post_ideas as string[]).map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
