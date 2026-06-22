import { NavLink } from "react-router-dom";
import { X, ShieldCheck } from "lucide-react";
import { MODULES, MODULE_GROUPS } from "@/lib/modules";
import { useAccountStore } from "@/stores/accountStore";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";

interface SidebarProps {
  mobileOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ mobileOpen, onClose }: SidebarProps) {
  const platformName = useAccountStore((s) => s.platformName);
  const logoUrl = useAccountStore((s) => s.account?.logo_url);
  const disabledModules = useAccountStore((s) => s.disabledModules);
  const claimIsOwner = useAuthStore((s) => s.isPlatformOwner);
  const profileIsOwner = useAccountStore((s) => s.profile?.is_platform_owner ?? false);
  const isPlatformOwner = claimIsOwner || profileIsOwner;

  // Owner-disabled modules (Module 21 feature flags) drop out of navigation.
  // Dashboard and Settings are core and never hidden, even if flagged.
  const ALWAYS_ON = new Set(["/", "/settings"]);
  const visibleModules = MODULES.filter(
    (m) => ALWAYS_ON.has(m.path) || !disabledModules.includes(m.path)
  );

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-sidebar text-sidebar-foreground transition-transform lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-16 items-center justify-between gap-3 px-5">
          <div className="flex min-w-0 items-center gap-3">
            {logoUrl ? (
              <img src={logoUrl} alt="" className="h-8 w-8 rounded object-contain" />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded bg-primary font-display text-sm text-primary-foreground">
                {platformName.charAt(0)}
              </div>
            )}
            <span className="truncate font-display text-base uppercase tracking-wide">
              {platformName}
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 hover:bg-sidebar-active lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-6 pt-2">
          {MODULE_GROUPS.filter((group) =>
            visibleModules.some((m) => m.group === group)
          ).map((group) => (
            <div key={group}>
              <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">
                {group}
              </p>
              <ul className="space-y-0.5">
                {visibleModules.filter((m) => m.group === group).map((m) => (
                  <li key={m.path}>
                    <NavLink
                      to={m.path}
                      end={m.path === "/"}
                      onClick={onClose}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors",
                          isActive
                            ? "bg-sidebar-active text-white"
                            : "text-sidebar-foreground/80 hover:bg-sidebar-active hover:text-white"
                        )
                      }
                    >
                      <m.icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{m.name}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {isPlatformOwner && (
            <div>
              <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">
                Platform
              </p>
              <NavLink
                to="/owner"
                onClick={onClose}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-sidebar-active text-white"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-active hover:text-white"
                  )
                }
              >
                <ShieldCheck className="h-4 w-4 shrink-0" />
                <span className="truncate">Owner Panel</span>
              </NavLink>
            </div>
          )}
        </nav>
      </aside>
    </>
  );
}
