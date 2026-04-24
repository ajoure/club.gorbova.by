import { Card, CardContent } from "@/components/ui/card";
import { Info } from "lucide-react";
import { SystemHealthOverview } from "../SystemHealthOverview";
import { EdgeFunctionsHealth } from "../EdgeFunctionsHealth";
import { AuditLogViewer } from "../AuditLogViewer";
import { HealthRunHistory } from "../HealthRunHistory";
import type { SystemHealthRun, SystemHealthCheckRow } from "@/hooks/useSystemHealthRuns";

interface Props {
  run: SystemHealthRun | null;
  checks: SystemHealthCheckRow[];
  runs: SystemHealthRun[];
  selectedRunId: string | null;
  onSelectRun: (id: string | null) => void;
}

export function OwnerTechInfoTab({ run, checks, runs, selectedRunId, onSelectRun }: Props) {
  return (
    <div className="space-y-6">
      <Card className="bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900">
        <CardContent className="p-4 flex items-start gap-3">
          <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-foreground/90">
            Этот раздел для технической проверки. Для владельца основные действия находятся
            во вкладке <span className="font-medium">«Проблемы сейчас»</span>.
          </p>
        </CardContent>
      </Card>

      <SystemHealthOverview run={run} checks={checks} />
      <EdgeFunctionsHealth />
      <HealthRunHistory runs={runs} selectedRunId={selectedRunId} onSelectRun={onSelectRun} />
      <AuditLogViewer />
    </div>
  );
}
