import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  Activity,
  CheckCircle,
  XCircle,
  Clock,
  RefreshCw,
  Bell,
  ArrowDownToLine,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface WebhookLog {
  id: string;
  instance_id: string;
  entity_type: string;
  direction: string;
  result: string;
  error_message: string | null;
  payload_meta: Record<string, unknown> | null;
  created_at: string;
}

interface Props {
  instanceId: string;
}

export function WebhookMonitoringPanel({ instanceId }: Props) {
  const [showOnlyErrors, setShowOnlyErrors] = useState(false);
  
  const { data: logs = [], refetch, isLoading } = useQuery({
    queryKey: ["webhook-logs", instanceId],
    queryFn: async () => {
      let query = supabase
        .from("integration_sync_logs")
        .select("*")
        .eq("instance_id", instanceId)
        .eq("direction", "inbound")
        .order("created_at", { ascending: false })
        .limit(50);
      
      if (showOnlyErrors) {
        query = query.eq("result", "error");
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data as WebhookLog[];
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const { data: stats } = useQuery({
    queryKey: ["webhook-stats", instanceId],
    queryFn: async () => {
      const now = new Date();
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      
      const { data, error } = await supabase
        .from("integration_sync_logs")
        .select("result")
        .eq("instance_id", instanceId)
        .eq("direction", "inbound")
        .gte("created_at", dayAgo.toISOString());
      
      if (error) throw error;
      
      const total = data.length;
      const success = data.filter(l => l.result === "success").length;
      const errors = data.filter(l => l.result === "error").length;
      
      return { total, success, errors };
    },
    refetchInterval: 60000,
  });

  const getResultBadge = (result: string) => {
    switch (result) {
      case "success":
        return (
          <Badge variant="secondary" className="bg-green-100 text-green-700 border-green-200 gap-1">
            <CheckCircle className="h-3 w-3" />
            Успех
          </Badge>
        );
      case "error":
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            Ошибка
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="gap-1">
            <Clock className="h-3 w-3" />
            {result}
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 rounded-xl bg-muted/50 border text-center">
          <div className="text-2xl font-bold">{stats?.total || 0}</div>
          <div className="text-xs text-muted-foreground">За 24 часа</div>
        </div>
        <div className="p-3 rounded-xl bg-green-50 border border-green-200 text-center">
          <div className="text-2xl font-bold text-green-600">{stats?.success || 0}</div>
          <div className="text-xs text-green-600/70">Успешных</div>
        </div>
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-center">
          <div className="text-2xl font-bold text-red-600">{stats?.errors || 0}</div>
          <div className="text-xs text-red-600/70">Ошибок</div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Входящие вебхуки</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={showOnlyErrors ? "destructive" : "outline"}
            size="sm"
            onClick={() => setShowOnlyErrors(!showOnlyErrors)}
          >
            <Bell className="h-4 w-4 mr-1" />
            {showOnlyErrors ? "Только ошибки" : "Все"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => refetch()}>
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Logs list */}
      <ScrollArea className="h-[300px]">
        {logs.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <ArrowDownToLine className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p>Нет входящих вебхуков</p>
          </div>
        ) : (
          <div className="space-y-2">
            {logs.map((log) => (
              <div
                key={log.id}
                className={cn(
                  "p-3 rounded-lg border",
                  log.result === "error" ? "bg-red-50/50 border-red-200" : "bg-card"
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {log.entity_type}
                    </Badge>
                    {getResultBadge(log.result)}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(log.created_at), "dd MMM HH:mm:ss", { locale: ru })}
                  </span>
                </div>
                {log.error_message && (
                  <p className="text-xs text-destructive mt-1 font-mono bg-destructive/5 p-1 rounded">
                    {log.error_message}
                  </p>
                )}
                {log.payload_meta && (
                  <details className="mt-2">
                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                      Показать данные
                    </summary>
                    <pre className="text-xs mt-1 p-2 bg-muted rounded overflow-x-auto">
                      {JSON.stringify(log.payload_meta, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
