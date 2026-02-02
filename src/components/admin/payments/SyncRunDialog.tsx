import { useState, useEffect } from "react";
import { format, subDays } from "date-fns";
import { ru } from "date-fns/locale";
import { RefreshCw, CheckCircle2, XCircle, AlertTriangle, Play, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SyncStats {
  scanned: number;
  inserted: number;
  updated: number;
  unchanged: number;
  errors: number;
  stopped_reason: string | null;
  error_samples: Array<{ uid: string; error: string }>;
  amount_sum_db: number;
  amount_sum_api: number;
  diff_count: number;
  diff_amount: number;
  duration_ms?: number;
  dry_run?: boolean;
  // Origin-based filtering (DEPRECATED - always 0)
  excluded_import_count?: number;
  excluded_null_paid_at_count?: number;
  strategy_used?: 'list' | 'uid_fallback' | 'statement_first' | 'unknown';
  selected_host?: string;
  uid_breakdown?: {
    ok_tx_found: number;
    uid_not_transaction_404: number;
    auth_errors: number;
    rate_limited: number;
    server_errors: number;
    other_4xx: number;
  };
  // PATCH-2: Statement reconcile fields
  statement_count?: number;
  db_count?: number;
  missing_in_db?: number;
  missing_uids_sample?: string[];
}

interface SyncRunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}

