import { useState, type FormEvent } from "react";
import { KeyRound, Loader2, AlertTriangle } from "lucide-react";
import { invokeEdgeFunction } from "@/lib/supabase";
import { useAuthStore } from "@/stores/authStore";
import { useAccountStore } from "@/stores/accountStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MIN_LENGTH = 10;

/**
 * Shown instead of the app when profiles.must_change_password is true — the
 * first login of an invited team member, who arrived with a generated
 * temporary password.
 *
 * The flag is cleared by team-set-password as a side effect of actually
 * setting the new password, never by this component, so there is no request
 * this screen could skip to get past itself.
 */
export default function ForcePasswordChange() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const loadForUser = useAccountStore((s) => s.loadForUser);
  const email = useAccountStore((s) => s.profile?.email);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_LENGTH) {
      return setError(`Choose a password of at least ${MIN_LENGTH} characters.`);
    }
    if (password !== confirm) {
      return setError("Those two passwords don't match.");
    }

    setSaving(true);
    try {
      await invokeEdgeFunction("team-set-password", { password });
      // Re-read the profile so must_change_password is false and the gate
      // falls away — no full reload, and no stale flag left in the store.
      if (user) await loadForUser(user.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set your password.");
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <KeyRound className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Choose your password</h1>
          <p className="text-sm text-muted-foreground">
            {email
              ? `You're signed in as ${email}. Replace the temporary password you were sent to continue.`
              : "Replace the temporary password you were sent to continue."}
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="fpc-new">New password</Label>
                <Input
                  id="fpc-new"
                  type="password"
                  autoComplete="new-password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  At least {MIN_LENGTH} characters.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="fpc-confirm">Confirm new password</Label>
                <Input
                  id="fpc-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <span>{error}</span>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Set password and continue
              </Button>
            </form>
          </CardContent>
        </Card>

        <button
          type="button"
          onClick={() => void signOut()}
          className="mx-auto mt-4 block text-xs text-muted-foreground hover:text-foreground"
        >
          Sign out instead
        </button>
      </div>
    </div>
  );
}
