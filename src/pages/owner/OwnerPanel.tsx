import { useEffect, useState } from "react";
import {
  ShieldCheck,
  Loader2,
  Building2,
  ToggleLeft,
  ToggleRight,
  LayoutTemplate,
  Sparkles,
  Plus,
  Trash2,
  Save,
  Check,
  Power,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/authStore";
import { MODULES } from "@/lib/modules";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Tab = "accounts" | "templates" | "prompts";

interface OwnerAccount {
  id: string;
  name: string;
  white_label_name: string | null;
  logo_url: string | null;
  primary_color: string | null;
  plan: string;
  is_active: boolean;
  disabled_modules: string[];
}
interface SectionTemplate {
  id: string;
  section_type: string;
  title: string;
  description: string;
  sort_order: number;
  use_in_generation: boolean;
  is_active: boolean;
}
interface StarterPrompt {
  id: string;
  name: string;
  prompt_text: string;
  content_type: string | null;
}

// Modules that can never be disabled (clients always need an entry + a way out).
const ALWAYS_ON = new Set(["/", "/settings"]);
const TOGGLEABLE = MODULES.filter((m) => !ALWAYS_ON.has(m.path));

export default function OwnerPanel() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [tab, setTab] = useState<Tab>("accounts");

  return (
    <div className="mx-auto max-w-4xl pb-12">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Owner Panel</h1>
          <p className="text-sm text-muted-foreground">
            Platform-wide account, branding, module access, and template management.
          </p>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {([
          { value: "accounts", label: "Accounts", icon: Building2 },
          { value: "templates", label: "Section templates", icon: LayoutTemplate },
          { value: "prompts", label: "Starter prompts", icon: Sparkles },
        ] as const).map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
              tab === t.value ? "border-primary bg-primary text-primary-foreground" : "hover:bg-secondary"
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "accounts" && <AccountsTab />}
      {tab === "templates" && <TemplatesTab />}
      {tab === "prompts" && <PromptsTab userId={userId} />}
    </div>
  );
}

/* ─────────────────────────── Accounts ─────────────────────────── */

function AccountsTab() {
  const [accounts, setAccounts] = useState<OwnerAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error: e } = await supabase
        .from("accounts")
        .select("id, name, white_label_name, logo_url, primary_color, plan, is_active, disabled_modules")
        .order("created_at", { ascending: true });
      if (e) setError(e.message);
      else {
        setAccounts((data ?? []) as OwnerAccount[]);
        setSelectedId((data ?? [])[0]?.id ?? null);
      }
      setLoading(false);
    })();
  }, []);

  const selected = accounts.find((a) => a.id === selectedId) ?? null;

  if (loading) return <PanelSpinner />;
  if (error) return <p className="text-sm text-destructive">{error}</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <div className="space-y-1">
        {accounts.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setSelectedId(a.id)}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-secondary",
              selectedId === a.id && "border-primary bg-secondary"
            )}
          >
            <span className="min-w-0 flex-1 truncate">{a.white_label_name || a.name}</span>
            {!a.is_active && <span className="shrink-0 text-[10px] uppercase text-destructive">off</span>}
          </button>
        ))}
        {accounts.length === 0 && (
          <p className="px-1 text-sm text-muted-foreground">No accounts yet. They appear here after signup.</p>
        )}
      </div>

      {selected && (
        <div className="space-y-6">
          <AccountBrandingCard
            account={selected}
            onSaved={(next) => setAccounts((arr) => arr.map((a) => (a.id === next.id ? next : a)))}
          />
          <FeatureFlagsCard
            account={selected}
            onChange={(next) => setAccounts((arr) => arr.map((a) => (a.id === next.id ? next : a)))}
          />
        </div>
      )}
    </div>
  );
}