export default function SyncRunDialog({ open, onOpenChange, onComplete }: SyncRunDialogProps) {
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'success' | 'failed' | 'stopped'>('idle');
  const [progress, setProgress] = useState({ pages_done: 0, pages_total: 0, percent: 0 });
  const [stats, setStats] = useState<SyncStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(true);

  // Date range defaults to 2026
  const [fromDate, setFromDate] = useState("2026-01-01");
  const [toDate, setToDate] = useState(format(new Date(), "yyyy-MM-dd"));

  // Poll for updates when running
  useEffect(() => {
    if (!runId || status !== 'running') return;

    const interval = setInterval(async () => {
      const { data } = await supabase
        .from("payments_sync_runs")
        .select("*")
        .eq("id", runId)
        .single();

      if (data) {
        const runStats = data.stats as unknown as SyncStats | null;
        
        setProgress({
          pages_done: data.processed_pages || 0,
          pages_total: data.total_pages || 1,
          percent: data.total_pages > 0
            ? Math.round((data.processed_pages || 0) / data.total_pages * 100)
            : 0,
        });

        if (data.status === 'success' || data.status === 'failed' || data.status === 'stopped') {
          setStatus(data.status as 'success' | 'failed' | 'stopped');
          setStats(runStats);
          if (data.error) setError(data.error);
          clearInterval(interval);
          onComplete?.();
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [runId, status, onComplete]);

  const handleStart = async () => {
    setStatus('running');
    setError(null);
    setStats(null);
    setProgress({ pages_done: 0, pages_total: 1, percent: 0 });

    try {
      const { data, error: invokeError } = await supabase.functions.invoke('bepaid-sync-orchestrator', {
        body: {
          mode: 'bepaid_api',
          from_date: fromDate,
          to_date: toDate,
          dry_run: dryRun,
          batch_size: 50,
        },
      });

      if (invokeError) {
        throw new Error(invokeError.message);
      }

      if (data?.run_id) {
        setRunId(data.run_id);
        
        // If function returned immediately with final status
        if (data.status === 'success' || data.status === 'failed' || data.status === 'stopped') {
          setStatus(data.status);
          setStats(data.stats);
          if (data.error) setError(data.error);
          onComplete?.();
        }
      } else {
        throw new Error("No run_id returned");
      }
    } catch (err: any) {
      setStatus('failed');
      setError(err.message);
      toast.error("Ошибка запуска синхронизации", {
        description: err.message,
      });
    }
  };

  const handleClose = () => {
    if (status === 'running') {
      toast.warning("Синхронизация выполняется", {
        description: "Закрытие диалога не остановит процесс",
      });
    }
    onOpenChange(false);
  };

  const handleReset = () => {
    setRunId(null);
    setStatus('idle');
    setStats(null);
    setError(null);
    setProgress({ pages_done: 0, pages_total: 0, percent: 0 });
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'running':
        return <Loader2 className="h-5 w-5 animate-spin text-primary" />;
      case 'success':
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-destructive" />;
      case 'stopped':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      default:
        return <RefreshCw className="h-5 w-5" />;
    }
  };

  const getStatusLabel = () => {
    switch (status) {
      case 'running': return 'Синхронизация...';
      case 'success': return 'Завершено';
      case 'failed': return 'Ошибка';
      case 'stopped': return 'Остановлено';
      default: return 'Готов к запуску';
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {getStatusIcon()}
            Синхронизация bePaid
          </DialogTitle>
          <DialogDescription>
            Полная сверка платежей с bePaid API до копейки
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Date range inputs */}
          {status === 'idle' && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="from-date">С даты</Label>
                <Input
                  id="from-date"
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="to-date">По дату</Label>
                <Input
                  id="to-date"
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Dry run toggle */}
          {status === 'idle' && (
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="dry-run" className="font-medium">
                  Пробный запуск (dry-run)
                </Label>
                <p className="text-sm text-muted-foreground">
                  Только просмотр изменений без записи в базу
                </p>
              </div>
              <Switch
                id="dry-run"
                checked={dryRun}
                onCheckedChange={setDryRun}
              />
            </div>
          )}

          {/* Progress */}
          {status === 'running' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span>Прогресс</span>
                <span>{progress.percent}%</span>
              </div>
              <Progress value={progress.percent} className="h-2" />
              <p className="text-sm text-muted-foreground text-center">
                Обработано {progress.pages_done} из {progress.pages_total} страниц
              </p>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {/* Stopped reason */}
          {stats?.stopped_reason && (
            <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 p-3">
              <p className="text-sm text-yellow-700 dark:text-yellow-400">
                {stats.stopped_reason}
              </p>
            </div>
          )}

          {/* Results */}
          {stats && status !== 'running' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm font-medium">
                <span>Результаты</span>
                <div className="flex gap-2">
                  {stats.strategy_used && (
                    <Badge variant="secondary">
                      {stats.strategy_used === 'list' ? 'API List' : 
                       stats.strategy_used === 'uid_fallback' ? 'UID Probe' : 
                       stats.strategy_used === 'statement_first' ? 'Statement' :
                       'Unknown'}
                    </Badge>
                  )}
                  {stats.dry_run && (
                    <Badge variant="outline">Dry-run</Badge>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex justify-between p-2 rounded bg-muted/50">
                  <span className="text-muted-foreground">Просканировано:</span>
                  <span className="font-mono">{stats.scanned}</span>
                </div>
                <div className="flex justify-between p-2 rounded bg-muted/50">
                  <span className="text-muted-foreground">Обновлено:</span>
                  <span className="font-mono">{stats.updated}</span>
                </div>
                <div className="flex justify-between p-2 rounded bg-muted/50">
                  <span className="text-muted-foreground">Без изменений:</span>
                  <span className="font-mono">{stats.unchanged}</span>
                </div>
                <div className="flex justify-between p-2 rounded bg-muted/50">
                  <span className="text-muted-foreground">Ошибок:</span>
                  <span className={`font-mono ${stats.errors > 0 ? 'text-destructive' : ''}`}>
                    {stats.errors}
                  </span>
                </div>
              </div>
              
              {/* PATCH-2: Statement reconcile results */}
              {stats.strategy_used === 'statement_first' && (
                <div className="rounded-lg border p-3 space-y-2">
                  <div className="text-sm font-medium text-muted-foreground">Сверка с выпиской</div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex justify-between p-2 rounded bg-muted/50">
                      <span className="text-muted-foreground">В выписке:</span>
                      <span className="font-mono">{stats.statement_count || 0}</span>
                    </div>
                    <div className="flex justify-between p-2 rounded bg-muted/50">
                      <span className="text-muted-foreground">В базе:</span>
                      <span className="font-mono">{stats.db_count || 0}</span>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Отсутствуют в базе:</span>
                    <Badge variant={(stats.missing_in_db || 0) > 0 ? "destructive" : "default"}>
                      {stats.missing_in_db || 0}
                    </Badge>
                  </div>
                </div>
              )}
              
              {/* PATCH-2: Missing UIDs sample */}
              {stats.missing_uids_sample && stats.missing_uids_sample.length > 0 && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                  <div className="text-sm font-medium text-amber-600 dark:text-amber-400 mb-2">
                    Missing UIDs (первые {stats.missing_uids_sample.length})
                  </div>
                  <ScrollArea className="h-24">
                    <div className="space-y-1">
                      {stats.missing_uids_sample.map((uid, i) => (
                        <div key={i} className="text-xs font-mono text-muted-foreground truncate">
                          {uid}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {/* Diff summary */}
              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Расхождений:</span>
                  <Badge variant={stats.diff_count === 0 ? "default" : "destructive"}>
                    {stats.diff_count}
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Разница сумм:</span>
                  <Badge variant={Math.abs(stats.diff_amount) < 0.01 ? "default" : "destructive"}>
                    {stats.diff_amount >= 0 ? '+' : ''}{stats.diff_amount.toFixed(2)} BYN
                  </Badge>
                </div>
              </div>

              {/* Duration */}
              {stats.duration_ms && (
                <p className="text-xs text-muted-foreground text-center">
                  Время выполнения: {(stats.duration_ms / 1000).toFixed(1)} сек
                </p>
              )}

              {/* Error samples */}
              {stats.error_samples && stats.error_samples.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    Примеры ошибок ({stats.error_samples.length})
                  </summary>
                  <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                    {stats.error_samples.map((sample, i) => (
                      <div key={i} className="text-xs font-mono p-1 bg-muted rounded">
                        {sample.uid}: {sample.error}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {status === 'idle' && (
            <Button onClick={handleStart} className="gap-2">
              <Play className="h-4 w-4" />
              {dryRun ? 'Проверить' : 'Синхронизировать'}
            </Button>
          )}

          {(status === 'success' || status === 'failed' || status === 'stopped') && (
            <>
              <Button variant="outline" onClick={handleReset}>
                Новый запуск
              </Button>
              {stats?.dry_run && stats.diff_count > 0 && (
                <Button onClick={() => { setDryRun(false); handleReset(); }}>
                  Применить изменения
                </Button>
              )}
            </>
          )}

          {status === 'running' && (
            <Button variant="outline" disabled>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Выполняется...
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
