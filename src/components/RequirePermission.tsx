import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { useTeamPermissionsStore } from "@/stores/teamPermissionsStore";
import { useAccountStore } from "@/stores/accountStore";
import type { ModuleAccess } from "@/lib/permissions";

/**
 * Route-level gate for module access (Spec Section 5).
 *
 * Wrapping the route rather than each page body is deliberate: it covers
 * direct URL navigation and lazy-loaded chunks uniformly, so there is no
 * window where a page mounts and fetches before its own check runs. Pages
 * that split view from edit (Brand Kit, Knowledge Base) still check the
 * edit key internally.
 */
export function RequirePermission({
  access,
  children,
}: {
  access: ModuleAccess;
  children: ReactNode;
}) {
  const allowed = useTeamPermissionsStore((s) => s.canAccess(access));
  const permStatus = useTeamPermissionsStore((s) => s.status);
  const accountStatus = useAccountStore((s) => s.status);

  // Wait for both the profile and the permission rows before judging, or a
  // team member would see a flash of "no access" on every refresh.
  if (accountStatus === "idle" || accountStatus === "loading" || permStatus === "loading") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!allowed) return <AccessDenied />;
  return <>{children}</>;
}

/** The plain, non-redirecting denial state the spec asks for. */
export function AccessDenied({
  message = "You don't have access to this.",
}: {
  message?: string;
}) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Lock className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium">{message}</p>
      <p className="max-w-sm text-xs text-muted-foreground">
        Ask your account owner if you need this module turned on.
      </p>
    </div>
  );
}
