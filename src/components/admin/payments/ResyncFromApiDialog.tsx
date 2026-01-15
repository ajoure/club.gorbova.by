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
import { RefreshCw, Download, Check, AlertCircle, AlertTriangle, Clock, Database, Zap } from "lucide-react";
import { format, subDays } from "date-fns";

interface ResyncFromApiDialogProps {
  onComplete?: () => void;
  trigger?: React.ReactNode;
  renderTrigger?: (onClick: () => void) => React.ReactNode;
}

// New UID-based resync result interface
interface UidResyncResult {
  success: boolean;
  dryRun: boolean;
  warning?: string;
  stats: {
    total_candidates: number;
    sources: {
      queue_webhook: number;
      queue_api_recover: number;
      payments_incomplete: number;
    };
    processed: number;
    updated: number;
    created: number;
    fetch_errors: number;
    already_complete: number;
    paid_at_fixed: number;
  };
  samples: {
    updated: Array<{ uid: string; paid_at_before: string | null; paid_at_after: string | null }>;
    errors: Array<{ uid: string; error: string }>;
  };
  stop_reason?: string;
}

export default function ResyncFromApiDialog({ onComplete, trigger, renderTrigger }: ResyncFromApiDialogProps) {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<'idle' | 'preview' | 'executed' | 'stopped'>('idle');
  const [result, setResult] = useState<UidResyncResult | null>(null);
  
  // Default to last 30 days
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));

  const handleSync = async (dryRun: boolean) => {
    setIsLoading(true);
    
    try {
      // Use new UID-based resync function
      const { data, error } = await supabase.functions.invoke('bepaid-uid-resync', {
        body: {
          dryRun,
          fromDate: dateFrom,
          toDate: dateTo,
          limit: 500,
        }
      });
      
      if (error) throw error;
      
      if (data?.stop_reason) {
        setResult(data);
        setMode('stopped');
        toast.warning("Требуется подтверждение для большого количества записей");
        return;
      }
      
      setResult(data);
      setMode(dryRun ? 'preview' : 'executed');
      
      if (!dryRun && (data?.stats?.updated > 0 || data?.stats?.created > 0)) {
        const total = (data.stats.updated || 0) + (data.stats.created || 0);
        toast.success(`Обновлено ${total} записей (paid_at исправлено: ${data.stats.paid_at_fixed || 0})`);
        onComplete?.();
      } else if (!dryRun) {
        toast.info("Восстановление завершено. Изменений не требуется.");
        onComplete?.();
      }
    } catch (e: any) {
      toast.error(`Ошибка восстановления: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setResult(null);
    setMode('idle');
  };

  const stats = result?.stats;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); else setOpen(o); }}>
      {renderTrigger ? (
        <span onClick={() => setOpen(true)}>{renderTrigger(() => setOpen(true))}</span>
      ) : (
        <DialogTrigger asChild>
          {trigger || (
            <Button variant="outline" size="sm" className="gap-2">
              <Database className="h-4 w-4" />
              Восстановление по UID
            </Button>
          )}
        </DialogTrigger>
      )}
      
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Восстановление по UID
            <Badge variant="secondary" className="ml-2 text-[10px]">только известные</Badge>
          </DialogTitle>
          <DialogDescription>
            Обогащение данных по известным UID из очереди и незаполненных платежей.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Warning about bulk API */}
          <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-xs text-amber-700 dark:text-amber-400">
              <strong>bePaid bulk API недоступен (404).</strong> Resync работает только по известным UID 
              из webhook-очереди и незаполненных payments. Для исторических данных используйте CSV-импорт.
            </AlertDescription>
          </Alert>

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

          {/* STOP safeguard message */}
          {mode === 'stopped' && result?.stop_reason && (
            <Alert className="border-red-200 bg-red-50 dark:bg-red-950/20">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-700 dark:text-red-400 text-xs">
                <strong>STOP:</strong> {result.stop_reason}
              </AlertDescription>
            </Alert>
          )}

          {/* Results */}
          {result && (
            <div className="space-y-3">
              {/* Source breakdown */}
              {stats && (
                <div className="text-xs p-2 bg-muted/50 rounded-md space-y-1">
                  <div className="font-medium mb-1 flex items-center gap-1">
                    <Database className="h-3 w-3" />
                    Источники UID:
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary" className="text-xs">
                      <Zap className="h-3 w-3 mr-1" />
                      Webhook: {stats.sources?.queue_webhook || 0}
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      API recover: {stats.sources?.queue_api_recover || 0}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      Неполные payments: {stats.sources?.payments_incomplete || 0}
                    </Badge>
                  </div>
                </div>
              )}

              {/* Summary stats */}
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="rounded-lg border p-2">
                  <div className="text-lg font-semibold">{stats?.total_candidates || 0}</div>
                  <div className="text-xs text-muted-foreground">UID найдено</div>
                </div>
                <div className="rounded-lg border p-2 bg-blue-50 dark:bg-blue-950/20">
                  <div className="text-lg font-semibold text-blue-600">{stats?.updated || 0}</div>
                  <div className="text-xs text-muted-foreground">Обновлено</div>
                </div>
                <div className="rounded-lg border p-2 bg-green-50 dark:bg-green-950/20">
                  <div className="text-lg font-semibold text-green-600">{stats?.paid_at_fixed || 0}</div>
                  <div className="text-xs text-muted-foreground">paid_at fix</div>
                </div>
                <div className="rounded-lg border p-2 bg-amber-50 dark:bg-amber-950/20">
                  <div className="text-lg font-semibold text-amber-600">{stats?.fetch_errors || 0}</div>
                  <div className="text-xs text-muted-foreground">Ошибки</div>
                </div>
              </div>

              {/* Additional stats */}
              {stats && (stats.already_complete > 0 || stats.created > 0) && (
                <div className="text-xs flex gap-3 text-muted-foreground">
                  {stats.already_complete > 0 && (
                    <span>Уже полные: {stats.already_complete}</span>
                  )}
                  {stats.created > 0 && (
                    <span className="text-green-600">Создано: {stats.created}</span>
                  )}
                </div>
              )}

              {/* Sample updated records */}
              {result.samples?.updated && result.samples.updated.length > 0 && mode === 'preview' && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">
                    Примеры записей к обновлению:
                  </div>
                  <ScrollArea className="h-[80px] rounded-md border">
                    <div className="p-2 space-y-1">
                      {result.samples.updated.map((r, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs py-1 border-b last:border-0">
                          <Check className="h-3 w-3 text-blue-500 flex-shrink-0" />
                          <span className="font-mono truncate max-w-[80px]">{r.uid.substring(0, 8)}...</span>
                          <span className="text-muted-foreground">
                            {r.paid_at_before ? 'обновление' : 'paid_at: null →'}
                          </span>
                          {r.paid_at_after && (
                            <span className="text-green-600 truncate">{r.paid_at_after.substring(0, 10)}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {/* Sample errors */}
              {result.samples?.errors && result.samples.errors.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-amber-600 mb-1">
                    Ошибки fetch:
                  </div>
                  <ScrollArea className="h-[60px] rounded-md border border-amber-200">
                    <div className="p-2 space-y-1">
                      {result.samples.errors.map((r, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs py-1 border-b last:border-0">
                          <AlertCircle className="h-3 w-3 text-amber-500 flex-shrink-0" />
                          <span className="font-mono truncate max-w-[80px]">{r.uid.substring(0, 8)}...</span>
                          <span className="text-muted-foreground truncate">{r.error}</span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {/* Success message */}
              {mode === 'executed' && ((stats?.updated || 0) > 0 || (stats?.created || 0) > 0) && (
                <Alert className="border-green-200 bg-green-50 dark:bg-green-950/20">
                  <Check className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-green-700 dark:text-green-400">
                    Обновлено {stats?.updated || 0} записей, paid_at исправлено: {stats?.paid_at_fixed || 0}
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
          
          {(mode === 'preview' || mode === 'stopped') && result && ((stats?.updated || 0) > 0 || (stats?.created || 0) > 0 || (stats?.total_candidates || 0) > 0) && (
            <Button
              onClick={() => handleSync(false)}
              disabled={isLoading}
            >
              {isLoading ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Database className="h-4 w-4 mr-2" />
              )}
              Восстановить ({(stats?.updated || 0) + (stats?.created || 0) || stats?.total_candidates || 0})
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
