import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SystemHealthRun, SystemHealthCheck } from "@/hooks/useSystemHealthRuns";
import { CheckCircle, XCircle, Clock, AlertTriangle, Activity } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { ru } from "date-fns/locale";

interface SystemHealthOverviewProps {
  run: SystemHealthRun | null;
  checks: SystemHealthCheck[];
}

export function SystemHealthOverview({ run, checks }: SystemHealthOverviewProps) {
  // Effective: ignored failed-checks не учитываются как проблемы
  const failed = checks.filter(c => c.status === "failed" && !c.is_ignored).length;
  const ignored = checks.filter(c => c.status === "failed" && c.is_ignored).length;
  const passed = checks.filter(c => c.status === "passed").length + ignored;
  const total = checks.length;

  const getStatusColor = () => {
    if (!run) return "border-muted";
    if (run.status === "running") return "border-blue-500";
    if (failed > 0) return "border-destructive";
    return "border-green-500";
  };

  const getStatusIcon = () => {
    if (!run) return <Activity className="h-8 w-8 text-muted-foreground" />;
    if (run.status === "running") return <Clock className="h-8 w-8 text-blue-500 animate-spin" />;
    if (failed > 0) return <XCircle className="h-8 w-8 text-destructive" />;
    return <CheckCircle className="h-8 w-8 text-green-500" />;
  };

  const getStatusText = () => {
    if (!run) return "Нет данных";
    if (run.status === "running") return "Проверка...";
    if (failed > 0) return `${failed} проблем`;
    return "Всё в порядке";
  };

  return (
    <div className="grid gap-4 md:grid-cols-4">
      {/* Main Status */}
      <Card className={`border-2 ${getStatusColor()}`}>
        <CardContent className="pt-6 flex flex-col items-center text-center">
          {getStatusIcon()}
          <div className="mt-2 text-lg font-semibold">{getStatusText()}</div>
          {run && (
            <div className="text-xs text-muted-foreground mt-1">
              {formatDistanceToNow(new Date(run.started_at), { 
                addSuffix: true, 
                locale: ru 
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Total Checks */}
      <Card>
        <CardContent className="pt-6">
          <div className="text-3xl font-bold">{total}</div>
          <p className="text-sm text-muted-foreground">Всего проверок</p>
          {run && (
            <div className="text-xs text-muted-foreground mt-2">
              {format(new Date(run.started_at), "dd.MM.yyyy HH:mm", { locale: ru })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Passed */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
            <div className="text-3xl font-bold text-green-600">{passed}</div>
          </div>
          <p className="text-sm text-muted-foreground">Пройдено</p>
          <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-green-500 transition-all" 
              style={{ width: total > 0 ? `${(passed / total) * 100}%` : "0%" }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Failed */}
      <Card className={failed > 0 ? "border-destructive/50" : ""}>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2">
            {failed > 0 ? (
              <AlertTriangle className="h-5 w-5 text-destructive" />
            ) : (
              <CheckCircle className="h-5 w-5 text-green-500" />
            )}
            <div className={`text-3xl font-bold ${failed > 0 ? "text-destructive" : "text-green-600"}`}>
              {failed}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">Требуют внимания</p>
          {failed > 0 && (
            <Badge variant="destructive" className="mt-2">
              Нужно исправить
            </Badge>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
