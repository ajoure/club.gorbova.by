import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useTriggerFullCheck,
  useLatestFullCheck,
  STATUS_CONFIG,
  type FullCheckResponse,
  type SystemHealthReport,
} from "@/hooks/useSystemHealthFullCheck";
import {
  Loader2,
  Play,
  CheckCircle,
  XCircle,
  AlertTriangle,
  ChevronDown,
  Zap,
  Clock,
  Wrench,
  Server,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

export function FullSystemCheck() {
  const [checkResult, setCheckResult] = useState<FullCheckResponse | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    functions: false,
    invariants: true,
    fixes: true,
  });

  const { data: latestReport, isLoading: latestLoading } = useLatestFullCheck();
  const triggerCheck = useTriggerFullCheck();

  const handleRunCheck = async () => {
    try {
      const result = await triggerCheck.mutateAsync();
      setCheckResult(result);
    } catch {
      // Error handled by mutation
    }
  };

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  // Use live result if available, otherwise show latest from DB
  const displayData = checkResult || (latestReport?.report_json as unknown as FullCheckResponse);
  const status = checkResult?.status || latestReport?.status || "OK";
  const statusConfig = STATUS_CONFIG[status] || STATUS_CONFIG.OK;

  const StatusIcon = status === "OK" ? CheckCircle : status === "CRITICAL" ? XCircle : AlertTriangle;

  return (
    <div className="space-y-4">
      {/* Main Action Card */}
      <Card className="border-2 border-primary/20">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Server className="h-5 w-5 text-primary" />
              Полный чек системы
            </CardTitle>
            {latestReport && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                {formatDistanceToNow(new Date(latestReport.created_at), {
                  addSuffix: true,
                  locale: ru,
                })}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <Button
              size="lg"
              onClick={handleRunCheck}
              disabled={triggerCheck.isPending}
              className="w-full sm:w-auto"
            >
              {triggerCheck.isPending ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Проверка...
                </>
              ) : (
                <>
                  <Play className="h-5 w-5 mr-2" />
                  Запустить полный чек
                </>
              )}
            </Button>

            {displayData && (
              <div className="flex items-center gap-3">
                <Badge
                  variant={statusConfig.variant}
                  className={`${statusConfig.bgColor} ${statusConfig.color} px-3 py-1`}
                >
                  <StatusIcon className="h-4 w-4 mr-1" />
                  {status}
                </Badge>
                {displayData.duration_ms && (
                  <span className="text-sm text-muted-foreground">
                    {(displayData.duration_ms / 1000).toFixed(1)}s
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Summary Stats */}
          {displayData && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-primary">
                  {displayData.edge_functions?.deployed || 0}
                </div>
                <div className="text-xs text-muted-foreground">
                  / {displayData.edge_functions?.total || 0} функций
                </div>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-destructive">
                  {displayData.edge_functions?.missing?.length || 0}
                </div>
                <div className="text-xs text-muted-foreground">не задеплоено</div>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-green-600">
                  {displayData.invariants?.passed || 0}
                </div>
                <div className="text-xs text-muted-foreground">
                  / {displayData.invariants?.total || 0} инвариантов
                </div>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-yellow-600">
                  {displayData.auto_fixes?.length || 0}
                </div>
                <div className="text-xs text-muted-foreground">автоисправлений</div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detailed Results */}
      {displayData && (
        <div className="space-y-3">
          {/* Missing Functions */}
          {displayData.edge_functions?.missing?.length > 0 && (
            <Collapsible
              open={expandedSections.functions}
              onOpenChange={() => toggleSection("functions")}
            >
              <Card className="border-destructive/50">
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2 text-destructive">
                        <XCircle className="h-4 w-4" />
                        Не задеплоенные функции ({displayData.edge_functions.missing.length})
                      </CardTitle>
                      <ChevronDown
                        className={`h-4 w-4 transition-transform ${
                          expandedSections.functions ? "rotate-180" : ""
                        }`}
                      />
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0">
                    <ScrollArea className="h-[200px]">
                      <div className="space-y-1">
                        {displayData.edge_functions.missing.map((fn) => (
                          <div
                            key={fn}
                            className="flex items-center gap-2 text-sm py-1 px-2 rounded hover:bg-muted/50"
                          >
                            <XCircle className="h-3 w-3 text-destructive" />
                            <code className="text-xs">{fn}</code>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )}

          {/* Invariants */}
          <Collapsible
            open={expandedSections.invariants}
            onOpenChange={() => toggleSection("invariants")}
          >
            <Card>
              <CollapsibleTrigger asChild>
                <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Zap className="h-4 w-4 text-primary" />
                      Бизнес-инварианты
                      <Badge variant="secondary" className="ml-2">
                        {displayData.invariants?.passed}/{displayData.invariants?.total}
                      </Badge>
                    </CardTitle>
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${
                        expandedSections.invariants ? "rotate-180" : ""
                      }`}
                    />
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0">
                  <div className="space-y-2">
                    {displayData.invariants?.results?.map((inv) => {
                      const isPassed = inv.passed;
                      const isCritical = inv.severity === "CRITICAL" && !isPassed;
                      const isWarning = inv.severity === "WARNING" && !isPassed;

                      return (
                        <div
                          key={inv.code}
                          className={`flex items-center justify-between p-2 rounded-lg ${
                            isCritical
                              ? "bg-destructive/10"
                              : isWarning
                              ? "bg-yellow-500/10"
                              : "bg-muted/50"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            {isPassed ? (
                              <CheckCircle className="h-4 w-4 text-green-600" />
                            ) : isCritical ? (
                              <XCircle className="h-4 w-4 text-destructive" />
                            ) : (
                              <AlertTriangle className="h-4 w-4 text-yellow-600" />
                            )}
                            <span className="text-sm font-medium">{inv.name}</span>
                            <Badge variant="outline" className="text-xs">
                              {inv.code}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-mono">{inv.count}</span>
                            <Badge
                              variant={
                                inv.severity === "CRITICAL"
                                  ? "destructive"
                                  : inv.severity === "WARNING"
                                  ? "secondary"
                                  : "outline"
                              }
                              className="text-xs"
                            >
                              {inv.severity}
                            </Badge>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* Auto-fixes */}
          {displayData.auto_fixes?.length > 0 && (
            <Collapsible
              open={expandedSections.fixes}
              onOpenChange={() => toggleSection("fixes")}
            >
              <Card className="border-yellow-500/50">
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Wrench className="h-4 w-4 text-yellow-600" />
                        Автолечение ({displayData.auto_fixes.length})
                      </CardTitle>
                      <ChevronDown
                        className={`h-4 w-4 transition-transform ${
                          expandedSections.fixes ? "rotate-180" : ""
                        }`}
                      />
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0">
                    <div className="space-y-2">
                      {displayData.auto_fixes.map((fix, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-2 rounded-lg bg-muted/50"
                        >
                          <div className="flex items-center gap-2">
                            {fix.result === "success" ? (
                              <CheckCircle className="h-4 w-4 text-green-600" />
                            ) : (
                              <XCircle className="h-4 w-4 text-destructive" />
                            )}
                            <code className="text-xs">{fix.target}</code>
                          </div>
                          <span className="text-sm text-muted-foreground">{fix.action}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )}
        </div>
      )}
    </div>
  );
}
