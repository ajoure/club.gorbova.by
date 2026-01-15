import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, FileText, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ReceiptsSyncButtonProps {
  selectedIds?: string[];
  onComplete?: () => void;
  renderTrigger?: (onClick: () => void, isLoading: boolean) => React.ReactNode;
}

interface SyncResult {
  payment_id: string;
  source: 'queue' | 'payments_v2';
  status: 'updated' | 'unavailable' | 'error' | 'skipped';
  receipt_url?: string;
  error_code?: string;
  message?: string;
}

interface SyncReport {
  total_checked: number;
  updated: number;
  unavailable: number;
  errors: number;
  skipped: number;
  results: SyncResult[];
}

export default function ReceiptsSyncButton({ selectedIds, onComplete, renderTrigger }: ReceiptsSyncButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [report, setReport] = useState<SyncReport | null>(null);

  const handleSync = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('bepaid-receipts-sync', {
        body: {
          payment_ids: selectedIds?.length ? selectedIds : undefined,
          source: 'all',
          batch_size: 50,
          dry_run: false,
        }
      });

      if (error) throw error;

      if (data?.success && data.report) {
        setReport(data.report);
        setShowReport(true);
        
        if (data.report.updated > 0) {
          toast.success(`Получено ${data.report.updated} чеков`);
        } else if (data.report.total_checked === 0) {
          toast.info("Нет платежей для обработки");
        } else {
          toast.info(`Проверено ${data.report.total_checked}, новых чеков не найдено`);
        }
        
        onComplete?.();
      } else {
        toast.error(data?.message || "Ошибка синхронизации");
      }
    } catch (e: any) {
      toast.error(`Ошибка: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusIcon = (status: SyncResult['status']) => {
    switch (status) {
      case 'updated':
        return <CheckCircle className="h-3.5 w-3.5 text-green-500" />;
      case 'unavailable':
        return <XCircle className="h-3.5 w-3.5 text-muted-foreground" />;
      case 'error':
        return <AlertCircle className="h-3.5 w-3.5 text-destructive" />;
      case 'skipped':
        return <XCircle className="h-3.5 w-3.5 text-muted-foreground/50" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: SyncResult['status']) => {
    switch (status) {
      case 'updated':
        return <Badge variant="default" className="text-[10px]">Получен</Badge>;
      case 'unavailable':
        return <Badge variant="secondary" className="text-[10px]">Недоступен</Badge>;
      case 'error':
        return <Badge variant="destructive" className="text-[10px]">Ошибка</Badge>;
      case 'skipped':
        return <Badge variant="outline" className="text-[10px]">Пропущен</Badge>;
      default:
        return null;
    }
  };

  return (
    <>
      {renderTrigger ? (
        renderTrigger(handleSync, isLoading)
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={handleSync}
          disabled={isLoading}
          className="gap-2"
        >
          {isLoading ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <FileText className="h-4 w-4" />
          )}
          {selectedIds?.length ? `Получить чеки (${selectedIds.length})` : "Получить чеки"}
        </Button>
      )}

      <Dialog open={showReport} onOpenChange={setShowReport}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Результаты получения чеков
            </DialogTitle>
            <DialogDescription>
              Отчёт о синхронизации чеков с bePaid
            </DialogDescription>
          </DialogHeader>

          {report && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="rounded-lg border p-2">
                  <div className="text-lg font-semibold">{report.total_checked}</div>
                  <div className="text-xs text-muted-foreground">Проверено</div>
                </div>
                <div className="rounded-lg border p-2 bg-green-50 dark:bg-green-950/20">
                  <div className="text-lg font-semibold text-green-600">{report.updated}</div>
                  <div className="text-xs text-muted-foreground">Получено</div>
                </div>
                <div className="rounded-lg border p-2">
                  <div className="text-lg font-semibold text-muted-foreground">{report.unavailable}</div>
                  <div className="text-xs text-muted-foreground">Недоступно</div>
                </div>
                <div className="rounded-lg border p-2">
                  <div className="text-lg font-semibold text-muted-foreground">{report.skipped + report.errors}</div>
                  <div className="text-xs text-muted-foreground">Пропущено</div>
                </div>
              </div>

              {/* Detailed results */}
              {report.results.length > 0 && (
                <ScrollArea className="h-[200px] rounded-md border">
                  <div className="p-2 space-y-1">
                    {report.results.slice(0, 50).map((r, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs py-1 border-b last:border-0">
                        {getStatusIcon(r.status)}
                        <span className="font-mono truncate max-w-[100px]">
                          {r.payment_id.substring(0, 8)}...
                        </span>
                        <Badge variant="outline" className="text-[9px]">
                          {r.source === 'queue' ? 'Очередь' : 'Платежи'}
                        </Badge>
                        {getStatusBadge(r.status)}
                        {r.error_code && (
                          <span className="text-muted-foreground truncate">
                            {r.error_code}
                          </span>
                        )}
                      </div>
                    ))}
                    {report.results.length > 50 && (
                      <div className="text-xs text-muted-foreground text-center py-2">
                        ... и ещё {report.results.length - 50} записей
                      </div>
                    )}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReport(false)}>
              Закрыть
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
