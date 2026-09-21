import { useCallback, useEffect, useState } from "react";
import { Users, UserPlus, ArrowLeft, Loader2, AlertTriangle, Check } from "lucide-react";
import { invokeEdgeFunction, supabase } from "@/lib/supabase";
import { PermissionGrid } from "@/components/PermissionGrid";
import {
  emptyPermissionMap,
  PERMISSION_KEYS,
  type PermissionKey,
} from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface TeamMemberRow {
  id: string;
  email: string;
  full_name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
}

type View =
  | { mode: "list" }
  | { mode: "add" }
  | { mode: "edit"; member: TeamMemberRow };

export default function TeamMembers() {
  const [members, setMembers] = useState<TeamMemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<View>({ mode: "list" });

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("team_members_for_owner");
    if (rpcError) setError(rpcError.message);
    else setMembers((data ?? []) as TeamMemberRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  function backToList(message?: string) {
    setView({ mode: "list" });
    setNotice(message ?? null);
    void loadMembers();
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Users className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
          <p className="text-sm text-muted-foreground">
            Invite team members and control which modules each one can open.
          </p>
        </div>
        {view.mode === "list" && (
          <Button onClick={() => { setNotice(null); setView({ mode: "add" }); }}>
            <UserPlus className="mr-2 h-4 w-4" />
            Add team member
          </Button>
        )}
        {view.mode !== "list" && (
          <Button variant="outline" onClick={() => backToList()}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        )}
      </div>

      {notice && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">
          <Check className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <span>{error}</span>
        </div>
      )}

      {view.mode === "list" && (
        <MemberList
          members={members}
          loading={loading}
          onSelect={(m) => { setNotice(null); setView({ mode: "edit", member: m }); }}
        />
      )}
      {view.mode === "add" && <AddMember onDone={backToList} />}
      {view.mode === "edit" && (
        <EditMember member={view.member} onDone={backToList} />
      )}
    </div>
  );
}

function MemberList({
  members,
  loading,
  onSelect,
}: {
  members: TeamMemberRow[];
  loading: boolean;
  onSelect: (m: TeamMemberRow) => void;
}) {
  if (loading) {
    return (
      <Card>
        <CardContent className="flex justify-center py-14">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }
  if (members.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
          <Users className="h-8 w-8 text-muted-foreground/40" />
          <p className="font-medium">No team members yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Add a team member to give someone their own login with access to only
            the modules you choose.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="p-0">
        <ul className="divide-y">
          {members.map((m) => (
            <li key={m.id}>
              <button
                onClick={() => onSelect(m)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {m.full_name?.trim() || m.email}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                </div>
                <span
                  className={
                    m.last_sign_in_at
                      ? "shrink-0 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-600"
                      : "shrink-0 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-600"
                  }
                >
                  {m.last_sign_in_at ? "Active" : "Invited"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function AddMember({ onDone }: { onDone: (message: string) => void }) {
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [permissions, setPermissions] = useState(emptyPermissionMap());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setError(null);
    if (!email.trim()) return setError("Enter an email address.");
    setSaving(true);
    try {
      await invokeEdgeFunction("team-invite", {
        email: email.trim(),
        first_name: firstName.trim(),
        permissions,
      });
      onDone(`Invite sent to ${email.trim()}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the invite.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="tm-first">First name</Label>
            <Input
              id="tm-first"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Jordan"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tm-email">Email</Label>
            <Input
              id="tm-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jordan@example.com"
            />
          </div>
        </CardContent>
      </Card>

      <PermissionGrid value={permissions} onChange={setPermissions} idPrefix="add" />

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={send} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Send Invite
        </Button>
      </div>
    </div>
  );
}

function EditMember({
  member,
  onDone,
}: {
  member: TeamMemberRow;
  onDone: (message: string) => void;
}) {
  const [permissions, setPermissions] = useState(emptyPermissionMap());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error: loadError } = await supabase
        .from("team_member_permissions")
        .select("permission_key, allowed")
        .eq("profile_id", member.id);
      if (cancelled) return;
      if (loadError) setError(loadError.message);
      else {
        const map = emptyPermissionMap();
        for (const row of data ?? []) {
          if (row.permission_key in map) {
            map[row.permission_key as PermissionKey] = row.allowed === true;
          }
        }
        setPermissions(map);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [member.id]);

  async function save(next: Record<PermissionKey, boolean>, message: string) {
    setError(null);
    setSaving(true);
    try {
      await invokeEdgeFunction("team-update-permissions", {
        profile_id: member.id,
        permissions: next,
      });
      onDone(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save permissions.");
      setSaving(false);
    }
  }

  async function revokeAll() {
    const label = member.full_name?.trim() || member.email;
    if (!window.confirm(
      `Revoke all access for ${label}?\n\nThey keep their account and login, but every module will be turned off.`
    )) return;
    const none = Object.fromEntries(PERMISSION_KEYS.map((k) => [k, false])) as Record<
      PermissionKey,
      boolean
    >;
    setPermissions(none);
    await save(none, `All access revoked for ${label}.`);
  }

  async function remove() {
    const label = member.full_name?.trim() || member.email;
    if (!window.confirm(
      `Remove ${label}?\n\nThis permanently deletes their account and they will no longer be able to log in. This cannot be undone.`
    )) return;
    setError(null);
    setSaving(true);
    try {
      await invokeEdgeFunction("team-remove", { profile_id: member.id });
      onDone(`${label} was removed.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove that team member.");
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex justify-center py-14">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm font-medium">{member.full_name?.trim() || member.email}</p>
          <p className="text-xs text-muted-foreground">{member.email}</p>
        </CardContent>
      </Card>

      <PermissionGrid
        value={permissions}
        onChange={setPermissions}
        idPrefix="edit"
        disabled={saving}
      />

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={revokeAll} disabled={saving}>
            Revoke all access
          </Button>
          <Button variant="destructive" onClick={remove} disabled={saving}>
            Remove team member
          </Button>
        </div>
        <Button
          onClick={() => save(permissions, "Permissions updated.")}
          disabled={saving}
        >
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save changes
        </Button>
      </div>
    </div>
  );
}
