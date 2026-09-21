import { PERMISSIONS, type PermissionKey } from "@/lib/permissions";
import { cn } from "@/lib/utils";

interface PermissionGridProps {
  value: Record<PermissionKey, boolean>;
  onChange: (next: Record<PermissionKey, boolean>) => void;
  /** Radio group names must be unique per rendered grid on the page. */
  idPrefix?: string;
  disabled?: boolean;
}

/**
 * The owner-facing Yes/No permission list (Spec Section 2 + 6), shared by the
 * add and edit flows. One row per permission_key, mirroring the ClubSystems
 * user-permission screen: line item on the left, Yes/No radio pair on the
 * right. Defaults to No — the caller supplies the map.
 */
export function PermissionGrid({
  value,
  onChange,
  idPrefix = "perm",
  disabled = false,
}: PermissionGridProps) {
  function set(key: PermissionKey, allowed: boolean) {
    if (disabled) return;
    onChange({ ...value, [key]: allowed });
  }

  return (
    <div className="overflow-hidden rounded-md border">
      <div className="flex items-center justify-between border-b bg-muted/50 px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Permission
        </span>
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Access
        </span>
      </div>

      <ul className="divide-y">
        {PERMISSIONS.map((p) => {
          const allowed = value[p.key] === true;
          return (
            <li
              key={p.key}
              className="flex items-center justify-between gap-4 px-4 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{p.label}</p>
                <p className="truncate text-xs text-muted-foreground">{p.controls}</p>
              </div>

              <fieldset className="flex shrink-0 items-center gap-4">
                <legend className="sr-only">{p.label}</legend>
                {[
                  { label: "Yes", on: true },
                  { label: "No", on: false },
                ].map((opt) => (
                  <label
                    key={opt.label}
                    className={cn(
                      "flex cursor-pointer items-center gap-1.5 text-sm",
                      disabled && "cursor-not-allowed opacity-60"
                    )}
                  >
                    <input
                      type="radio"
                      name={`${idPrefix}-${p.key}`}
                      className="h-4 w-4 accent-primary"
                      checked={allowed === opt.on}
                      disabled={disabled}
                      onChange={() => set(p.key, opt.on)}
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </fieldset>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