function AccountBrandingCard({
  account,
  onSaved,
}: {
  account: OwnerAccount;
  onSaved: (a: OwnerAccount) => void;
}) {
  const [wl, setWl] = useState(account.white_label_name ?? "");
  const [logo, setLogo] = useState(account.logo_url ?? "");
  const [color, setColor] = useState(account.primary_color ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setWl(account.white_label_name ?? "");
    setLogo(account.logo_url ?? "");
    setColor(account.primary_color ?? "");
    setSaved(false);
    setError(null);
  }, [account.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setError(null);
    if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
      setError("Primary color must be a 6-digit hex like #D79A6C.");
      return;
    }
    setBusy(true);
    const patch = {
      white_label_name: wl.trim() || null,
      logo_url: logo.trim() || null,
      primary_color: color.trim() || null,
    };
    const { error: e } = await supabase.from("accounts").update(patch).eq("id", account.id);
    setBusy(false);
    if (e) {
      setError(e.message);
      return;
    }
    onSaved({ ...account, ...patch });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function toggleActive() {
    setBusy(true);
    const { error: e } = await supabase.from("accounts").update({ is_active: !account.is_active }).eq("id", account.id);
    setBusy(false);
    if (e) {
      setError(e.message);
      return;
    }
    onSaved({ ...account, is_active: !account.is_active });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Branding — {account.name}</CardTitle>
          <Button type="button" variant={account.is_active ? "outline" : "default"} size="sm" onClick={() => void toggleActive()} disabled={busy}>
            <Power className="h-4 w-4" />
            {account.is_active ? "Deactivate" : "Reactivate"}
          </Button>
        </div>
        <CardDescription>White-label name, logo, and primary color for this account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="wl">White-label name</Label>
          <Input id="wl" value={wl} onChange={(e) => setWl(e.target.value)} placeholder="Skilled Content OS" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="logo">Logo URL</Label>
          <Input id="logo" value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://…/logo.png" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="color">Primary color (hex)</Label>
          <div className="flex items-center gap-2">
            <Input id="color" value={color} onChange={(e) => setColor(e.target.value)} placeholder="#D79A6C" className="max-w-[180px]" />
            {/^#[0-9a-fA-F]{6}$/.test(color) && <span className="h-9 w-9 rounded border" style={{ backgroundColor: color }} />}
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="button" size="sm" onClick={() => void save()} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {saved ? "Saved" : "Save branding"}
        </Button>
      </CardContent>
    </Card>
  );
}

function FeatureFlagsCard({ account, onChange }: { account: OwnerAccount; onChange: (a: OwnerAccount) => void }) {
  // Feature flags are stored as the accounts.disabled_modules text[] on the row.
  const disabled = new Set(account.disabled_modules);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  async function toggle(path: string) {
    setError(null);
    setPending(path);
    const next = new Set(account.disabled_modules);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    const nextArr = [...next];
    const { error: e } = await supabase
      .from("accounts")
      .update({ disabled_modules: nextArr })
      .eq("id", account.id);
    if (e) setError(e.message);
    else onChange({ ...account, disabled_modules: nextArr });
    setPending(null);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Module access</CardTitle>
        <CardDescription>Disabled modules disappear from this account's sidebar.</CardDescription>
      </CardHeader>
      <CardContent>
        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
        <ul className="divide-y">
          {TOGGLEABLE.map((m) => {
            const on = !disabled.has(m.path);
                return (
                  <li key={m.path} className="flex items-center justify-between gap-3 py-2">
                    <span className="flex items-center gap-2 text-sm">
                      <m.icon className="h-4 w-4 text-muted-foreground" />
                      {m.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => void toggle(m.path)}
                      disabled={pending === m.path}
                      className={cn("transition-colors", on ? "text-primary" : "text-muted-foreground/50")}
                      aria-label={on ? `Disable ${m.name}` : `Enable ${m.name}`}
                    >
                      {pending === m.path ? (
                        <Loader2 className="h-6 w-6 animate-spin" />
                      ) : on ? (
                        <ToggleRight className="h-6 w-6" />
                      ) : (
                        <ToggleLeft className="h-6 w-6" />
                      )}
                    </button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────── Section templates ─────────────────────────── */

function TemplatesTab() {
  const [templates, setTemplates] = useState<SectionTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  // New template form
  const [newType, setNewType] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    const { data, error: e } = await supabase
      .from("kb_section_templates")
      .select("id, section_type, title, description, sort_order, use_in_generation, is_active")
      .order("sort_order", { ascending: true });
    if (e) setError(e.message);
    else setTemplates((data ?? []) as SectionTemplate[]);
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, []);

  async function createTemplate() {
    setError(null);
    const type = newType.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
    if (!type || !newTitle.trim()) {
      setError("Section key and title are required.");
      return;
    }
    setCreating(true);
    const maxOrder = templates.reduce((m, t) => Math.max(m, t.sort_order), 0);
    const { error: e } = await supabase.from("kb_section_templates").insert({
      section_type: type,
      title: newTitle.trim(),
      description: newDesc.trim(),
      sort_order: maxOrder + 10,
    });
    setCreating(false);
    if (e) {
      setError(e.message);
      return;
    }
    setNewType("");
    setNewTitle("");
    setNewDesc("");
    await load();
  }

  async function removeTemplate(id: string) {
    const { error: e } = await supabase.from("kb_section_templates").delete().eq("id", id);
    if (e) setError(e.message);
    else setTemplates((arr) => arr.filter((t) => t.id !== id));
  }

  async function pushToAccounts() {
    setSyncing(true);
    setSyncMsg(null);
    const { data, error: e } = await supabase.rpc("sync_kb_sections_from_templates");
    setSyncing(false);
    if (e) setSyncMsg(e.message);
    else setSyncMsg(`Synced into ${data} account${data === 1 ? "" : "s"}.`);
  }

  if (loading) return <PanelSpinner />;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Add a section template</CardTitle>
          <CardDescription>Templates are instantiated into every client knowledge base.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="t-type">Section key</Label>
              <Input id="t-type" value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="case-studies" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-title">Title</Label>
              <Input id="t-title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Case studies" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-desc">Upload prompt / description</Label>
            <Textarea id="t-desc" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} rows={2} placeholder="What should the client upload here?" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="button" size="sm" onClick={() => void createTemplate()} disabled={creating}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add template
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">Templates ({templates.length})</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={() => void pushToAccounts()} disabled={syncing}>
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Push to all accounts
            </Button>
          </div>
          {syncMsg && <CardDescription>{syncMsg}</CardDescription>}
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {templates.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {t.title}{" "}
                    <span className="text-xs font-normal text-muted-foreground">({t.section_type})</span>
                    {!t.use_in_generation && (
                      <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase">internal</span>
                    )}
                  </p>
                  {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => void removeTemplate(t.id)}
                  className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  aria-label={`Delete ${t.title}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────────────────────── Starter prompts ─────────────────────────── */

function PromptsTab({ userId }: { userId: string | null }) {
  const [prompts, setPrompts] = useState<StarterPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [type, setType] = useState("Social");
  const [creating, setCreating] = useState(false);

  async function load() {
    const { data, error: e } = await supabase
      .from("prompt_library")
      .select("id, name, prompt_text, content_type")
      .eq("is_platform_starter", true)
      .order("created_at", { ascending: false });
    if (e) setError(e.message);
    else setPrompts((data ?? []) as StarterPrompt[]);
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, []);

  async function create() {
    setError(null);
    if (!name.trim() || text.trim().length < 5) {
      setError("Name and prompt text are required.");
      return;
    }
    setCreating(true);
    const { error: e } = await supabase.from("prompt_library").insert({
      name: name.trim(),
      prompt_text: text.trim(),
      content_type: type,
      is_platform_starter: true,
      created_by: userId,
    });
    setCreating(false);
    if (e) {
      setError(e.message);
      return;
    }
    setName("");
    setText("");
    await load();
  }

  async function remove(id: string) {
    const { error: e } = await supabase.from("prompt_library").delete().eq("id", id);
    if (e) setError(e.message);
    else setPrompts((arr) => arr.filter((p) => p.id !== id));
  }

  if (loading) return <PanelSpinner />;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Publish a starter prompt</CardTitle>
          <CardDescription>Starter prompts are visible to every client account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="p-name">Name</Label>
              <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Hook-driven reel" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-type">Category</Label>
              <select
                id="p-type"
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {["Social", "Blog", "Email", "Research", "Repurposing", "Testimonial", "SEO", "GBP", "Brainstorm"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-text">Prompt</Label>
            <Textarea id="p-text" value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Write a 30-second reel script that…" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="button" size="sm" onClick={() => void create()} disabled={creating}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Publish prompt
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Starter prompts ({prompts.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {prompts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No starter prompts published yet.</p>
          ) : (
            <ul className="divide-y">
              {prompts.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {p.name}
                      {p.content_type && <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase">{p.content_type}</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{p.prompt_text}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void remove(p.id)}
                    className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`Delete ${p.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PanelSpinner() {
  return (
    <div className="flex items-center justify-center py-12 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  );
}
