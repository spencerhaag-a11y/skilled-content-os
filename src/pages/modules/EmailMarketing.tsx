import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Mail, Loader2, Check, Copy, Kanban } from "lucide-react";
import { invokeEdgeFunction, supabase } from "@/lib/supabase";
import { useAccountStore } from "@/stores/accountStore";
import { useBrandKitStore } from "@/stores/brandKitStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const SINGLE_TYPES = [
  { value: "newsletter", label: "Newsletter" },
  { value: "promotional_offer", label: "Promotional offer" },
  { value: "client_follow_up", label: "Client follow-up" },
  { value: "re_engagement", label: "Re-engagement" },
];

const SEQUENCE_TYPES = [
  { value: "welcome_sequence", label: "Welcome sequence" },
  { value: "nurture", label: "Nurture drip" },
  { value: "re_engagement", label: "Re-engagement" },
];

interface Piece {
  id: string;
  title: string;
  body: string;
  status: string;
  created_at: string;
}

function splitSubject(body: string): { subject: string; rest: string } {
  const match = body.match(/^Subject:\s*(.*)\n\n([\s\S]*)$/);
  if (match) return { subject: match[1], rest: match[2] };
  return { subject: "", rest: body };
}

function SequenceEmailCard({ piece }: { piece: Piece }) {
  const initial = splitSubject(piece.body);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.rest);
  const [status, setStatus] = useState(piece.status);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "review" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function persist(nextStatus?: string) {
    setBusy(nextStatus ? "review" : "save");
    setError(null);
    const update: Record<string, unknown> = { body: `Subject: ${subject}\n\n${body}` };
    if (nextStatus) update.status = nextStatus;
    const { error: updateError } = await supabase
      .from("content_pieces")
      .update(update)
      .eq("id", piece.id);
    setBusy(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    if (nextStatus) setStatus(nextStatus);
    setDirty(false);
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">{piece.title}</CardTitle>
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs font-medium",
              status === "in_review"
                ? "bg-amber-100 text-amber-800"
                : "bg-secondary text-secondary-foreground"
            )}
          >
            {status === "in_review" ? "In review" : "Draft"}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label>Subject</Label>
          <Input
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
              setDirty(true);
            }}
          />
        </div>
        <Textarea
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setDirty(true);
          }}
          rows={8}
          className="text-sm"
          aria-label="Email body"
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void persist()}
            disabled={!dirty || busy !== null}
          >
            {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Save edits
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void persist("in_review")}
            disabled={busy !== null || status !== "draft"}
          >
            {busy === "review" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Kanban className="h-4 w-4" />}
            {status === "draft" ? "Send to board" : "On the board"}
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

