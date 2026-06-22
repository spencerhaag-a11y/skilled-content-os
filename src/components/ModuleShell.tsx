import type { ModuleDef } from "@/lib/modules";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Consistent frame rendered by every module route until its build phase
 * ships. Each module page replaces this with its real implementation in
 * the phase listed in Section 4 of the spec.
 */
export function ModuleShell({ module }: { module: ModuleDef }) {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <module.icon className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{module.name}</h1>
          <p className="text-sm text-muted-foreground">{module.description}</p>
        </div>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
          <module.icon className="h-8 w-8 text-muted-foreground/40" />
          <p className="font-medium">Arriving in Phase {module.phase}</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            This module is scaffolded and routed. Its full implementation lands in build
            Phase {module.phase}.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
