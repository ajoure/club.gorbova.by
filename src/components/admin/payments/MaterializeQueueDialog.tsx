import { useState, useMemo, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { 
  Database, Play, CheckCircle2, AlertTriangle, Loader2, Download
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

interface MaterializeQueueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  dateFrom?: string;
  dateTo?: string;
}

interface MaterializeResult {
  success: boolean;
  dry_run: boolean;
  stats: {
    scanned: number;
    to_create: number;
    created: number;
    updated: number;
    skipped: number;
    errors: number;
  };
  samples: Array<{
    queue_id: string;
    stable_uid: string;
    result: string;
    error?: string;
  }>;
  warnings: string[];
  duration_ms: number;
}

export default function MaterializeQueueDialog({
  open,
  onOpenChange,
  onSuccess,
  dateFrom = "2026-01-01",
  dateTo = "2026-01-25",
}: MaterializeQueueDialogProps) {
  const { toast } = useToast();
  const { user, role } = useAuth();
  
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<MaterializeResult | null>(null);
  const [confirmExecute, setConfirmExecute] = useState(false);
  const [progress, setProgress] = useState(0);
  
  const whoami = useMemo(() => ({
    email: user?.email || 'unknown',
    uid: user?.id || 'unknown',
    roles: role || 'user',
  }), [user, role]);
  
  const isSuperadmin = role === 'superadmin' || role === 'admin';
  
  const runMaterialize = useCallback(async (dryRun: boolean) => {
    setIsLoading(true);
    setProgress(10);
    
    try {
      const { data, error } = await supabase.functions.invoke('admin-materialize-queue-payments', {
        body: {
          dry_run: dryRun,
          from_date: dateFrom,
          to_date: dateTo,
          limit: 500,
        },
      });
      
      setProgress(90);
      
      if (error) throw error;
      
      setResult(data as MaterializeResult);
      setProgress(100);
      
      toast({
        title: dryRun ? "DRY-RUN завершён" : "Материализация завершена",
        description: `Создано: ${data.stats?.created || 0}, Пропущено: ${data.stats?.skipped || 0}`,
      });
      
      if (!dryRun && onSuccess) {
        onSuccess();
      }
    } catch (err: any) {
      toast({
        title: "Ошибка",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
      setProgress(0);
    }
  }, [dateFrom, dateTo, toast, onSuccess]);
  
  const downloadReport = useCallback(() => {
    if (!result) return;
    
    const lines = [
      'MATERIALIZE QUEUE REPORT',
      `Date: ${new Date().toISOString()}`,
      `Period: ${dateFrom} to ${dateTo}`,
      `Mode: ${result.dry_run ? 'DRY-RUN' : 'EXECUTE'}`,
      '',
      '=== STATS ===',
      `Scanned: ${result.stats.scanned}`,
      `To create: ${result.stats.to_create}`,
      `Created: ${result.stats.created}`,
      `Skipped: ${result.stats.skipped}`,
      `Errors: ${result.stats.errors}`,
      `Duration: ${result.duration_ms}ms`,
      '',
      '=== WARNINGS ===',
      ...result.warnings,
      '',
      '=== SAMPLES ===',
      ...result.samples.map(s => `${s.queue_id} | ${s.stable_uid} | ${s.result} ${s.error ? '| ' + s.error : ''}`),
    ];
    
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `materialize-report-${dateFrom}-${dateTo}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result, dateFrom, dateTo]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-slate-900/95 backdrop-blur-xl border-slate-700/50">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-100">
            <Database className="h-5 w-5 text-purple-400" />
            Материализация очереди → payments_v2
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Перенос записей из payment_reconcile_queue в CANON (payments_v2).
            Только записи с bepaid_uid.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Period info */}
          <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700/50">
            <div className="text-xs text-slate-500 mb-1">Период</div>
            <div className="text-sm font-medium text-slate-200">{dateFrom} — {dateTo}</div>
          </div>

          {/* Progress */}
          {isLoading && (
            <div className="space-y-2">
              <Progress value={progress} className="h-2" />
              <div className="text-xs text-slate-500 text-center">Обработка...</div>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="space-y-3">
              <div className={`p-4 rounded-lg border ${result.dry_run ? 'bg-amber-500/10 border-amber-500/30' : 'bg-emerald-500/10 border-emerald-500/30'}`}>
                <div className="flex items-center gap-2 mb-3">
                  {result.dry_run ? (
                    <AlertTriangle className="h-4 w-4 text-amber-400" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  )}
                  <span className={`font-semibold text-sm ${result.dry_run ? 'text-amber-300' : 'text-emerald-300'}`}>
                    {result.dry_run ? 'DRY-RUN результат' : 'Выполнено'}
                  </span>
                </div>
                
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <div className="text-slate-500 text-xs">Просканировано</div>
                    <div className="font-semibold text-slate-200 tabular-nums">{result.stats.scanned}</div>
                  </div>
                  <div>
                    <div className="text-slate-500 text-xs">{result.dry_run ? 'Будет создано' : 'Создано'}</div>
                    <div className="font-semibold text-emerald-400 tabular-nums">{result.stats.created}</div>
                  </div>
                  <div>
                    <div className="text-slate-500 text-xs">Пропущено</div>
                    <div className="font-semibold text-slate-400 tabular-nums">{result.stats.skipped}</div>
                  </div>
                </div>
                
                {result.stats.errors > 0 && (
                  <div className="mt-2 text-xs text-rose-400">
                    Ошибок: {result.stats.errors}
                  </div>
                )}
                
                {result.warnings.length > 0 && (
                  <div className="mt-2 text-xs text-amber-400">
                    {result.warnings.join('; ')}
                  </div>
                )}
              </div>
              
              <Button variant="ghost" size="sm" onClick={downloadReport} className="gap-1.5 text-slate-400 hover:text-slate-200">
                <Download className="h-3.5 w-3.5" />
                Скачать отчёт
              </Button>
            </div>
          )}

          {/* Execute confirmation */}
          {result && result.dry_run && result.stats.to_create > 0 && isSuperadmin && (
            <div className="space-y-3 pt-2 border-t border-slate-700/50">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="confirm-execute"
                  checked={confirmExecute}
                  onCheckedChange={(checked) => setConfirmExecute(checked === true)}
                />
                <Label htmlFor="confirm-execute" className="text-xs text-slate-400 leading-relaxed cursor-pointer">
                  Я подтверждаю создание {result.stats.to_create} записей в payments_v2.
                  Это действие необратимо.
                </Label>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t border-slate-700/50">
          <div className="text-xs text-slate-500">
            <span className="font-mono">{whoami.email}</span>
            <span className="mx-2">•</span>
            <span className="font-mono">{whoami.roles}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="text-slate-400 hover:text-slate-200"
            >
              Закрыть
            </Button>
            <Button
              variant="secondary"
              onClick={() => runMaterialize(true)}
              disabled={isLoading}
              className="gap-2 bg-slate-700 hover:bg-slate-600 text-slate-200"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              DRY-RUN
            </Button>
            {result && result.dry_run && result.stats.to_create > 0 && confirmExecute && isSuperadmin && (
              <Button
                onClick={() => runMaterialize(false)}
                disabled={isLoading}
                className="gap-2 bg-purple-600 hover:bg-purple-500 text-white"
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                EXECUTE ({result.stats.to_create})
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
