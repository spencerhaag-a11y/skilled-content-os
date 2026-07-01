import { useEffect, useRef, useState, type FormEvent } from "react";
import { Palette, Globe, Loader2, Check } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { useAccountStore } from "@/stores/accountStore";
import {
  useBrandKitStore,
  EMPTY_BRAND_KIT,
  type BrandKitDraft,
  type PlatformEntry,
} from "@/stores/brandKitStore";
import { calculateBrandScore, SCORE_ITEMS } from "@/lib/brandScore";
import { invokeEdgeFunction } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { TagInput } from "@/components/TagInput";

const PLATFORM_OPTIONS = ["Instagram", "TikTok", "LinkedIn", "Facebook", "X"];

const HEX_RE = /^#[0-9a-f]{6}$/i;

/** Coerce free-typed text into a "#" + up-to-6 hex-digit string (accepts paste
 *  with or without a leading "#", strips invalid chars, lowercases). */
function normalizeHexInput(value: string): string {
  const digits = value.replace(/[^0-9a-fA-F]/g, "").toLowerCase().slice(0, 6);
  return `#${digits}`;
}

/** A safe value for a <input type="color">, which requires a full 6-digit hex. */
function swatchValue(hex: string): string {
  return HEX_RE.test(hex) ? hex : "#000000";
}

interface ScanSuggestions {
  business_name?: string;
  tagline?: string;
  mission?: string;
  voice?: string[];
  icp?: Partial<BrandKitDraft["icp"]>;
  pillars?: string[];
}

