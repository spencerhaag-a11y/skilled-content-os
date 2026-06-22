import { useEffect, useState, type FormEvent } from "react";
import { Settings as SettingsIcon, Loader2, Check, Plug, Unplug, ExternalLink } from "lucide-react";
import { invokeEdgeFunction, supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/authStore";
import { useAccountStore } from "@/stores/accountStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface PushLogRow {
  id: string;
  destination: string;
  status: "success" | "failed";
  ghl_url: string | null;
  error_detail: string | null;
  pushed_at: string;
  content_piece_id: string | null;
}

const DESTINATION_LABELS: Record<string, string> = {
  social_planner: "Social planner",
  email_builder: "Email builder",
  blog: "Blog",
  workflow_sms: "Workflow SMS",
};

export default function AccountSettings() {
  const user = useAuthStore((s) => s.user);
  const account = useAccountStore((s) => s.account);
  const loadForUser = useAccountStore((s) => s.loadForUser);

  const [accountName, setAccountName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);

  const [apiKey, setApiKey] = useState("");
  const [locationId, setLocationId] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [ghlMessage, setGhlMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const [pushLog, setPushLog] = useState<PushLogRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (account) setAccountName(account.name);
  }, [account]);

  useEffect(() => {
    if (!account) return;
    void supabase
      .from("ghl_push_log")
      .select("id, destination, status, ghl_url, error_detail, pushed_at, content_piece_id")
      .eq("account_id", account.id)
      .order("pushed_at", { ascending: false })
      .limit(20)
      .then(({ data, error: loadError }) => {
        if (loadError) setError(loadError.message);
        else setPushLog((data ?? []) as PushLogRow[]);
      });
  }, [account]);

  async function saveName(e: FormEvent) {
    e.preventDefault();
    if (!account || !accountName.trim()) return;
    setSavingName(true);
    setError(null);
    const { error: updateError } = await supabase
      .from("accounts")
      .update({ name: accountName.trim() })
      .eq("id", account.id);
    setSavingName(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setNameSaved(true);
    setTimeout(() => setNameSaved(false), 1500);
  }

  async function connectGhl(e: FormEvent) {
    e.preventDefault();
    setGhlMessage(null);
    if (!apiKey.trim() || !locationId.trim()) {
      setGhlMessage({ kind: "error", text: "Both fields are required." });
      return;
    }
    setConnecting(true);
    try {
      await invokeEdgeFunction("ghl-connect", {
        action: "connect",
        api_key: apiKey.trim(),
        location_id: locationId.trim(),
      });
      setGhlMessage({
        kind: "ok",
        text: "Connected — credentials verified and stored securely. They won't be shown again.",
      });
      setApiKey("");
      setLocationId("");
      if (user) await loadForUser(user.id); // refresh ghl_connected badge
    } catch (err) {
      setGhlMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "Connection failed.",
      });
    } finally {
      setConnecting(false);
    }
  }

  async function disconnectGhl() {
    setDisconnecting(true);
    setGhlMessage(null);
    try {
      await invokeEdgeFunction("ghl-connect", { action: "disconnect" });
      setGhlMessage({ kind: "ok", text: "Disconnected. Stored credentials were removed." });
      if (user) await loadForUser(user.id);
    } catch (err) {
      setGhlMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "Disconnect failed.",
      });
    } finally {
      setDisconnecting(false);
    }
  }

  if (!account) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-12">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <SettingsIcon className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">Account details and integrations.</p>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* ── Account ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
          <CardDescription>
            Platform branding (name, logo, color) is managed by the platform owner.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveName} className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="account-name">Business name</Label>
              <Input
                id="account-name"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={savingName}>
              {savingName ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : nameSaved ? (
                <Check className="h-4 w-4" />
              ) : null}
              Save
            </Button>
          </form>
          <p className="mt-3 text-sm text-muted-foreground">Signed in as {user?.email}</p>
        </CardContent>
      </Card>

      {/* ── GHL connection ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">GoHighLevel</CardTitle>
              <CardDescription>
                One-way push: content created here lands in GHL as drafts. GHL handles all
                sending.
              </CardDescription>
            </div>
            <span
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                account.ghl_connected
                  ? "bg-accent text-accent-foreground"
                  : "bg-secondary text-muted-foreground"
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  account.ghl_connected ? "bg-emerald-500" : "bg-zinc-400"
                )}
              />
              {account.ghl_connected ? "Connected" : "Not connected"}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!account.ghl_connected ? (
            <form onSubmit={connectGhl} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="ghl-key">Private Integration token</Label>
                <Input
                  id="ghl-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="pit-…"
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  GHL → Settings → Private Integrations → create a token with social, email,
                  and blog scopes. Stored server-side, never shown again after save.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ghl-location">Location ID</Label>
                <Input
                  id="ghl-location"
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  placeholder="Your sub-account location ID"
                  autoComplete="off"
                />
              </div>
              <Button type="submit" disabled={connecting}>
                {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
                {connecting ? "Verifying…" : "Connect & test"}
              </Button>
            </form>
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-md border bg-secondary/40 px-4 py-3">
              <p className="text-sm">
                Push is live from the approval board and library on approved content.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void disconnectGhl()}
                disabled={disconnecting}
              >
                {disconnecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Unplug className="h-4 w-4" />
                )}
                Disconnect
              </Button>
            </div>
          )}
          {ghlMessage && (
            <p
              className={cn(
                "text-sm",
                ghlMessage.kind === "ok" ? "text-primary" : "text-destructive"
              )}
            >
              {ghlMessage.text}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Push history ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">GHL push history</CardTitle>
          <CardDescription>Every push attempt, success or failure — last 20.</CardDescription>
        </CardHeader>
        <CardContent>
          {pushLog.length === 0 ? (
            <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              No pushes yet. Approve content on the board, then push it.
            </p>
          ) : (
            <ul className="divide-y">
              {pushLog.map((row) => (
                <li key={row.id} className="flex items-center gap-3 py-2.5">
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      row.status === "success" ? "bg-emerald-500" : "bg-destructive"
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {DESTINATION_LABELS[row.destination] ?? row.destination}
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        · {new Date(row.pushed_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                      </span>
                    </p>
                    {row.error_detail && (
                      <p className="truncate text-xs text-destructive">{row.error_detail}</p>
                    )}
                  </div>
                  {row.ghl_url && (
                    <a
                      href={row.ghl_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      aria-label="Open in GHL"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
