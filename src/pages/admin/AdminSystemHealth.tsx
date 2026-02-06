import { useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useSystemHealthRuns,
  useLatestSystemHealth,
  useTriggerHealthCheck,
  CATEGORY_LABELS,
  SystemHealthRun,
} from "@/hooks/useSystemHealthRuns";
import { SystemHealthOverview } from "@/components/admin/system-health/SystemHealthOverview";
import { InvariantCheckCard } from "@/components/admin/system-health/InvariantCheckCard";
import { HealthRunHistory } from "@/components/admin/system-health/HealthRunHistory";
import { EdgeFunctionsHealth } from "@/components/admin/system-health/EdgeFunctionsHealth";
import { AuditLogViewer } from "@/components/admin/system-health/AuditLogViewer";
import { Loader2, Play, RefreshCw, Activity, CheckCircle, XCircle, Clock, History, Zap, FileText } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { ru } from "date-fns/locale";

export default function AdminSystemHealth() {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const { data: runs, isLoading: runsLoading, refetch: refetchRuns } = useSystemHealthRuns();
  const { data: latestHealth, isLoading: latestLoading } = useLatestSystemHealth();
  const triggerCheck = useTriggerHealthCheck();

  const activeRun = selectedRunId 
    ? runs?.find(r => r.id === selectedRunId)
    : latestHealth?.run;

  const isLoading = runsLoading || latestLoading;

  // Group checks by category
  const checksByCategory = (latestHealth?.checks || []).reduce((acc, check) => {
    const category = check.category || "system";
    if (!acc[category]) acc[category] = [];
    acc[category].push(check);
    return acc;
  }, {} as Record<string, typeof latestHealth.checks>);

  const failedChecks = latestHealth?.checks?.filter(c => c.status === "failed") || [];
  const passedChecks = latestHealth?.checks?.filter(c => c.status === "passed") || [];

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
                {/* Failed Checks First */}
                {failedChecks.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-lg font-semibold flex items-center gap-2 text-destructive">
                      <XCircle className="h-5 w-5" />
                      Требуют внимания ({failedChecks.length})
                    </h3>
                    <div className="grid gap-4 md:grid-cols-2">
                      {failedChecks.map((check) => (
                        <InvariantCheckCard key={check.id} check={check} variant="error" />
                      ))}
                    </div>
                  </div>
                )}

                {/* Passed Checks by Category */}
                {Object.entries(checksByCategory).map(([category, checks]) => {
                  const categoryPassedChecks = checks.filter(c => c.status === "passed");
                  if (categoryPassedChecks.length === 0) return null;

                  return (
                    <div key={category} className="space-y-3">
                      <h3 className="text-lg font-semibold flex items-center gap-2">
                        <CheckCircle className="h-5 w-5 text-green-500" />
                        {CATEGORY_LABELS[category] || category} 
                        <Badge variant="secondary" className="ml-2">
                          {categoryPassedChecks.length} OK
                        </Badge>
                      </h3>
                      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {categoryPassedChecks.map((check) => (
                          <InvariantCheckCard key={check.id} check={check} variant="success" />
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
