import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Trash2, AlertTriangle, CheckCircle, XCircle, Loader2, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";

interface PurgeImportsDialogProps {
  onComplete?: () => void;
  renderTrigger?: (onClick: () => void) => React.ReactNode;
}

interface PurgeResult {
  id: string;
  bepaid_uid: string | null;
  amount: number;
  currency: string;
  paid_at: string | null;
  source: string;
  has_conflict: boolean;
  conflict_reason?: string;
}

interface PurgeReport {
  total_found: number;
  eligible_for_deletion: number;
  with_conflicts: number;
  deleted: number;
  examples: PurgeResult[];
  conflicts: PurgeResult[];
  total_amount: number;
}

type StatusFilter = 'pending' | 'error' | 'processing';

export default function PurgeImportsDialog({ onComplete, renderTrigger }: PurgeImportsDialogProps) {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<PurgeReport | null>(null);
  const [mode, setMode] = useState<'idle' | 'preview' | 'executed'>('idle');
  const [dateFrom, setDateFrom] = useState("2026-01-01");
  const [dateTo, setDateTo] = useState("");
  
  // Status filter checkboxes
  const [statusFilters, setStatusFilters] = useState<Record<StatusFilter, boolean>>({
    pending: true,
    error: true,
    processing: true,
  });

  const toggleStatus = (status: StatusFilter) => {
    setStatusFilters(prev => ({ ...prev, [status]: !prev[status] }));
  };

  const getSelectedStatuses = (): string[] => {
    return Object.entries(statusFilters)
      .filter(([_, checked]) => checked)
      .map(([status]) => status);
  };

  const handlePurge = async (executeDryRun: boolean) => {
    const selectedStatuses = getSelectedStatuses();
    if (selectedStatuses.length === 0) {
      toast.error("Выберите хотя бы один статус");
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-purge-imported-transactions', {
        body: {
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          source_filter: 'file_import', // Target specifically file_import
          status_filter: selectedStatuses,
          dry_run: executeDryRun,
          limit: 5000, // Increased for mass cleanup
          batch_size: 500,
        }
      });

      if (error) throw error;

      if (data?.success && data.report) {
        setReport(data.report);
        setMode(executeDryRun ? 'preview' : 'executed');
        
        if (!executeDryRun && data.report.deleted > 0) {
          toast.success(`Удалено ${data.report.deleted} записей`);
          onComplete?.();
        }
      } else {
        toast.error(data?.message || "Ошибка выполнения");
      }
    } catch (e: any) {
      toast.error(`Ошибка: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setReport(null);
    setMode('idle');
  };

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const selectedCount = getSelectedStatuses().length;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); else setOpen(o); }}>
      {renderTrigger ? (
        <span onClick={() => setOpen(true)}>{renderTrigger(() => setOpen(true))}</span>
      ) : (
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2 text-destructive hover:text-destructive">
            <Trash2 className="h-4 w-4" />
            Удалить file_import
          </Button>
        </DialogTrigger>
      )}
      
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Очистка зависших file_import
          </DialogTitle>
          <DialogDescription>
            Удаляет записи из очереди с source='file_import'. Не затрагивает orders, payments, subscriptions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Warning about what this does */}
          <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950/20">
            <Info className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-blue-700 dark:text-blue-400 text-xs">
              Очищает только очередь payment_reconcile_queue. Безопасно для данных заказов и платежей.
            </AlertDescription>
          </Alert>

          {/* Date filters */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="date-from" className="text-xs">Дата с</Label>
              <Input
                id="date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-8"
                disabled={isLoading}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="date-to" className="text-xs">Дата по</Label>
              <Input
                id="date-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-8"
                disabled={isLoading}
              />
            </div>
          </div>

          {/* Status filter checkboxes */}
          <div className="space-y-2">
            <Label className="text-xs">Статусы для очистки</Label>
            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <Checkbox 
                  id="status-pending" 
                  checked={statusFilters.pending}
                  onCheckedChange={() => toggleStatus('pending')}
                  disabled={isLoading}
                />
                <label htmlFor="status-pending" className="text-sm cursor-pointer">
                  pending
                  <Badge variant="secondary" className="ml-1 text-[10px]">застрявшие</Badge>
                </label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox 
                  id="status-error" 
                  checked={statusFilters.error}
                  onCheckedChange={() => toggleStatus('error')}
                  disabled={isLoading}
                />
                <label htmlFor="status-error" className="text-sm cursor-pointer">
                  error
                </label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox 
                  id="status-processing" 
                  checked={statusFilters.processing}
                  onCheckedChange={() => toggleStatus('processing')}
                  disabled={isLoading}
                />
                <label htmlFor="status-processing" className="text-sm cursor-pointer">
                  processing
                </label>
              </div>
            </div>
          </div>

          {/* Report */}
          {report && (
            <div className="space-y-3">
              {/* Summary stats */}
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="rounded-lg border p-2">
                  <div className="text-lg font-semibold">{report.total_found}</div>
                  <div className="text-xs text-muted-foreground">Найдено</div>
                </div>
                <div className="rounded-lg border p-2 bg-green-50 dark:bg-green-950/20">
                  <div className="text-lg font-semibold text-green-600">{report.eligible_for_deletion}</div>
                  <div className="text-xs text-muted-foreground">К удалению</div>
                </div>
                <div className="rounded-lg border p-2 bg-amber-50 dark:bg-amber-950/20">
                  <div className="text-lg font-semibold text-amber-600">{report.with_conflicts}</div>
                  <div className="text-xs text-muted-foreground">Конфликты</div>
                </div>
                <div className={`rounded-lg border p-2 ${mode === 'executed' && report.deleted > 0 ? 'bg-red-50 dark:bg-red-950/20' : ''}`}>
                  <div className={`text-lg font-semibold ${mode === 'executed' && report.deleted > 0 ? 'text-red-600' : ''}`}>
                    {report.deleted}
                  </div>
                  <div className="text-xs text-muted-foreground">Удалено</div>
                </div>
              </div>

              <div className="text-sm">
                Сумма к удалению: <span className="font-semibold">{formatAmount(report.total_amount)} BYN</span>
              </div>

              {/* Success message after execution */}
              {mode === 'executed' && report.deleted > 0 && (
                <Alert className="border-green-200 bg-green-50 dark:bg-green-950/20">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-green-700 dark:text-green-400">
                    Успешно удалено {report.deleted} записей на сумму {formatAmount(report.total_amount)} BYN
                  </AlertDescription>
                </Alert>
              )}

              {/* Examples */}
              {report.examples.length > 0 && mode === 'preview' && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">
                    Примеры записей к удалению:
                  </div>
                  <ScrollArea className="h-[100px] rounded-md border">
                    <div className="p-2 space-y-1">
                      {report.examples.map((r) => (
                        <div key={r.id} className="flex items-center gap-2 text-xs py-1 border-b last:border-0">
                          <CheckCircle className="h-3 w-3 text-green-500 flex-shrink-0" />
                          <span className="font-mono truncate max-w-[100px]">
                            {r.bepaid_uid?.substring(0, 8) || r.id.substring(0, 8)}...
                          </span>
                          <span className="tabular-nums">{formatAmount(r.amount)}</span>
                          <span className="text-muted-foreground">{r.currency}</span>
                          {r.paid_at && (
                            <span className="text-muted-foreground text-[10px]">
                              {new Date(r.paid_at).toLocaleDateString('ru-RU')}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {/* Conflicts */}
              {report.conflicts.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-amber-600 mb-1">
                    Конфликты (не будут удалены — есть в API):
                  </div>
                  <ScrollArea className="h-[80px] rounded-md border border-amber-200 dark:border-amber-800">
                    <div className="p-2 space-y-1">
                      {report.conflicts.map((r) => (
                        <div key={r.id} className="flex items-center gap-2 text-xs py-1 border-b last:border-0">
                          <XCircle className="h-3 w-3 text-amber-500 flex-shrink-0" />
                          <span className="font-mono truncate max-w-[100px]">
                            {r.bepaid_uid?.substring(0, 8) || r.id.substring(0, 8)}...
                          </span>
                          <Badge variant="outline" className="text-[9px]">
                            {r.conflict_reason || 'EXISTS_IN_API'}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleClose}>
            Закрыть
          </Button>
          
          {mode !== 'executed' && (
            <Button
              variant="secondary"
              onClick={() => handlePurge(true)}
              disabled={isLoading || selectedCount === 0}
            >
              {isLoading && mode !== 'preview' ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Dry-run (предпросмотр)
            </Button>
          )}
          
          {mode === 'preview' && report && report.eligible_for_deletion > 0 && (
            <Button
              variant="destructive"
              onClick={() => handlePurge(false)}
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Удалить ({report.eligible_for_deletion})
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}