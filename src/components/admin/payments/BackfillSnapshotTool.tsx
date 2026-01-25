import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { GlassCard } from "@/components/ui/GlassCard";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, AlertTriangle, CheckCircle2, XCircle, Play, Eye } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface BackfillResult {
  success: boolean;
  dry_run: boolean;
  fetched_count: number;
  total_candidates: number;
  batch_size: number;
  would_process?: number;
  updated?: number;
  failed?: number;
  sample_ids?: string[];
  updated_ids?: string[];
  errors?: string[];
  remaining: number;
  staff_excluded: number;
  anomaly_logged: boolean;
}

interface AuditLogEntry {
  id: string;
  action: string;
  actor_type: string;
  actor_user_id: string | null;
  actor_label: string | null;
  created_at: string;
  meta: {
    requested_by_user_id?: string;
    fetched_count?: number;
    total_candidates?: number;
    dry_run?: boolean;
    [key: string]: unknown;
  };
}

interface BackfillSnapshotToolProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BackfillSnapshotTool({ open, onOpenChange }: BackfillSnapshotToolProps) {
  const [batchSize, setBatchSize] = useState(50);
  const [maxTotal, setMaxTotal] = useState(500);
  const [dryRunResult, setDryRunResult] = useState<BackfillResult | null>(null);
  const [executeResult, setExecuteResult] = useState<BackfillResult | null>(null);
  const [showAuditLogs, setShowAuditLogs] = useState(false);

