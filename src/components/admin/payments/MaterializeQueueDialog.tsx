import { useState } from "react";
import { Database, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface MaterializeQueueDialogProps {
  onComplete?: () => void;
  renderTrigger?: (onClick: () => void) => React.ReactNode;
}

interface MaterializeResult {
  success: boolean;
  dry_run: boolean;
  stats: {
    scanned: number;
    eligible: number;
    created: number;
    updated: number;
    skipped: number;
    duplicates: number;
    errors: number;
  };
  samples: Array<{
    queue_id: string;
    stable_uid: string;
    payment_id: string | null;
    result: 'created' | 'updated' | 'skipped' | 'duplicate' | 'error';
    error?: string;
  }>;
  warnings: string[];
  error?: string;
}

export default function MaterializeQueueDialog({
  onComplete,
  renderTrigger,
}: MaterializeQueueDialogProps) {
  const [open, setOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [limit, setLimit] = useState(200);
  const [dryRun, setDryRun] = useState(true);
  const [result, setResult] = useState<MaterializeResult | null>(null);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);

  const handleRun = async () => {
    if (isRunning) return;
    
    // Validate limit
    const safeLimit = Math.min(Math.max(1, limit), 1000);
    
    setIsRunning(true);
    setResult(null);
    setStartTime(Date.now());
    setDuration(null);

    try {
      const { data, error } = await supabase.functions.invoke(
        'admin-materialize-queue-payments',
        {
          body: {
            dry_run: dryRun,
            limit: safeLimit,
          },
        }
      );

      const endTime = Date.now();
      setDuration(endTime - (startTime || endTime));

      if (error) {
        toast.error(`Ошибка: ${error.message}`);
        setResult({
          success: false,
          dry_run: dryRun,
          stats: { scanned: 0, eligible: 0, created: 0, updated: 0, skipped: 0, duplicates: 0, errors: 1 },
          samples: [],
          warnings: [],
          error: error.message,
        });
        return;
      }

      setResult(data as MaterializeResult);

      if (data.success) {
        if (dryRun) {
          toast.info(`Dry-run завершён: ${data.stats.eligible} eligible, ${data.stats.created} к созданию`);
        } else {
          toast.success(`Выполнено: создано ${data.stats.created}, обновлено ${data.stats.updated}, дублей ${data.stats.duplicates}`);
          onComplete?.();
        }
      } else {
        toast.error(`Ошибка: ${data.error || 'Неизвестная ошибка'}`);
      }
    } catch (err: any) {
      toast.error(`Ошибка вызова: ${err.message}`);
      setResult({
        success: false,
        dry_run: dryRun,
        stats: { scanned: 0, eligible: 0, created: 0, updated: 0, skipped: 0, duplicates: 0, errors: 1 },
        samples: [],
        warnings: [],
        error: err.message,
      });
    } finally {
      setIsRunning(false);
    }
  };

  const handleClose = () => {
    if (!isRunning) {
      setOpen(false);
      setResult(null);
      setDuration(null);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!isRunning) {
      setOpen(newOpen);
      if (!newOpen) {
        setResult(null);
        setDuration(null);
      }
    }
  };

  const getResultBadgeVariant = (resultType: string) => {
    switch (resultType) {
      case 'created': return 'default';
      case 'updated': return 'secondary';
      case 'duplicate': return 'outline';
      case 'skipped': return 'outline';
      case 'error': return 'destructive';
      default: return 'outline';
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {renderTrigger ? (
          renderTrigger(() => setOpen(true))
        ) : (
          <Button variant="outline" size="sm" className="gap-2">
            <Database className="h-4 w-4" />
            Очередь → payments_v2
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Материализация очереди → payments_v2
          </DialogTitle>
          <DialogDescription>
            Перенос completed записей из payment_reconcile_queue в payments_v2 (идемпотентно).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
          {/* Controls */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="limit">Лимит (1-1000)</Label>
              <Input
                id="limit"
                type="number"
                min={1}
                max={1000}
                value={limit}
                onChange={(e) => setLimit(Math.min(1000, Math.max(1, parseInt(e.target.value) || 200)))}
                disabled={isRunning}
              />
            </div>
            <div className="space-y-2">
              <Label>Режим</Label>
              <div className="flex items-center gap-2 h-10">
                <Switch
                  checked={dryRun}
                  onCheckedChange={setDryRun}
                  disabled={isRunning}
                />
                <span className="text-sm">
                  {dryRun ? 'Dry-run (предпросмотр)' : 'Execute (реальное выполнение)'}
                </span>
              </div>
            </div>
          </div>

          {/* Warning for execute mode */}
          {!dryRun && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Режим EXECUTE: записи будут созданы/обновлены в payments_v2. Действие идемпотентно.
              </AlertDescription>
            </Alert>
          )}

          {/* Result display */}
          {result && (
            <ScrollArea className="flex-1 border rounded-lg p-4 bg-muted/30">
              <div className="space-y-4">
                {/* Status header */}
                <div className="flex items-center gap-2">
                  {result.success ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                  )}
                  <span className="font-medium">
                    {result.dry_run ? 'Dry-run' : 'Execute'} — {result.success ? 'Успешно' : 'Ошибка'}
                  </span>
                  {duration && (
                    <Badge variant="outline" className="ml-auto">
                      {duration}ms
                    </Badge>
                  )}
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-4 gap-2 text-sm">
                  <div className="bg-background rounded p-2 text-center">
                    <div className="text-muted-foreground text-xs">Scanned</div>
                    <div className="font-mono font-medium">{result.stats.scanned}</div>
                  </div>
                  <div className="bg-background rounded p-2 text-center">
                    <div className="text-muted-foreground text-xs">Eligible</div>
                    <div className="font-mono font-medium">{result.stats.eligible}</div>
                  </div>
                  <div className="bg-background rounded p-2 text-center">
                    <div className="text-muted-foreground text-xs">Created</div>
                    <div className="font-mono font-medium text-green-600">{result.stats.created}</div>
                  </div>
                  <div className="bg-background rounded p-2 text-center">
                    <div className="text-muted-foreground text-xs">Updated</div>
                    <div className="font-mono font-medium text-blue-600">{result.stats.updated}</div>
                  </div>
                  <div className="bg-background rounded p-2 text-center">
                    <div className="text-muted-foreground text-xs">Skipped</div>
                    <div className="font-mono font-medium">{result.stats.skipped}</div>
                  </div>
                  <div className="bg-background rounded p-2 text-center">
                    <div className="text-muted-foreground text-xs">Duplicates</div>
                    <div className="font-mono font-medium text-orange-600">{result.stats.duplicates}</div>
                  </div>
                  <div className="bg-background rounded p-2 text-center col-span-2">
                    <div className="text-muted-foreground text-xs">Errors</div>
                    <div className={cn("font-mono font-medium", result.stats.errors > 0 && "text-destructive")}>
                      {result.stats.errors}
                    </div>
                  </div>
                </div>

                {/* Warnings */}
                {result.warnings.length > 0 && (
                  <div className="space-y-1">
                    {result.warnings.map((warning, i) => (
                      <Alert key={i} variant="destructive" className="py-2">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription className="text-xs">{warning}</AlertDescription>
                      </Alert>
                    ))}
                  </div>
                )}

                {/* Error message */}
                {result.error && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>{result.error}</AlertDescription>
                  </Alert>
                )}

                {/* Samples */}
                {result.samples.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">Примеры ({result.samples.length}):</div>
                    <div className="space-y-1">
                      {result.samples.map((sample, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs bg-background rounded p-2">
                          <Badge variant={getResultBadgeVariant(sample.result)} className="text-xs">
                            {sample.result}
                          </Badge>
                          <span className="font-mono truncate flex-1" title={sample.stable_uid}>
                            {sample.stable_uid.slice(0, 20)}...
                          </span>
                          {sample.error && (
                            <span className="text-destructive truncate" title={sample.error}>
                              {sample.error.slice(0, 30)}...
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}

          {/* Action buttons */}
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" onClick={handleClose} disabled={isRunning}>
              Закрыть
            </Button>
            <Button
              variant={dryRun ? "secondary" : "default"}
              onClick={handleRun}
              disabled={isRunning}
              className="gap-2"
            >
              {isRunning && <Loader2 className="h-4 w-4 animate-spin" />}
              {dryRun ? 'Предпросмотр (Dry-run)' : 'Выполнить'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
