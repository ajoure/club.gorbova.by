import { useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  useSystemHealthRuns,
  useLatestSystemHealth,
  useTriggerHealthCheck,
  useIgnoredChecks,
  CATEGORY_LABELS,
} from "@/hooks/useSystemHealthRuns";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { SystemHealthOverview } from "@/components/admin/system-health/SystemHealthOverview";
import { InvariantCheckCard } from "@/components/admin/system-health/InvariantCheckCard";
import { HealthRunHistory } from "@/components/admin/system-health/HealthRunHistory";
import { EdgeFunctionsHealth } from "@/components/admin/system-health/EdgeFunctionsHealth";
import { AuditLogViewer } from "@/components/admin/system-health/AuditLogViewer";
import { Loader2, Play, RefreshCw, Activity, CheckCircle, XCircle, History, Zap, FileText, AlertTriangle, ChevronDown } from "lucide-react";

export default function AdminSystemHealth() {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [ignoredExpanded, setIgnoredExpanded] = useState(false);
  
  const { data: runs, isLoading: runsLoading, refetch: refetchRuns } = useSystemHealthRuns();
  const { data: latestHealth, isLoading: latestLoading } = useLatestSystemHealth();
  const { data: ignoredChecks = [] } = useIgnoredChecks();
  const { data: isSuperAdmin = false } = useSuperAdmin();
  const triggerCheck = useTriggerHealthCheck();

  const isLoading = runsLoading || latestLoading;

  // Create a Set of ignored check keys for fast lookup
  const ignoredCheckKeys = new Set(ignoredChecks.map(ic => ic.check_key));

  // Helper to get ignore info for a check
  const getIgnoreInfo = (checkKey: string) => {
    const invCode = checkKey?.split(":")[0]?.trim() || checkKey;
    return ignoredChecks.find(ic => ic.check_key === invCode);
  };

  // Separate checks into 3 groups
  const allChecks = latestHealth?.checks || [];
  
  const failedChecksRaw = allChecks.filter(c => c.status === "failed");
  const passedChecks = allChecks.filter(c => c.status === "passed");
  
  // Split failed into: actual errors vs ignored
  const failedChecks = failedChecksRaw.filter(c => {
    const invCode = c.check_key?.split(":")[0]?.trim() || c.check_key;
    return !ignoredCheckKeys.has(invCode);
  });
  
  const ignoredFailedChecks = failedChecksRaw.filter(c => {
    const invCode = c.check_key?.split(":")[0]?.trim() || c.check_key;
    return ignoredCheckKeys.has(invCode);
  });

  // Group passed checks by category
  const checksByCategory = passedChecks.reduce((acc, check) => {
    const category = check.category || "system";
    if (!acc[category]) acc[category] = [];
    acc[category].push(check);
    return acc;
  }, {} as Record<string, typeof passedChecks>);

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="h-6 w-6 text-primary" />
              Здоровье системы
            </h1>
            <p className="text-muted-foreground">
              Автоматический мониторинг платежей, доступов и интеграций
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchRuns()}
              disabled={isLoading}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Обновить
            </Button>
            <Button
              size="sm"
              onClick={() => triggerCheck.mutate()}
              disabled={triggerCheck.isPending}
            >
              {triggerCheck.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Запустить проверку
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Overview Cards */}
            <SystemHealthOverview
              run={latestHealth?.run || null}
              checks={latestHealth?.checks || []}
            />

            <Tabs defaultValue="current" className="space-y-4">
              <TabsList className="flex-wrap h-auto gap-1">
                <TabsTrigger value="current" className="gap-2">
                  <Activity className="h-4 w-4" />
                  Инварианты
                  {failedChecks.length > 0 && (
                    <Badge variant="destructive" className="ml-1 h-5 px-1.5">
                      {failedChecks.length}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="functions" className="gap-2">
                  <Zap className="h-4 w-4" />
                  Edge Functions
                </TabsTrigger>
                <TabsTrigger value="history" className="gap-2">
                  <History className="h-4 w-4" />
                  История ({runs?.length || 0})
                </TabsTrigger>
                <TabsTrigger value="audit" className="gap-2">
                  <FileText className="h-4 w-4" />
                  Audit Log
                </TabsTrigger>
              </TabsList>

              <TabsContent value="current" className="space-y-6">
                {/* Failed Checks - Require Attention */}
                {failedChecks.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-lg font-semibold flex items-center gap-2 text-destructive">
                      <XCircle className="h-5 w-5" />
                      Требуют внимания ({failedChecks.length})
                    </h3>
                    <div className="grid gap-4 md:grid-cols-2">
                      {failedChecks.map((check) => (
                        <InvariantCheckCard 
                          key={check.id} 
                          check={check} 
                          variant="error"
                          isSuperAdmin={isSuperAdmin}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Ignored Checks - Muted Section */}
                {ignoredFailedChecks.length > 0 && (
                  <Collapsible open={ignoredExpanded} onOpenChange={setIgnoredExpanded}>
                    <CollapsibleTrigger asChild>
                      <div className="flex items-center gap-2 cursor-pointer group">
                        <h3 className="text-lg font-semibold flex items-center gap-2 text-warning-foreground">
                          <AlertTriangle className="h-5 w-5" />
                          Игнорируемые ({ignoredFailedChecks.length})
                        </h3>
                        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${ignoredExpanded ? "rotate-180" : ""}`} />
                        <span className="text-xs text-muted-foreground group-hover:underline">
                          {ignoredExpanded ? "свернуть" : "развернуть"}
                        </span>
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-3">
                      <div className="grid gap-4 md:grid-cols-2">
                        {ignoredFailedChecks.map((check) => {
                          const ignoreInfo = getIgnoreInfo(check.check_key);
                          return (
                            <InvariantCheckCard 
                              key={check.id} 
                              check={check} 
                              variant="ignored"
                              isSuperAdmin={isSuperAdmin}
                              ignoredInfo={ignoreInfo}
                            />
                          );
                        })}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}

                {/* Passed Checks by Category */}
                {Object.entries(checksByCategory).map(([category, checks]) => {
                  if (checks.length === 0) return null;

                  return (
                    <div key={category} className="space-y-3">
                      <h3 className="text-lg font-semibold flex items-center gap-2">
                        <CheckCircle className="h-5 w-5 text-primary" />
                        {CATEGORY_LABELS[category] || category} 
                        <Badge variant="secondary" className="ml-2">
                          {checks.length} OK
                        </Badge>
                      </h3>
                      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {checks.map((check) => (
                          <InvariantCheckCard 
                            key={check.id} 
                            check={check} 
                            variant="success"
                            isSuperAdmin={isSuperAdmin}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}

                {/* Empty State */}
                {!latestHealth?.run && (
                  <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                      <Activity className="h-12 w-12 text-muted-foreground/50 mb-4" />
                      <h3 className="text-lg font-medium mb-2">Нет данных проверки</h3>
                      <p className="text-muted-foreground mb-4">
                        Запустите первую проверку системы
                      </p>
                      <Button onClick={() => triggerCheck.mutate()} disabled={triggerCheck.isPending}>
                        {triggerCheck.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Play className="h-4 w-4 mr-2" />
                        )}
                        Запустить проверку
                      </Button>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="functions">
                <EdgeFunctionsHealth />
              </TabsContent>

              <TabsContent value="history">
                <HealthRunHistory
                  runs={runs || []}
                  selectedRunId={selectedRunId}
                  onSelectRun={setSelectedRunId}
                />
              </TabsContent>

              <TabsContent value="audit">
                <AuditLogViewer />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
