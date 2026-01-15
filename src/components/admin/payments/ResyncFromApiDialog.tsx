import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { RefreshCw, Download, Check, AlertCircle, Info, Clock, Users, Package } from "lucide-react";
import { format, subDays } from "date-fns";

interface ResyncFromApiDialogProps {
  onComplete?: () => void;
  trigger?: React.ReactNode;
  renderTrigger?: (onClick: () => void) => React.ReactNode;
}

interface SyncReport {
  found: number;
  added: number;
  skipped: number;
  errors: number;
  skip_reasons: Record<string, number>;
  samples: {
    added: Array<{ uid: string; amount: number; email?: string }>;
    skipped: Array<{ uid: string; reason: string; amount?: number }>;
  };
}

interface SyncResult {
  success: boolean;
  dryRun: boolean;
  stats: {
    total_fetched: number;
    matched_by_email: number;
    matched_by_card: number;
    matched_by_name: number;
    not_matched: number;
    skipped_duplicate: number;
    created: number;
    errors: number;
  };
  syncReport: SyncReport;
  message?: string;
}

export default function ResyncFromApiDialog({ onComplete, trigger, renderTrigger }: ResyncFromApiDialogProps) {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<'idle' | 'preview' | 'executed'>('idle');
  const [result, setResult] = useState<SyncResult | null>(null);
  
  // Default to last 30 days
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));

  const handleSync = async (dryRun: boolean) => {
    setIsLoading(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('bepaid-full-sync', {
        body: {
          dryRun,
          fromDate: dateFrom,
          toDate: dateTo,
        }
      });
      
      if (error) throw error;
      
      setResult(data);
      setMode(dryRun ? 'preview' : 'executed');
      
      if (!dryRun && data?.stats?.created > 0) {
        toast.success(`Синхронизировано ${data.stats.created} новых платежей`);
        onComplete?.();
      } else if (!dryRun) {
        toast.info("Синхронизация завершена. Новых платежей не найдено.");
        onComplete?.();
      }
    } catch (e: any) {
      toast.error(`Ошибка синхронизации: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setResult(null);
    setMode('idle');
  };

  const formatSkipReason = (reason: string): string => {
    const reasonMap: Record<string, string> = {
      'already_exists': 'Уже существует',
      'no_successful_transaction': 'Нет успешной транзакции',
      'no_profile_match': 'Контакт не найден',
      'no_product_mapping': 'Нет маппинга продукта',
      'auto_create_disabled': 'Автосоздание отключено',
      'duplicate_uid': 'Дубликат UID',
    };
    return reasonMap[reason] || reason;
  };

  const stats = result?.stats;
  const report = result?.syncReport;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); else setOpen(o); }}>
      {renderTrigger ? (
        <span onClick={() => setOpen(true)}>{renderTrigger(() => setOpen(true))}</span>
      ) : (
        <DialogTrigger asChild>
          {trigger || (
            <Button variant="outline" size="sm" className="gap-2">
              <Download className="h-4 w-4" />
              Resync из API
            </Button>
          )}
        </DialogTrigger>
      )}
      
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Синхронизация с bePaid API
          </DialogTitle>
          <DialogDescription>
            Загрузка всех транзакций за период. Используйте Dry-run для предпросмотра без изменений.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Date range */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sync-date-from" className="text-xs">Дата с</Label>
              <Input
                id="sync-date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-8"
                disabled={isLoading}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sync-date-to" className="text-xs">Дата по</Label>
              <Input
                id="sync-date-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-8"
                disabled={isLoading}
              />
            </div>
          </div>
          
          {/* Info about API limitations */}
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              API bePaid возвращает транзакции с момента подключения интеграции. 
              Для исторических данных используйте CSV-импорт.
            </AlertDescription>
          </Alert>

          {/* Results */}
          {result && (
            <div className="space-y-3">
              {/* Summary stats */}
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="rounded-lg border p-2">
                  <div className="text-lg font-semibold">{report?.found || stats?.total_fetched || 0}</div>
                  <div className="text-xs text-muted-foreground">Найдено</div>
                </div>
                <div className="rounded-lg border p-2 bg-green-50 dark:bg-green-950/20">
                  <div className="text-lg font-semibold text-green-600">{report?.added || stats?.created || 0}</div>
                  <div className="text-xs text-muted-foreground">Добавлено</div>
                </div>
                <div className="rounded-lg border p-2">
                  <div className="text-lg font-semibold">{report?.skipped || stats?.skipped_duplicate || 0}</div>
                  <div className="text-xs text-muted-foreground">Пропущено</div>
                </div>
                <div className="rounded-lg border p-2 bg-amber-50 dark:bg-amber-950/20">
                  <div className="text-lg font-semibold text-amber-600">{report?.errors || stats?.errors || 0}</div>
                  <div className="text-xs text-muted-foreground">Ошибки</div>
                </div>
              </div>

              {/* Matching stats */}
              {stats && (stats.matched_by_email > 0 || stats.matched_by_card > 0 || stats.matched_by_name > 0) && (
                <div className="text-xs space-y-1 p-2 bg-muted/50 rounded-md">
                  <div className="font-medium mb-1">Матчинг контактов:</div>
                  <div className="flex flex-wrap gap-2">
                    {stats.matched_by_email > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        <Users className="h-3 w-3 mr-1" />
                        Email: {stats.matched_by_email}
                      </Badge>
                    )}
                    {stats.matched_by_card > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        Карта: {stats.matched_by_card}
                      </Badge>
                    )}
                    {stats.matched_by_name > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        Имя: {stats.matched_by_name}
                      </Badge>
                    )}
                    {stats.not_matched > 0 && (
                      <Badge variant="outline" className="text-xs text-amber-600">
                        Без матча: {stats.not_matched}
                      </Badge>
                    )}
                  </div>
                </div>
              )}

              {/* Skip reasons breakdown */}
              {report?.skip_reasons && Object.keys(report.skip_reasons).length > 0 && (
                <div className="text-xs space-y-1 p-2 border rounded-md">
                  <div className="font-medium mb-1 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Причины пропуска:
                  </div>
                  <div className="space-y-0.5">
                    {Object.entries(report.skip_reasons).map(([reason, count]) => (
                      <div key={reason} className="flex justify-between">
                        <span className="text-muted-foreground">{formatSkipReason(reason)}</span>
                        <span className="font-mono">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sample records */}
              {report?.samples?.added && report.samples.added.length > 0 && mode === 'preview' && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">
                    Примеры записей к добавлению:
                  </div>
                  <ScrollArea className="h-[80px] rounded-md border">
                    <div className="p-2 space-y-1">
                      {report.samples.added.map((r, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs py-1 border-b last:border-0">
                          <Check className="h-3 w-3 text-green-500 flex-shrink-0" />
                          <span className="font-mono truncate max-w-[100px]">{r.uid.substring(0, 8)}...</span>
                          <span className="tabular-nums">{r.amount} BYN</span>
                          {r.email && <span className="text-muted-foreground truncate">{r.email}</span>}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {/* Success message */}
              {mode === 'executed' && (report?.added || 0) > 0 && (
                <Alert className="border-green-200 bg-green-50 dark:bg-green-950/20">
                  <Check className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-green-700 dark:text-green-400">
                    Успешно синхронизировано {report?.added || stats?.created} записей
                  </AlertDescription>
                </Alert>
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
              onClick={() => handleSync(true)}
              disabled={isLoading || !dateFrom}
            >
              {isLoading && mode !== 'preview' ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Dry-run (предпросмотр)
            </Button>
          )}
          
          {mode === 'preview' && result && (report?.added || 0) > 0 && (
            <Button
              onClick={() => handleSync(false)}
              disabled={isLoading}
            >
              {isLoading ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              Синхронизировать ({report?.added || 0})
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
