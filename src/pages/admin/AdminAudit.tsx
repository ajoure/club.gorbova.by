import { useState, useEffect, useCallback } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, Loader2 } from "lucide-react";

interface AuditLog {
  id: string;
  actor_user_id: string | null;
  actor_type?: string;
  actor_label?: string | null;
  action: string;
  target_user_id: string | null;
  meta: unknown;
  created_at: string;
  actor_email?: string;
  target_email?: string;
}

export default function AdminAudit() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const { data: logsData, error } = await supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) {
        console.error("Error fetching audit logs:", error);
        return;
      }

      // Get unique user IDs (only for user-type actors)
      const userIds = new Set<string>();
      logsData?.forEach((log) => {
        // Only add actor_user_id if it exists and is a user type
        if (log.actor_user_id && (!log.actor_type || log.actor_type === 'user')) {
          userIds.add(log.actor_user_id);
        }
        if (log.target_user_id) userIds.add(log.target_user_id);
      });

      // Fetch profiles for these users
      const { data: profiles } = userIds.size > 0 
        ? await supabase
            .from("profiles")
            .select("user_id, email")
            .in("user_id", Array.from(userIds))
        : { data: [] };

      const profileMap = new Map<string, string>(
        (profiles || []).map((p) => [p.user_id, p.email] as [string, string])
      );

      const enrichedLogs: AuditLog[] = (logsData || []).map((log) => ({
        ...log,
        // For system actors, show actor_label or "System"
        actor_email: log.actor_type === 'system' 
          ? (log.actor_label || 'System')
          : (log.actor_user_id ? (profileMap.get(log.actor_user_id) || "Unknown") : "Unknown"),
        target_email: log.target_user_id ? profileMap.get(log.target_user_id) || "Unknown" : null,
      }));

      setLogs(enrichedLogs);
    } catch (error) {
      console.error("Error in fetchLogs:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const filteredLogs = logs.filter(
    (log) =>
      log.action.toLowerCase().includes(search.toLowerCase()) ||
      log.actor_email?.toLowerCase().includes(search.toLowerCase()) ||
      log.target_email?.toLowerCase().includes(search.toLowerCase())
  );

  const getActionBadge = (action: string) => {
    if (action.includes("block")) return <Badge variant="destructive">{action}</Badge>;
    if (action.includes("delete")) return <Badge variant="destructive">{action}</Badge>;
    if (action.includes("impersonate")) return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">{action}</Badge>;
    if (action.includes("role")) return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">{action}</Badge>;
    return <Badge variant="secondary">{action}</Badge>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Аудит-лог</h1>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Поиск..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <GlassCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Дата/Время</TableHead>
              <TableHead>Действие</TableHead>
              <TableHead>Кто выполнил</TableHead>
              <TableHead>На кого</TableHead>
              <TableHead>Детали</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredLogs.map((log) => (
              <TableRow key={log.id}>
                <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                  {format(new Date(log.created_at), "dd MMM yyyy HH:mm:ss", { locale: ru })}
                </TableCell>
                <TableCell>{getActionBadge(log.action)}</TableCell>
                <TableCell className="text-sm">{log.actor_email}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {log.target_email || "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                  {log.meta ? JSON.stringify(log.meta) : "—"}
                </TableCell>
              </TableRow>
            ))}
            {filteredLogs.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  Нет записей
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </GlassCard>
    </div>
  );
}
