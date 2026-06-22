import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sparkles,
  Loader2,
  Search,
  Copy,
  Check,
  Trash2,
  Pencil,
  X,
  TrendingUp,
  Star,
  MessagesSquare,
  Plus,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/authStore";
import { useAccountStore } from "@/stores/accountStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  "Social",
  "Blog",
  "Email",
  "Research",
  "Repurposing",
  "Testimonial",
  "SEO",
  "GBP",
  "Brainstorm",
];

const PERFORMANCE_TAGS = [
  { value: "", label: "No tag" },
  { value: "high_engagement", label: "High engagement" },
  { value: "converted", label: "Converted" },
  { value: "underperformed", label: "Underperformed" },
];

interface PromptRow {
  id: string;
  account_id: string | null;
  name: string;
  prompt_text: string;
  content_type: string | null;
  platform: string | null;
  pillar: string | null;
  performance_tag: string | null;
  is_platform_starter: boolean;
  created_at: string;
}

const STOPWORDS = new Set([
  "about", "after", "their", "there", "these", "those", "which", "while",
  "would", "should", "could", "every", "where", "being", "doing", "going",
]);

function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 5 && !STOPWORDS.has(w))
  );
}

export default function PromptLibrary() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const account = useAccountStore((s) => s.account);

  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [trendingTopics, setTrendingTopics] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [perfFilter, setPerfFilter] = useState("");
  const [scopeFilter, setScopeFilter] = useState<"all" | "mine" | "starters">("all");

  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<PromptRow | null>(null);
  const [fName, setFName] = useState("");
  const [fText, setFText] = useState("");
  const [fCategory, setFCategory] = useState("Social");
  const [fPlatform, setFPlatform] = useState("");
  const [fPillar, setFPillar] = useState("");
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [promptsRes, researchRes] = await Promise.all([
        supabase
          .from("prompt_library")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(300),
        supabase
          .from("research_sessions")
          .select("results_json")
          .order("created_at", { ascending: false })
          .limit(3),
      ]);
      if (cancelled) return;
      if (promptsRes.error) setError(promptsRes.error.message);
      setPrompts((promptsRes.data ?? []) as PromptRow[]);

      // Trending topics from the latest Niche Research sessions (Module 13:
      // "surface prompts linked to currently trending niche topics").
      const topics: string[] = [];
      for (const row of researchRes.data ?? []) {
        const results = row.results_json as { topics?: { topic?: string }[] } | null;
        for (const t of results?.topics ?? []) {
          if (t?.topic) topics.push(String(t.topic));
        }
      }
      setTrendingTopics(topics.slice(0, 15));
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [account]);

  const trendingKeywords = useMemo(() => {
    const all = new Set<string>();
    for (const t of trendingTopics) for (const k of keywords(t)) all.add(k);
    return all;
  }, [trendingTopics]);

  function isTrending(p: PromptRow): boolean {
    if (trendingKeywords.size === 0) return false;
    const promptWords = keywords(`${p.name} ${p.prompt_text} ${p.pillar ?? ""}`);
    for (const w of promptWords) if (trendingKeywords.has(w)) return true;
    return false;
  }

  const visible = prompts.filter((p) => {
    if (scopeFilter === "mine" && p.is_platform_starter) return false;
    if (scopeFilter === "starters" && !p.is_platform_starter) return false;
    if (categoryFilter && p.content_type !== categoryFilter) return false;
    if (perfFilter && p.performance_tag !== perfFilter) return false;
    if (query) {
      const q = query.toLowerCase();
      if (
        !p.name.toLowerCase().includes(q) &&
        !p.prompt_text.toLowerCase().includes(q) &&
        !(p.pillar ?? "").toLowerCase().includes(q)
      )
        return false;
    }
    return true;
  });

  const trending = visible.filter(isTrending);

  function openAdd() {
    setEditing(null);
    setFName("");
    setFText("");
    setFCategory("Social");
    setFPlatform("");
    setFPillar("");
    setShowAdd(true);
  }

  function openEdit(p: PromptRow) {
    setEditing(p);
    setFName(p.name);
    setFText(p.prompt_text);
    setFCategory(p.content_type ?? "Social");
    setFPlatform(p.platform ?? "");
    setFPillar(p.pillar ?? "");
    setShowAdd(true);
  }

  async function saveForm(e: FormEvent) {
    e.preventDefault();
    if (!account || !user) return;
    if (!fName.trim() || !fText.trim()) {
      setError("Name and prompt text are required.");
      return;
    }
    setSaving(true);
    setError(null);
    if (editing) {
      const update = {
        name: fName.trim(),
        prompt_text: fText,
        content_type: fCategory,
        platform: fPlatform.trim() || null,
        pillar: fPillar.trim() || null,
      };
      const { error: updateError } = await supabase
        .from("prompt_library")
        .update(update)
        .eq("id", editing.id);
      setSaving(false);
      if (updateError) {
        setError(updateError.message);
        return;
      }
      setPrompts((arr) => arr.map((p) => (p.id === editing.id ? { ...p, ...update } : p)));
    } else {
      const { data, error: insertError } = await supabase
        .from("prompt_library")
        .insert({
          account_id: account.id,
          created_by: user.id,
          name: fName.trim(),
          prompt_text: fText,
          content_type: fCategory,
          platform: fPlatform.trim() || null,
          pillar: fPillar.trim() || null,
        })
        .select("*")
        .single();
      setSaving(false);
      if (insertError) {
        setError(insertError.message);
        return;
      }
      setPrompts((arr) => [data as PromptRow, ...arr]);
    }
    setShowAdd(false);
  }

  async function deletePrompt(p: PromptRow) {
    const { error: deleteError } = await supabase.from("prompt_library").delete().eq("id", p.id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setPrompts((arr) => arr.filter((x) => x.id !== p.id));
  }

  async function setPerformanceTag(p: PromptRow, tag: string) {
    const value = tag || null;
    const { error: updateError } = await supabase
      .from("prompt_library")
      .update({ performance_tag: value })
      .eq("id", p.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setPrompts((arr) => arr.map((x) => (x.id === p.id ? { ...x, performance_tag: value } : x)));
  }

  async function copyPrompt(p: PromptRow) {
    await navigator.clipboard.writeText(p.prompt_text);
    setCopiedId(p.id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  function useInBrainstorm(p: PromptRow) {
    sessionStorage.setItem("brainstorm-prefill", p.prompt_text);
    navigate("/brainstorm");
  }

  function PromptCard({ p }: { p: PromptRow }) {
    const own = !p.is_platform_starter;
    return (
      <Card>
        <CardContent className="space-y-2.5 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{p.name}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {p.content_type && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                    {p.content_type}
                  </span>
                )}
                {p.platform && (
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium">
                    {p.platform}
                  </span>
                )}
                {p.pillar && (
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium">
                    {p.pillar}
                  </span>
                )}
                {p.is_platform_starter && (
                  <span className="flex items-center gap-0.5 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                    <Star className="h-2.5 w-2.5" /> Starter
                  </span>
                )}
                {isTrending(p) && (
                  <span className="flex items-center gap-0.5 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800">
                    <TrendingUp className="h-2.5 w-2.5" /> Trending
                  </span>
                )}
                {p.performance_tag && (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium",
                      p.performance_tag === "underperformed"
                        ? "bg-destructive/10 text-destructive"
                        : "bg-accent text-accent-foreground"
                    )}
                  >
                    {p.performance_tag.replace(/_/g, " ")}
                  </span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => void copyPrompt(p)}
                className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                aria-label="Copy prompt"
              >
                {copiedId === p.id ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
              </button>
              {own && (
                <>
                  <button
                    type="button"
                    onClick={() => openEdit(p)}
                    className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                    aria-label="Edit prompt"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void deletePrompt(p)}
                    className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label="Delete prompt"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
          </div>

          <p className="line-clamp-3 whitespace-pre-wrap rounded-md bg-secondary/40 p-2.5 text-xs leading-relaxed">
            {p.prompt_text}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => useInBrainstorm(p)}>
              <MessagesSquare className="h-4 w-4" />
              Use in Brainstorm
            </Button>
            {own && (
              <select
                value={p.performance_tag ?? ""}
                onChange={(e) => void setPerformanceTag(p, e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                aria-label="Performance tag"
              >
                {PERFORMANCE_TAGS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        </CardContent>
      </Card>
    );
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
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Prompt Library</h1>
            <p className="text-sm text-muted-foreground">
              Your saved prompts, getting smarter with trends and performance tags.
            </p>
          </div>
        </div>
        <Button type="button" onClick={openAdd}>
          <Plus className="h-4 w-4" />
          New prompt
        </Button>
      </div>

      {error && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* ── Search + filters ── */}
      <div className="mb-5 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search prompts…"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" aria-label="Category">
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select value={perfFilter} onChange={(e) => setPerfFilter(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" aria-label="Performance">
            <option value="">Any performance</option>
            {PERFORMANCE_TAGS.slice(1).map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <div className="flex rounded-lg border p-0.5">
            {(
              [
                ["all", "All"],
                ["mine", "Mine"],
                ["starters", "Starters"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setScopeFilter(value)}
                className={cn(
                  "rounded-md px-3 py-1 text-sm font-medium transition-colors",
                  scopeFilter === value ? "bg-primary text-primary-foreground" : "hover:bg-secondary"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Trending section ── */}
      {trending.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            <TrendingUp className="h-4 w-4" /> Trending now
          </h2>
          <div className="space-y-3">
            {trending.slice(0, 3).map((p) => (
              <PromptCard key={`trend-${p.id}`} p={p} />
            ))}
          </div>
        </div>
      )}

      {/* ── All prompts ── */}
      <div className="space-y-3">
        {visible.length === 0 ? (
          <p className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
            No prompts match. Save prompts from Brainstorm Chat or add one manually.
          </p>
        ) : (
          visible.map((p) => <PromptCard key={p.id} p={p} />)
        )}
      </div>

      {/* ── Add/edit modal ── */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-10" onClick={() => setShowAdd(false)}>
          <div className="w-full max-w-lg rounded-lg border bg-background shadow-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="flex items-center justify-between border-b p-4">
              <h2 className="text-base font-semibold">{editing ? "Edit prompt" : "New prompt"}</h2>
              <button type="button" onClick={() => setShowAdd(false)} className="rounded p-1.5 text-muted-foreground hover:bg-secondary" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={saveForm} className="space-y-4 p-4">
              <div className="space-y-1.5">
                <Label htmlFor="p-name">Name</Label>
                <Input id="p-name" value={fName} onChange={(e) => setFName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-text">Prompt text</Label>
                <Textarea id="p-text" rows={6} value={fText} onChange={(e) => setFText(e.target.value)} className="text-sm" />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="p-cat">Category</Label>
                  <select id="p-cat" value={fCategory} onChange={(e) => setFCategory(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm">
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-platform">Platform</Label>
                  <Input id="p-platform" value={fPlatform} onChange={(e) => setFPlatform(e.target.value)} placeholder="Optional" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-pillar">Pillar</Label>
                  <Input id="p-pillar" value={fPillar} onChange={(e) => setFPillar(e.target.value)} placeholder="Optional" />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
                <Button type="submit" disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {editing ? "Save changes" : "Save prompt"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
