import { useEffect, useState, type FormEvent } from "react";
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
  const [saved, setSaved] = useState(false);
  const [scanState, setScanState] = useState<"idle" | "scanning" | "applied" | "error">("idle");
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => {
    if (account) void load(account.id);
  }, [account, load]);

  useEffect(() => {
    if (status === "ready") setForm(storedKit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const liveScore = calculateBrandScore(form);

  function update<K extends keyof BrandKitDraft>(key: K, value: BrandKitDraft[K]) {
    setSaved(false);
    setForm((f) => ({ ...f, [key]: value }));
  }

  function updateIcp(key: keyof BrandKitDraft["icp"], value: string) {
    setSaved(false);
    setForm((f) => ({ ...f, icp: { ...f.icp, [key]: value } }));
  }

  function togglePlatform(platform: string) {
    setSaved(false);
    setForm((f) => {
      const exists = f.platforms.some((p) => p.platform === platform);
      const platforms: PlatformEntry[] = exists
        ? f.platforms.filter((p) => p.platform !== platform)
        : [...f.platforms, { platform, handle: "" }];
      return { ...f, platforms };
    });
  }

  function updateHandle(platform: string, handle: string) {
    setSaved(false);
    setForm((f) => ({
      ...f,
      platforms: f.platforms.map((p) => (p.platform === platform ? { ...p, handle } : p)),
    }));
  }

  function updateColor(index: number, hex: string) {
    setSaved(false);
    setForm((f) => {
      const brand_colors = [...f.brand_colors];
      brand_colors[index] = hex;
      return { ...f, brand_colors };
    });
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
      setSaved(false);
      setScanState("applied");
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Scan failed.");
      setScanState("error");
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!account || !user) return;
    const invalidColor = form.brand_colors.find((c) => !/^#[0-9a-f]{6}$/i.test(c));
    if (invalidColor) return; // color pickers always emit valid hex; guard anyway
    const ok = await save(account.id, user.id, form);
    if (ok) setSaved(true);
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

      <form onSubmit={handleSubmit} className="space-y-6">
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
              <div className="flex flex-wrap items-center gap-2">
                {form.brand_colors.map((hex, i) => (
                  <div key={i} className="flex items-center gap-1.5 rounded-md border p-1.5">
                    <input
                      type="color"
                      value={/^#[0-9a-f]{6}$/i.test(hex) ? hex : "#000000"}
                      onChange={(e) => updateColor(i, e.target.value)}
                      className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
                      aria-label={`Brand color ${i + 1}`}
                    />
                    <span className="text-xs font-medium uppercase tabular-nums">{hex}</span>
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
                {form.brand_colors.length < 6 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => update("brand_colors", [...form.brand_colors, "#1a8a4f"])}
                  >
                    Add color
                  </Button>
                )}
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
            <p className="text-sm text-muted-foreground">
              {saved ? "Saved." : "Unsaved changes apply to all future AI content."}
            </p>
            <Button type="submit" disabled={status === "saving"}>
              {status === "saving" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : saved ? (
                <Check className="h-4 w-4" />
              ) : null}
              {status === "saving" ? "Saving…" : saved ? "Saved" : "Save brand kit"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
