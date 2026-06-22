import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Quote, Loader2, Check, Trash2, Sparkles, Plus, X, LinkIcon } from "lucide-react";
import { invokeEdgeFunction, supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/authStore";
import { useAccountStore } from "@/stores/accountStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const SOURCES = [
  { value: "google", label: "Google" },
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "direct", label: "Direct" },
  { value: "other", label: "Other" },
];

const DEFAULT_QUESTIONS = [
  "What was going on before you started working with us?",
  "What's changed since? Be specific if you can.",
  "What surprised you most about the experience?",
  "What results can you point to?",
  "Who would you recommend us to?",
];

interface Testimonial {
  id: string;
  client_name: string;
  raw_text: string;
  service_tag: string | null;
  client_type_tag: string | null;
  outcome_tag: string | null;
  source: string;
  created_at: string;
}

interface FormRow {
  id: string;
  title: string;
  questions_json: string[];
  share_link_token: string;
  is_active: boolean;
  created_at: string;
}

interface ResponseRow {
  id: string;
  form_id: string;
  client_name: string;
  answers_json: { question: string; answer: string }[];
  created_at: string;
}

function TagBadge({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium">
      {label}: {value}
    </span>
  );
}

export default function Testimonials() {
  const user = useAuthStore((s) => s.user);
  const account = useAccountStore((s) => s.account);

  const [tab, setTab] = useState<"reviews" | "forms">("reviews");
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
  const [forms, setForms] = useState<FormRow[]>([]);
  const [responses, setResponses] = useState<ResponseRow[]>([]);

  // Add-testimonial form
  const [tName, setTName] = useState("");
  const [tText, setTText] = useState("");
  const [tSource, setTSource] = useState("google");
  const [tService, setTService] = useState("");
  const [tClientType, setTClientType] = useState("");
  const [tOutcome, setTOutcome] = useState("");
  const [adding, setAdding] = useState(false);

  // Form builder
  const [formTitle, setFormTitle] = useState("Client feedback");
  const [formQuestions, setFormQuestions] = useState<string[]>(DEFAULT_QUESTIONS);
  const [creatingForm, setCreatingForm] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // Generation
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [generatedFor, setGeneratedFor] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    async function load(accountId: string) {
      setLoading(true);
      const [tRes, fRes, rRes] = await Promise.all([
        supabase
          .from("testimonials")
          .select("id, client_name, raw_text, service_tag, client_type_tag, outcome_tag, source, created_at")
          .eq("account_id", accountId)
          .order("created_at", { ascending: false }),
        supabase
          .from("testimonial_forms")
          .select("id, title, questions_json, share_link_token, is_active, created_at")
          .eq("account_id", accountId)
          .order("created_at", { ascending: false }),
        supabase
          .from("testimonial_responses")
          .select("id, form_id, client_name, answers_json, created_at")
          .eq("account_id", accountId)
          .order("created_at", { ascending: false }),
      ]);
      if (cancelled) return;
      const firstError = tRes.error ?? fRes.error ?? rRes.error;
      if (firstError) setPageError(firstError.message);
      setTestimonials((tRes.data ?? []) as Testimonial[]);
      setForms((fRes.data ?? []) as FormRow[]);
      setResponses((rRes.data ?? []) as ResponseRow[]);
      setLoading(false);
    }
    void load(account.id);
    return () => {
      cancelled = true;
    };
  }, [account]);

  async function addTestimonial(e: FormEvent) {
    e.preventDefault();
    if (!account || !user) return;
    setPageError(null);
    if (tText.trim().length < 10) {
      setPageError("Paste the testimonial text first (10+ characters).");
      return;
    }
    setAdding(true);
    const { data, error } = await supabase
      .from("testimonials")
      .insert({
        account_id: account.id,
        created_by: user.id,
        client_name: tName.trim(),
        raw_text: tText.trim(),
        source: tSource,
        service_tag: tService.trim() || null,
        client_type_tag: tClientType.trim() || null,
        outcome_tag: tOutcome.trim() || null,
      })
      .select("id, client_name, raw_text, service_tag, client_type_tag, outcome_tag, source, created_at")
      .single();
    setAdding(false);
    if (error) {
      setPageError(error.message);
      return;
    }
    setTestimonials((arr) => [data as Testimonial, ...arr]);
    setTName("");
    setTText("");
    setTService("");
    setTClientType("");
    setTOutcome("");
  }

  async function deleteTestimonial(id: string) {
    const { error } = await supabase.from("testimonials").delete().eq("id", id);
    if (error) {
      setPageError(error.message);
      return;
    }
    setTestimonials((arr) => arr.filter((t) => t.id !== id));
  }

  async function generateContent(testimonialId: string) {
    setPageError(null);
    setGeneratingId(testimonialId);
    try {
      const result = await invokeEdgeFunction<{ pieces: { id: string }[] }>(
        "generate-testimonial-content",
        { testimonial_id: testimonialId }
      );
      setGeneratedFor((m) => ({ ...m, [testimonialId]: result.pieces.length }));
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setGeneratingId(null);
    }
  }

  async function createForm(e: FormEvent) {
    e.preventDefault();
    if (!account || !user) return;
    setPageError(null);
    const questions = formQuestions.map((q) => q.trim()).filter(Boolean);
    if (questions.length === 0) {
      setPageError("Add at least one question.");
      return;
    }
    setCreatingForm(true);
    const { data, error } = await supabase
      .from("testimonial_forms")
      .insert({
        account_id: account.id,
        created_by: user.id,
        title: formTitle.trim() || "Client feedback",
        questions_json: questions,
      })
      .select("id, title, questions_json, share_link_token, is_active, created_at")
      .single();
    setCreatingForm(false);
    if (error) {
      setPageError(error.message);
      return;
    }
    setForms((arr) => [data as FormRow, ...arr]);
  }

  async function copyShareLink(form: FormRow) {
    const url = `${window.location.origin}/t/${form.share_link_token}`;
    await navigator.clipboard.writeText(url);
    setCopiedToken(form.share_link_token);
    setTimeout(() => setCopiedToken(null), 1500);
  }

  async function generateFromResponse(response: ResponseRow) {
    // Form responses were mirrored into testimonials at submit time; find the
    // matching testimonial by content. If trimmed away, regenerate from a
    // fresh mirror insert.
    if (!account || !user) return;
    setPageError(null);
    setGeneratingId(response.id);
    try {
      const rawText = response.answers_json
        .map((a) => `Q: ${a.question}\nA: ${a.answer}`)
        .join("\n\n");
      let { data: match } = await supabase
        .from("testimonials")
        .select("id")
        .eq("account_id", account.id)
        .eq("raw_text", rawText)
        .limit(1)
        .maybeSingle();
      if (!match) {
        const { data: inserted, error: insertError } = await supabase
          .from("testimonials")
          .insert({
            account_id: account.id,
            created_by: user.id,
            client_name: response.client_name,
            raw_text: rawText,
            source: "form",
          })
          .select("id")
          .single();
        if (insertError) throw new Error(insertError.message);
        match = inserted;
      }
      const result = await invokeEdgeFunction<{ pieces: { id: string }[] }>(
        "generate-testimonial-content",
        { testimonial_id: match.id }
      );
      setGeneratedFor((m) => ({ ...m, [response.id]: result.pieces.length }));
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setGeneratingId(null);
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
    <div className="mx-auto max-w-3xl pb-12">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Quote className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Testimonials</h1>
          <p className="text-sm text-muted-foreground">
            Collect client proof and turn it into polished content automatically.
          </p>
        </div>
      </div>

      <div className="mb-6 flex rounded-lg border p-1">
        {(
          [
            ["reviews", "Review manager"],
            ["forms", "Feedback forms"],
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

      {pageError && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {pageError}
        </p>
      )}

      {tab === "reviews" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add a testimonial</CardTitle>
              <CardDescription>
                Paste a Google/Facebook review or anything a client said, then tag it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={addTestimonial} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="t-name">Client name</Label>
                    <Input id="t-name" value={tName} onChange={(e) => setTName(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="t-source">Source</Label>
                    <select
                      id="t-source"
                      value={tSource}
                      onChange={(e) => setTSource(e.target.value)}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {SOURCES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="t-text">Testimonial text</Label>
                  <Textarea
                    id="t-text"
                    rows={4}
                    value={tText}
                    onChange={(e) => setTText(e.target.value)}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="t-service">Service tag</Label>
                    <Input
                      id="t-service"
                      value={tService}
                      onChange={(e) => setTService(e.target.value)}
                      placeholder="e.g. Hockey RTS"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="t-client">Client type</Label>
                    <Input
                      id="t-client"
                      value={tClientType}
                      onChange={(e) => setTClientType(e.target.value)}
                      placeholder="e.g. HS athlete"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="t-outcome">Outcome tag</Label>
                    <Input
                      id="t-outcome"
                      value={tOutcome}
                      onChange={(e) => setTOutcome(e.target.value)}
                      placeholder="e.g. back on ice"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button type="submit" disabled={adding}>
                    {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Add testimonial
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {testimonials.length === 0 ? (
            <p className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              No testimonials yet. Add one above or send out a feedback form.
            </p>
          ) : (
            testimonials.map((t) => (
              <Card key={t.id}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">
                        {t.client_name || "Anonymous"}{" "}
                        <span className="font-normal text-muted-foreground">
                          · {t.source} · {new Date(t.created_at).toLocaleDateString()}
                        </span>
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <TagBadge label="Service" value={t.service_tag} />
                        <TagBadge label="Client" value={t.client_type_tag} />
                        <TagBadge label="Outcome" value={t.outcome_tag} />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void deleteTestimonial(t.id)}
                      className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label="Delete testimonial"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="whitespace-pre-wrap rounded-md bg-secondary/40 p-3 text-sm">
                    {t.raw_text}
                  </p>
                  <div className="flex items-center gap-3">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void generateContent(t.id)}
                      disabled={generatingId !== null}
                    >
                      {generatingId === t.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                      {generatingId === t.id ? "Creating 4 assets…" : "Generate content"}
                    </Button>
                    {generatedFor[t.id] && (
                      <p className="text-sm text-primary">
                        {generatedFor[t.id]} drafts created — see the{" "}
                        <Link to="/kanban" className="underline underline-offset-4">
                          board
                        </Link>
                        .
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {tab === "forms" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Build a feedback form</CardTitle>
              <CardDescription>
                Clients get a link — no login needed. Answers land here automatically.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={createForm} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="form-title">Form title</Label>
                  <Input
                    id="form-title"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Guided questions</Label>
                  <div className="space-y-2">
                    {formQuestions.map((q, i) => (
                      <div key={i} className="flex gap-2">
                        <Input
                          value={q}
                          onChange={(e) =>
                            setFormQuestions((arr) =>
                              arr.map((x, idx) => (idx === i ? e.target.value : x))
                            )
                          }
                          aria-label={`Question ${i + 1}`}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setFormQuestions((arr) => arr.filter((_, idx) => idx !== i))
                          }
                          className="rounded p-2 text-muted-foreground hover:bg-secondary"
                          aria-label="Remove question"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                  {formQuestions.length < 10 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setFormQuestions((arr) => [...arr, ""])}
                    >
                      <Plus className="h-4 w-4" />
                      Add question
                    </Button>
                  )}
                </div>
                <div className="flex justify-end">
                  <Button type="submit" disabled={creatingForm}>
                    {creatingForm && <Loader2 className="h-4 w-4 animate-spin" />}
                    Create form & get link
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {forms.map((form) => {
            const formResponses = responses.filter((r) => r.form_id === form.id);
            return (
              <Card key={form.id}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base">{form.title}</CardTitle>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void copyShareLink(form)}
                    >
                      {copiedToken === form.share_link_token ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <LinkIcon className="h-4 w-4" />
                      )}
                      {copiedToken === form.share_link_token ? "Copied" : "Copy share link"}
                    </Button>
                  </div>
                  <CardDescription>
                    {form.questions_json.length} questions · {formResponses.length} responses ·
                    created {new Date(form.created_at).toLocaleDateString()}
                  </CardDescription>
                </CardHeader>
                {formResponses.length > 0 && (
                  <CardContent className="space-y-3 pt-0">
                    {formResponses.map((r) => (
                      <div key={r.id} className="rounded-md border p-3">
                        <p className="text-sm font-semibold">
                          {r.client_name || "Anonymous"}{" "}
                          <span className="font-normal text-muted-foreground">
                            · {new Date(r.created_at).toLocaleDateString()}
                          </span>
                        </p>
                        <div className="mt-2 space-y-2">
                          {r.answers_json.map((a, i) => (
                            <div key={i} className="text-sm">
                              <p className="text-xs font-medium text-muted-foreground">
                                {a.question}
                              </p>
                              <p>{a.answer}</p>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 flex items-center gap-3">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void generateFromResponse(r)}
                            disabled={generatingId !== null}
                          >
                            {generatingId === r.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Sparkles className="h-4 w-4" />
                            )}
                            {generatingId === r.id ? "Creating 4 assets…" : "Generate content"}
                          </Button>
                          {generatedFor[r.id] && (
                            <p className="text-sm text-primary">
                              {generatedFor[r.id]} drafts created.
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