export default function BrandKit() {
  const user = useAuthStore((s) => s.user);
  const account = useAccountStore((s) => s.account);
  const { kit: storedKit, status, error, load, save } = useBrandKitStore();

  const [form, setForm] = useState<BrandKitDraft>(EMPTY_BRAND_KIT);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const dirtyRef = useRef(false);
  const [scanState, setScanState] = useState<"idle" | "scanning" | "applied" | "error">("idle");
  const [scanError, setScanError] = useState<string | null>(null);
  const [newHex, setNewHex] = useState("#");
  const [colorError, setColorError] = useState<string | null>(null);

  useEffect(() => {
    if (account) void load(account.id);
  }, [account, load]);

  useEffect(() => {
    if (status === "ready") setForm(storedKit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const liveScore = calculateBrandScore(form);

  function update<K extends keyof BrandKitDraft>(key: K, value: BrandKitDraft[K]) {
    markDirty();
    setForm((f) => ({ ...f, [key]: value }));
  }

  function updateIcp(key: keyof BrandKitDraft["icp"], value: string) {
    markDirty();
    setForm((f) => ({ ...f, icp: { ...f.icp, [key]: value } }));
  }

  function togglePlatform(platform: string) {
    markDirty();
    setForm((f) => {
      const exists = f.platforms.some((p) => p.platform === platform);
      const platforms: PlatformEntry[] = exists
        ? f.platforms.filter((p) => p.platform !== platform)
        : [...f.platforms, { platform, handle: "" }];
      return { ...f, platforms };
    });
  }

  function updateHandle(platform: string, handle: string) {
    markDirty();
    setForm((f) => ({
      ...f,
      platforms: f.platforms.map((p) => (p.platform === platform ? { ...p, handle } : p)),
    }));
  }

  function updateColor(index: number, hex: string) {
    markDirty();
    setForm((f) => {
      const brand_colors = [...f.brand_colors];
      brand_colors[index] = hex;
      return { ...f, brand_colors };
    });
  }

  function addColor() {
    if (form.brand_colors.length >= 6) return;
    if (!HEX_RE.test(newHex)) {
      setColorError("Enter a full 6-digit hex like #5b0e14.");
      return;
    }
    if (form.brand_colors.some((c) => c.toLowerCase() === newHex.toLowerCase())) {
      setColorError("That color is already in your palette.");
      return;
    }
    setColorError(null);
    update("brand_colors", [...form.brand_colors, newHex.toLowerCase()]);
    setNewHex("#");
  }

  function markDirty() {
    dirtyRef.current = true;
    setSaveStatus((s) => (s === "saving" ? s : "idle"));
  }

  /** Persist the kit to Supabase. Auto-save (force=false, fired on field blur)
   *  only writes when something actually changed and every color is a valid
   *  hex; the Save button forces a write. */
  async function commit(force = false) {
    if (!account || !user) return;
    if (!force && !dirtyRef.current) return;
    if (form.brand_colors.some((c) => !HEX_RE.test(c))) {
      if (force) setColorError("Fix the highlighted hex color before saving.");
      return;
    }
    dirtyRef.current = false;
    setSaveStatus("saving");
    const ok = await save(account.id, user.id, form);
    setSaveStatus(ok ? "saved" : "error");
  }

  async function handleScan() {
    if (!form.url.trim()) {
      setScanError("Enter your business URL first.");
      setScanState("error");
      return;
    }
    setScanState("scanning");
    setScanError(null);
    try {
      const { suggestions } = await invokeEdgeFunction<{ suggestions: ScanSuggestions }>(
        "brand-scan",
        { url: form.url.trim() }
      );
      // Fill empty fields only — never overwrite what's already entered.
      setForm((f) => ({
        ...f,
        business_name: f.business_name || suggestions.business_name || "",
        tagline: f.tagline || suggestions.tagline || "",
        mission: f.mission || suggestions.mission || "",
        voice: f.voice.length ? f.voice : suggestions.voice ?? [],
        pillars: f.pillars.length ? f.pillars : suggestions.pillars ?? [],
        icp: {
          demographics: f.icp.demographics || suggestions.icp?.demographics || "",
          pain_points: f.icp.pain_points || suggestions.icp?.pain_points || "",
          goals: f.icp.goals || suggestions.icp?.goals || "",
          objections: f.icp.objections || suggestions.icp?.objections || "",
        },
      }));
      markDirty();
      setScanState("applied");
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Scan failed.");
      setScanState("error");
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await commit(true);
  }

  if (status === "loading" || status === "idle") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl pb-16">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Palette className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Brand Kit</h1>
            <p className="text-sm text-muted-foreground">
              The foundation every piece of AI content pulls from.
            </p>
          </div>
        </div>

        {/* Live brand score */}
        <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-2.5">
          <div className="h-2 w-28 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${liveScore}%` }}
            />
          </div>
          <span className="text-sm font-semibold tabular-nums">{liveScore}%</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} onBlur={() => void commit()} className="space-y-6">
        {/* ── Identity ── */}
        <Card>
          <CardHeader>
            <CardTitle>Identity</CardTitle>
            <CardDescription>
              Who you are. Enter your URL and scan to auto-fill from your website.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="url">Business URL</Label>
              <div className="flex gap-2">
                <Input
                  id="url"
                  placeholder="skilledfitnesstherapy.com"
                  value={form.url}
                  onChange={(e) => update("url", e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleScan}
                  disabled={scanState === "scanning"}
                  className="shrink-0"
                >
                  {scanState === "scanning" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Globe className="h-4 w-4" />
                  )}
                  {scanState === "scanning" ? "Scanning…" : "Scan site"}
                </Button>
              </div>
              {scanState === "applied" && (
                <p className="text-sm text-primary">
                  Scan complete — empty fields were filled. Review and adjust before saving.
                </p>
              )}
              {scanState === "error" && scanError && (
                <p className="text-sm text-destructive">{scanError}</p>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="business_name">Business name</Label>
                <Input
                  id="business_name"
                  value={form.business_name}
                  onChange={(e) => update("business_name", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tagline">Tagline</Label>
                <Input
                  id="tagline"
                  value={form.tagline}
                  onChange={(e) => update("tagline", e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mission">Mission statement</Label>
              <Textarea
                id="mission"
                rows={3}
                value={form.mission}
                onChange={(e) => update("mission", e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {/* ── Voice ── */}
        <Card>
          <CardHeader>
            <CardTitle>Brand voice</CardTitle>
            <CardDescription>
              Tone descriptors the AI writes in — e.g. direct, educational, motivating.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TagInput
              id="voice"
              value={form.voice}
              onChange={(v) => update("voice", v)}
              placeholder="Type a descriptor and press Enter"
              max={6}
            />
          </CardContent>
        </Card>

        {/* ── ICP ── */}
        <Card>
          <CardHeader>
            <CardTitle>Ideal client profile</CardTitle>
            <CardDescription>Who the content speaks to.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="icp-demographics">Demographics</Label>
              <Textarea
                id="icp-demographics"
                rows={3}
                value={form.icp.demographics}
                onChange={(e) => updateIcp("demographics", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="icp-pain">Pain points</Label>
              <Textarea
                id="icp-pain"
                rows={3}
                value={form.icp.pain_points}
                onChange={(e) => updateIcp("pain_points", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="icp-goals">Goals</Label>
              <Textarea
                id="icp-goals"
                rows={3}
                value={form.icp.goals}
                onChange={(e) => updateIcp("goals", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="icp-objections">Objections</Label>
              <Textarea
                id="icp-objections"
                rows={3}
                value={form.icp.objections}
                onChange={(e) => updateIcp("objections", e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {/* ── Pillars ── */}
        <Card>
          <CardHeader>
            <CardTitle>Content pillars</CardTitle>
            <CardDescription>3 to 5 topic areas your brand consistently covers.</CardDescription>
          </CardHeader>
          <CardContent>
            <TagInput
              id="pillars"
              value={form.pillars}
              onChange={(v) => update("pillars", v)}
              placeholder="e.g. Injury prevention — press Enter"
              max={5}
            />
            {form.pillars.length > 0 && form.pillars.length < 3 && (
              <p className="mt-2 text-sm text-muted-foreground">
                Add {3 - form.pillars.length} more to complete this section.
              </p>
            )}
          </CardContent>
        </Card>

        {/* ── Platforms ── */}
        <Card>
          <CardHeader>
            <CardTitle>Active platforms</CardTitle>
            <CardDescription>Where your content gets published, with handles.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {PLATFORM_OPTIONS.map((platform) => {
              const entry = form.platforms.find((p) => p.platform === platform);
              return (
                <div key={platform} className="flex items-center gap-3">
                  <label className="flex w-32 shrink-0 cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!!entry}
                      onChange={() => togglePlatform(platform)}
                      className="h-4 w-4 rounded border-input accent-[hsl(var(--primary))]"
                    />
                    {platform}
                  </label>
                  {entry && (
                    <Input
                      value={entry.handle}
                      onChange={(e) => updateHandle(platform, e.target.value)}
                      placeholder="@handle"
                      className="h-9"
                    />
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* ── Competitors ── */}
        <Card>
          <CardHeader>
            <CardTitle>Competitors</CardTitle>
            <CardDescription>
              Used by Social Listener and Niche Research to find gaps and opportunities.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TagInput
              id="competitors"
              value={form.competitors}
              onChange={(v) => update("competitors", v)}
              placeholder="Competitor name — press Enter"
            />
          </CardContent>
        </Card>

        {/* ── Visual identity ── */}
        <Card>
          <CardHeader>
            <CardTitle>Visual identity</CardTitle>
            <CardDescription>Brand colors and typography preferences.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Brand colors</Label>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {form.brand_colors.map((hex, i) => (
                    <div key={i} className="flex items-center gap-1.5 rounded-md border p-1.5">
                      <input
                        type="color"
                        value={swatchValue(hex)}
                        onChange={(e) => updateColor(i, e.target.value)}
                        className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
                        aria-label={`Brand color ${i + 1} swatch`}
                      />
                      <Input
                        value={hex}
                        onChange={(e) => updateColor(i, normalizeHexInput(e.target.value))}
                        spellCheck={false}
                        className="h-7 w-[5.5rem] font-mono text-xs uppercase"
                        aria-label={`Brand color ${i + 1} hex`}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          update(
                            "brand_colors",
                            form.brand_colors.filter((_, idx) => idx !== i)
                          )
                        }
                        className="rounded px-1 text-muted-foreground hover:text-foreground"
                        aria-label="Remove color"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>

                {form.brand_colors.length < 6 && (
                  <div className="flex items-center gap-1.5">
                    <div className="flex items-center gap-1.5 rounded-md border p-1.5">
                      <input
                        type="color"
                        value={swatchValue(newHex)}
                        onChange={(e) => {
                          setNewHex(e.target.value);
                          setColorError(null);
                        }}
                        className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
                        aria-label="New color swatch"
                      />
                      <Input
                        value={newHex}
                        onChange={(e) => {
                          setNewHex(normalizeHexInput(e.target.value));
                          setColorError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addColor();
                          }
                        }}
                        placeholder="#5b0e14"
                        spellCheck={false}
                        className="h-7 w-[5.5rem] font-mono text-xs uppercase"
                        aria-label="New brand color hex"
                      />
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={addColor}>
                      Add color
                    </Button>
                  </div>
                )}
                {colorError && <p className="text-sm text-destructive">{colorError}</p>}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="typography">Typography preferences</Label>
              <Input
                id="typography"
                placeholder="e.g. Anton for headlines, Inter for body"
                value={form.typography}
                onChange={(e) => update("typography", e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {/* ── Score breakdown ── */}
        <Card>
          <CardHeader>
            <CardTitle>What's left</CardTitle>
            <CardDescription>
              Complete every item to reach 100% and fully unlock content quality.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {SCORE_ITEMS.map((item) => {
                const done = item.complete(form);
                return (
                  <li key={item.label} className="flex items-center gap-2 text-sm">
                    <span
                      className={
                        done
                          ? "flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground"
                          : "h-4 w-4 rounded-full border border-input"
                      }
                    >
                      {done && <Check className="h-3 w-3" />}
                    </span>
                    <span className={done ? "" : "text-muted-foreground"}>{item.label}</span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="sticky bottom-0 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur lg:-mx-8 lg:px-8">
          <div className="mx-auto flex max-w-3xl items-center justify-between">
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              {saveStatus === "saving" ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
                </>
              ) : saveStatus === "saved" ? (
                <>
                  <Check className="h-3.5 w-3.5 text-primary" /> Saved
                </>
              ) : saveStatus === "error" ? (
                <span className="text-destructive">Couldn't save — try the Save button.</span>
              ) : (
                "Changes save automatically when you click out of a field."
              )}
            </p>
            <Button type="submit" disabled={saveStatus === "saving"}>
              {saveStatus === "saving" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : saveStatus === "saved" ? (
                <Check className="h-4 w-4" />
              ) : null}
              {saveStatus === "saving" ? "Saving…" : "Save brand kit"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
