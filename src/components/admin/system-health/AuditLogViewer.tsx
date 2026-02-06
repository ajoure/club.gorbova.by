import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RefreshCw, User, Bot, Settings, Shield, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface AuditLog {
  id: string;
  action: string;
  actor_type: string;
  actor_user_id: string | null;
  actor_label: string | null;
  target_user_id: string | null;
  meta: Record<string, any> | null;
  created_at: string;
}

const ACTION_CATEGORIES = [
  { value: "all", label: "Все действия" },
  { value: "edge_function", label: "Edge Functions" },
  { value: "admin", label: "Админ-действия" },
  { value: "access", label: "Доступы" },
  { value: "payment", label: "Платежи" },
  { value: "telegram", label: "Telegram" },
];

function getActionBadgeVariant(action: string): "default" | "secondary" | "destructive" | "outline" {
  if (action.includes("delete") || action.includes("revoke")) return "destructive";
  if (action.includes("create") || action.includes("grant")) return "default";
  if (action.includes("update") || action.includes("change")) return "secondary";
  return "outline";
}

function getActorIcon(actorType: string) {
  switch (actorType) {
    case "system":
      return <Bot className="h-4 w-4 text-muted-foreground" />;
    case "admin":
      return <Shield className="h-4 w-4 text-primary" />;
    case "cron":
      return <Settings className="h-4 w-4 text-orange-500" />;
    default:
      return <User className="h-4 w-4" />;
  }
}

export function AuditLogViewer() {
  const [actionFilter, setActionFilter] = useState("all");
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["audit-logs", actionFilter, page],
    queryFn: async () => {
      let query = supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (actionFilter !== "all") {
        query = query.ilike("action", `${actionFilter}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as AuditLog[];
    },
  });

  const logs = data || [];

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Фильтр по типу" />
            </SelectTrigger>
            <SelectContent>
              {ACTION_CATEGORIES.map((cat) => (
                <SelectItem key={cat.value} value={cat.value}>
                  {cat.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Logs Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Журнал операций
            <Badge variant="secondary" className="ml-2">
              {logs.length} записей
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[500px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">Время</TableHead>
                  <TableHead>Действие</TableHead>
                  <TableHead>Актор</TableHead>
                  <TableHead>Детали</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      Нет записей
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {format(new Date(log.created_at), "dd.MM.yyyy HH:mm:ss", { locale: ru })}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getActionBadgeVariant(log.action)}>
                          {log.action}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getActorIcon(log.actor_type)}
                          <span className="text-sm">
                            {log.actor_label || log.actor_type}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {log.meta && (
                          <code className="text-xs bg-muted px-2 py-1 rounded max-w-[300px] truncate block">
                            {JSON.stringify(log.meta).slice(0, 100)}
                            {JSON.stringify(log.meta).length > 100 ? "..." : ""}
                          </code>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0 || isLoading}
        >
          ← Назад
        </Button>
        <span className="text-sm text-muted-foreground">
          Страница {page + 1}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage((p) => p + 1)}
          disabled={logs.length < pageSize || isLoading}
        >
          Вперёд →
        </Button>
      </div>
    </div>
  );
}