  // Fetch recent audit logs for backfill actions
  const { data: auditLogs, refetch: refetchAuditLogs } = useQuery({
    queryKey: ["backfill-audit-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("id, action, actor_type, actor_user_id, actor_label, created_at, meta")
        .like("action", "admin.backfill%")
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) throw error;
      return data as AuditLogEntry[];
    },
    enabled: open && showAuditLogs,
  });

  // Dry-run mutation
  const dryRunMutation = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not authenticated");

      const response = await supabase.functions.invoke("admin-backfill-recurring-snapshot", {
        body: { dry_run: true, batch_size: batchSize, max_total: maxTotal },
      });

      if (response.error) throw new Error(response.error.message);
      return response.data as BackfillResult;
    },
    onSuccess: (data) => {
      setDryRunResult(data);
      setExecuteResult(null);
      setShowAuditLogs(true);
      refetchAuditLogs();
    },
  });

  // Execute mutation
  const executeMutation = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not authenticated");

      const response = await supabase.functions.invoke("admin-backfill-recurring-snapshot", {
        body: { dry_run: false, batch_size: batchSize, max_total: maxTotal },
      });

      if (response.error) throw new Error(response.error.message);
      return response.data as BackfillResult;
    },
    onSuccess: (data) => {
      setExecuteResult(data);
      setShowAuditLogs(true);
      refetchAuditLogs();
    },
  });

  // Guard conditions for Execute button
  const canExecute = 
    dryRunResult !== null && 
    dryRunResult.success &&
    (dryRunResult.would_process ?? 0) > 0 &&
    !dryRunResult.anomaly_logged;

  const getExecuteDisabledReason = (): string | null => {
    if (!dryRunResult) return "Сначала запустите Dry-run";
    if (!dryRunResult.success) return "Dry-run завершился с ошибкой";
    if ((dryRunResult.would_process ?? 0) === 0) return "Нет кандидатов для обработки (would_process=0)";
    if (dryRunResult.anomaly_logged) return "Аномалия: total_candidates > max_total";
    return null;
  };

  const handleClose = () => {
    setDryRunResult(null);
    setExecuteResult(null);
    setShowAuditLogs(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="h-5 w-5" />
            Backfill recurring_snapshot
          </DialogTitle>
          <DialogDescription>
            Заполняет meta.recurring_snapshot для подписок auto_renew=true без snapshot 
            (исключая staff и non-subscription по guards).
          </DialogDescription>
        </DialogHeader>

        {/* Warning */}
        <Alert variant="destructive" className="border-orange-500/50 bg-orange-500/10">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Массовая операция</AlertTitle>
          <AlertDescription>
            Используйте dry-run перед execute. Изменения необратимы.
          </AlertDescription>
        </Alert>

        {/* Input fields */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="batch_size">batch_size</Label>
            <Input
              id="batch_size"
              type="number"
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              min={1}
              max={200}
            />
            <p className="text-xs text-muted-foreground">Сколько записей обработать за один вызов</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="max_total">max_total</Label>
            <Input
              id="max_total"
              type="number"
              value={maxTotal}
              onChange={(e) => setMaxTotal(Number(e.target.value))}
              min={1}
              max={5000}
            />
            <p className="text-xs text-muted-foreground">Лимит выборки из БД (anomaly при превышении)</p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={() => dryRunMutation.mutate()}
            disabled={dryRunMutation.isPending || executeMutation.isPending}
            className="flex-1"
          >
            {dryRunMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Eye className="h-4 w-4 mr-2" />
            )}
            Dry-run
          </Button>
          <Button
            onClick={() => executeMutation.mutate()}
            disabled={!canExecute || executeMutation.isPending || dryRunMutation.isPending}
            className="flex-1"
            variant={canExecute ? "default" : "secondary"}
          >
            {executeMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            Execute
          </Button>
        </div>

        {/* Execute disabled reason */}
        {!canExecute && getExecuteDisabledReason() && (
          <p className="text-xs text-muted-foreground text-center">
            Execute заблокирован: {getExecuteDisabledReason()}
          </p>
        )}

        {/* Error display */}
        {(dryRunMutation.error || executeMutation.error) && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertTitle>Ошибка</AlertTitle>
            <AlertDescription>
              {(dryRunMutation.error as Error)?.message || (executeMutation.error as Error)?.message}
            </AlertDescription>
          </Alert>
        )}

        {/* Dry-run result */}
        {dryRunResult && (
          <GlassCard className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span className="font-medium">Результат Dry-run</span>
              <Badge variant="secondary">dry_run: true</Badge>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">fetched_count:</span>{" "}
                <span className="font-mono">{dryRunResult.fetched_count}</span>
              </div>
              <div>
                <span className="text-muted-foreground">total_candidates:</span>{" "}
                <span className="font-mono">{dryRunResult.total_candidates}</span>
              </div>
              <div>
                <span className="text-muted-foreground">would_process:</span>{" "}
                <span className="font-mono font-bold">{dryRunResult.would_process ?? 0}</span>
              </div>
              <div>
                <span className="text-muted-foreground">batch_size:</span>{" "}
                <span className="font-mono">{dryRunResult.batch_size}</span>
              </div>
              <div>
                <span className="text-muted-foreground">remaining:</span>{" "}
                <span className="font-mono">{dryRunResult.remaining ?? 0}</span>
              </div>
              <div>
                <span className="text-muted-foreground">staff_excluded:</span>{" "}
                <span className="font-mono">{dryRunResult.staff_excluded}</span>
              </div>
              <div className="col-span-3">
                <span className="text-muted-foreground">anomaly_logged:</span>{" "}
                <Badge variant={dryRunResult.anomaly_logged ? "destructive" : "secondary"}>
                  {dryRunResult.anomaly_logged ? "true" : "false"}
                </Badge>
              </div>
            </div>
            {dryRunResult.sample_ids && dryRunResult.sample_ids.length > 0 && (
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">sample_ids (первые 10):</span>
                <div className="flex flex-wrap gap-1">
                  {dryRunResult.sample_ids.map((id) => (
                    <code key={id} className="text-[10px] px-1 py-0.5 bg-muted rounded">
                      {id.slice(0, 8)}…
                    </code>
                  ))}
                </div>
              </div>
            )}
          </GlassCard>
        )}

        {/* Execute result */}
        {executeResult && (
          <GlassCard className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              {executeResult.success && (executeResult.failed ?? 0) === 0 ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-orange-500" />
              )}
              <span className="font-medium">Результат Execute</span>
              <Badge>dry_run: false</Badge>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">fetched_count:</span>{" "}
                <span className="font-mono">{executeResult.fetched_count}</span>
              </div>
              <div>
                <span className="text-muted-foreground">total_candidates:</span>{" "}
                <span className="font-mono">{executeResult.total_candidates}</span>
              </div>
              <div>
                <span className="text-muted-foreground">updated:</span>{" "}
                <span className="font-mono font-bold text-green-500">{executeResult.updated ?? 0}</span>
              </div>
              <div>
                <span className="text-muted-foreground">failed:</span>{" "}
                <span className={`font-mono ${(executeResult.failed ?? 0) > 0 ? "text-destructive font-bold" : ""}`}>
                  {executeResult.failed ?? 0}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">remaining:</span>{" "}
                <span className="font-mono">{executeResult.remaining ?? 0}</span>
              </div>
              <div>
                <span className="text-muted-foreground">staff_excluded:</span>{" "}
                <span className="font-mono">{executeResult.staff_excluded}</span>
              </div>
            </div>
            {executeResult.errors && executeResult.errors.length > 0 && (
              <div className="space-y-1">
                <span className="text-xs text-destructive font-medium">Ошибки:</span>
                <div className="text-xs font-mono bg-destructive/10 p-2 rounded max-h-24 overflow-auto">
                  {executeResult.errors.slice(0, 5).map((err, i) => (
                    <div key={i}>{err}</div>
                  ))}
                  {executeResult.errors.length > 5 && (
                    <div className="text-muted-foreground">...и ещё {executeResult.errors.length - 5}</div>
                  )}
                </div>
              </div>
            )}
          </GlassCard>
        )}

        {/* SYSTEM ACTOR PROOF: Audit logs table */}
        {showAuditLogs && (
          <GlassCard className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">Последние audit_logs (SYSTEM ACTOR PROOF)</span>
              <Button variant="ghost" size="sm" onClick={() => refetchAuditLogs()}>
                Обновить
              </Button>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">actor_type</TableHead>
                    <TableHead className="text-xs">actor_user_id</TableHead>
                    <TableHead className="text-xs">actor_label</TableHead>
                    <TableHead className="text-xs">created_at</TableHead>
                    <TableHead className="text-xs">requested_by</TableHead>
                    <TableHead className="text-xs">fetched_count</TableHead>
                    <TableHead className="text-xs">total_candidates</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditLogs?.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell>
                        <Badge variant={log.actor_type === "system" ? "default" : "secondary"}>
                          {log.actor_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {log.actor_user_id ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs max-w-[150px] truncate">
                        {log.actor_label ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {format(new Date(log.created_at), "dd.MM HH:mm:ss", { locale: ru })}
                      </TableCell>
                      <TableCell className="font-mono text-[10px]">
                        {log.meta?.requested_by_user_id?.slice(0, 8) ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {log.meta?.fetched_count ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {log.meta?.total_candidates ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!auditLogs || auditLogs.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        Нет записей
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </GlassCard>
        )}
      </DialogContent>
    </Dialog>
  );
}