export default function EmailMarketing() {
  const account = useAccountStore((s) => s.account);
  const pillars = useBrandKitStore((s) => s.kit.pillars);
  const brandStatus = useBrandKitStore((s) => s.status);
  const loadBrandKit = useBrandKitStore((s) => s.load);

  const [mode, setMode] = useState<"single" | "sequence">("single");
  const [emailType, setEmailType] = useState("newsletter");
  const [pillar, setPillar] = useState("");
  const [topic, setTopic] = useState("");
  const [details, setDetails] = useState("");
  const [count, setCount] = useState(5);

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Single mode result
  const [piece, setPiece] = useState<Piece | null>(null);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [chosenSubject, setChosenSubject] = useState(0);
  const [emailBody, setEmailBody] = useState("");
  const [singleStatus, setSingleStatus] = useState<"draft" | "in_review">("draft");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "review" | null>(null);
  const [copied, setCopied] = useState(false);

  // Sequence mode result
  const [sequenceTitle, setSequenceTitle] = useState<string | null>(null);
  const [sequencePieces, setSequencePieces] = useState<Piece[]>([]);

  useEffect(() => {
    if (account && brandStatus === "idle") void loadBrandKit(account.id);
  }, [account, brandStatus, loadBrandKit]);

  const types = mode === "single" ? SINGLE_TYPES : SEQUENCE_TYPES;

  useEffect(() => {
    if (!types.some((t) => t.value === emailType)) setEmailType(types[0].value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  async function handleGenerate() {
    setError(null);
    if (!pillar && !topic.trim() && !details.trim()) {
      setError("Give it a topic, pillar, or offer details.");
      return;
    }
    setGenerating(true);
    setPiece(null);
    setSequencePieces([]);
    setSequenceTitle(null);
    try {
      if (mode === "single") {
        const result = await invokeEdgeFunction<{
          piece: Piece;
          subjects: string[];
          raw_body: string;
        }>("generate-email", {
          mode,
          email_type: emailType,
          pillar: pillar || undefined,
          topic: topic.trim() || undefined,
          details: details.trim() || undefined,
        });
        setPiece(result.piece);
        setSubjects(result.subjects);
        setChosenSubject(0);
        setEmailBody(result.raw_body);
        setSingleStatus("draft");
        setDirty(false);
      } else {
        const result = await invokeEdgeFunction<{
          sequence_title: string;
          pieces: Piece[];
        }>("generate-email", {
          mode,
          email_type: emailType,
          pillar: pillar || undefined,
          topic: topic.trim() || undefined,
          details: details.trim() || undefined,
          count,
        });
        setSequenceTitle(result.sequence_title);
        setSequencePieces(result.pieces);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  async function persistSingle(nextStatus?: "in_review") {
    if (!piece) return;
    setBusy(nextStatus ? "review" : "save");
    setError(null);
    const update: Record<string, unknown> = {
      body: `Subject: ${subjects[chosenSubject] ?? ""}\n\n${emailBody}`,
    };
    if (nextStatus) update.status = nextStatus;
    const { error: updateError } = await supabase
      .from("content_pieces")
      .update(update)
      .eq("id", piece.id);
    setBusy(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    if (nextStatus) setSingleStatus(nextStatus);
    setDirty(false);
  }

  async function copyEmail() {
    await navigator.clipboard.writeText(
      `Subject: ${subjects[chosenSubject] ?? ""}\n\n${emailBody}`
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="mx-auto max-w-3xl pb-12">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Mail className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Email Marketing</h1>
          <p className="text-sm text-muted-foreground">
            Newsletters, promos, and drip sequences — built in your voice, ready for GHL.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex rounded-lg border p-1">
            {(["single", "sequence"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  mode === m ? "bg-primary text-primary-foreground" : "hover:bg-secondary"
                )}
              >
                {m === "single" ? "Single email" : "Sequence builder"}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>{mode === "single" ? "Email type" : "Sequence type"}</Label>
            <div className="flex flex-wrap gap-2">
              {types.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setEmailType(t.value)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm transition-colors",
                    emailType === t.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-secondary"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="email-pillar">Content pillar (optional)</Label>
              <select
                id="email-pillar"
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
            <div className="space-y-1.5">
              <Label htmlFor="email-topic">Topic / angle</Label>
              <Input
                id="email-topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. summer athlete program enrollment"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email-details">
              Offer or context details (optional — treated as authoritative)
            </Label>
            <Textarea
              id="email-details"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={3}
              placeholder="Dates, pricing, what's included, deadline…"
            />
          </div>

          {mode === "sequence" && (
            <div className="space-y-1.5">
              <Label htmlFor="email-count">Emails in sequence</Label>
              <select
                id="email-count"
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="h-10 w-32 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {[3, 4, 5, 6, 7].map((n) => (
                  <option key={n} value={n}>
                    {n} emails
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={() => void handleGenerate()} disabled={generating}>
              {generating && <Loader2 className="h-4 w-4 animate-spin" />}
              {generating
                ? mode === "single"
                  ? "Writing…"
                  : `Building ${count}-email sequence…`
                : mode === "single"
                  ? "Generate email"
                  : "Build sequence"}
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {/* ── Single email result ── */}
      {piece && mode === "single" && (
        <Card className="mt-6">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">{piece.title}</CardTitle>
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs font-medium",
                  singleStatus === "in_review"
                    ? "bg-amber-100 text-amber-800"
                    : "bg-secondary text-secondary-foreground"
                )}
              >
                {singleStatus === "in_review" ? "In review" : "Draft"}
              </span>
            </div>
            <CardDescription>Pick a subject line, polish the body, ship it.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Subject line — 5 options</Label>
              <div className="space-y-1">
                {subjects.map((s, i) => (
                  <label
                    key={i}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors",
                      chosenSubject === i ? "border-primary bg-accent" : "hover:bg-secondary"
                    )}
                  >
                    <input
                      type="radio"
                      name="subject"
                      checked={chosenSubject === i}
                      onChange={() => {
                        setChosenSubject(i);
                        setDirty(true);
                      }}
                      className="accent-[hsl(var(--primary))]"
                    />
                    <span>{s}</span>
                  </label>
                ))}
              </div>
            </div>

            <Textarea
              value={emailBody}
              onChange={(e) => {
                setEmailBody(e.target.value);
                setDirty(true);
              }}
              rows={12}
              className="text-sm"
              aria-label="Email body"
            />

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void persistSingle()}
                disabled={!dirty || busy !== null}
              >
                {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Save edits
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void persistSingle("in_review")}
                disabled={busy !== null || singleStatus !== "draft"}
              >
                {busy === "review" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Kanban className="h-4 w-4" />}
                {singleStatus === "draft" ? "Send to approval board" : "On the board"}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => void copyEmail()}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Saved to your{" "}
              <Link to="/library" className="text-primary underline-offset-4 hover:underline">
                library
              </Link>{" "}
              as a draft. Pushing into a GHL campaign as a draft email arrives with the GHL
              integration (Phase 15).
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Sequence result ── */}
      {sequencePieces.length > 0 && (
        <div className="mt-8 space-y-4">
          <h2 className="text-lg font-semibold">
            {sequenceTitle} — {sequencePieces.length} emails saved as drafts
          </h2>
          {sequencePieces.map((p) => (
            <SequenceEmailCard key={p.id} piece={p} />
          ))}
        </div>
      )}
    </div>
  );
}
