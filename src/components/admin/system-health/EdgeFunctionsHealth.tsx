import { useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  useEdgeFunctionsHealth, 
  EdgeFunctionStatus, 
  CATEGORY_LABELS_RU 
} from "@/hooks/useEdgeFunctionsHealth";
import { 
  RefreshCw, 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  Clock, 
  Loader2,
  Zap
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

function StatusBadge({ status }: { status: EdgeFunctionStatus["status"] }) {
  switch (status) {
    case "ok":
      return (
        <Badge variant="default" className="bg-green-500 hover:bg-green-600">
          <CheckCircle className="h-3 w-3 mr-1" />
          Доступна
        </Badge>
      );
    case "not_found":
      return (
        <Badge variant="destructive">
          <XCircle className="h-3 w-3 mr-1" />
          Не задеплоена
        </Badge>
      );
    case "error":
      return (
        <Badge variant="outline" className="border-orange-500 text-orange-600">
          <AlertTriangle className="h-3 w-3 mr-1" />
          Ошибка
        </Badge>
      );
    case "checking":
      return (
        <Badge variant="secondary">
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          Проверка...
        </Badge>
      );
    case "pending":
    default:
      return (
        <Badge variant="outline">
          <Clock className="h-3 w-3 mr-1" />
          Ожидание
        </Badge>
      );
  }
}

function LatencyBadge({ latency }: { latency: number | null }) {
  if (latency === null) return <span className="text-muted-foreground">—</span>;
  
  const color = latency < 300 ? "text-green-600" : latency < 1000 ? "text-yellow-600" : "text-red-600";
  
  return (
    <span className={`font-mono text-sm ${color}`}>
      {latency}ms
    </span>
  );
}

export function EdgeFunctionsHealth() {
  const { 
    functions, 
    stats, 
    byCategory,
    isChecking, 
    lastFullCheck, 
    checkAllFunctions,
    checkSingleFunction 
  } = useEdgeFunctionsHealth();

  // Auto-check on mount
  useEffect(() => {
    checkAllFunctions();
  }, []);

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-3xl font-bold">{stats.total}</div>
            <p className="text-sm text-muted-foreground">Всего функций</p>
          </CardContent>
        </Card>
        <Card className={stats.ok === stats.total ? "border-green-500/50" : ""}>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <div className="text-3xl font-bold text-green-600">{stats.ok}</div>
            </div>
            <p className="text-sm text-muted-foreground">Доступны</p>
          </CardContent>
        </Card>
        <Card className={stats.notFound > 0 ? "border-destructive/50" : ""}>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-destructive" />
              <div className="text-3xl font-bold text-destructive">{stats.notFound}</div>
            </div>
            <p className="text-sm text-muted-foreground">Не задеплоены</p>
          </CardContent>
        </Card>
        <Card className={stats.error > 0 ? "border-orange-500/50" : ""}>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              <div className="text-3xl font-bold text-orange-600">{stats.error}</div>
            </div>
            <p className="text-sm text-muted-foreground">С ошибками</p>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {lastFullCheck ? (
            <>
              Последняя проверка: {formatDistanceToNow(lastFullCheck, { addSuffix: true, locale: ru })}
            </>
          ) : (
            "Ещё не проверялось"
          )}
        </div>
        <Button onClick={checkAllFunctions} disabled={isChecking}>
          {isChecking ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Проверить все
        </Button>
      </div>

      {/* Functions by Category */}
      {Object.entries(byCategory).map(([category, funcs]) => (
        <Card key={category}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4" />
              {CATEGORY_LABELS_RU[category] || category}
              <Badge variant="secondary" className="ml-2">
                {funcs.filter((f) => f.status === "ok").length}/{funcs.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Функция</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Latency</TableHead>
                  <TableHead>Последняя проверка</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {funcs.map((fn) => (
                  <TableRow key={fn.name}>
                    <TableCell className="font-mono text-sm">{fn.name}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <StatusBadge status={fn.status} />
                        {fn.error && (
                          <span className="text-xs text-muted-foreground">{fn.error}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <LatencyBadge latency={fn.latency} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {fn.lastCheck 
                        ? formatDistanceToNow(fn.lastCheck, { addSuffix: true, locale: ru })
                        : "—"
                      }
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => checkSingleFunction(fn.name)}
                        disabled={fn.status === "checking"}
                      >
                        {fn.status === "checking" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
