import { useState } from "react";
import { Database, Loader2, AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
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
    to_create: number;
    created: number;
    updated: number;
    skipped: number;
    errors: number;
  };
  next_cursor: {
    paid_at: string | null;
    id: string | null;
  } | null;
  samples: Array<{
    queue_id: string;
    stable_uid: string;
    payment_id: string | null;
    result: 'created' | 'updated' | 'skipped' | 'error';
    error?: string;
  }>;
  warnings: string[];
  duration_ms: number;
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
  const [cursor, setCursor] = useState<{ paid_at: string | null; id: string | null } | null>(null);

  const handleRun = async (useCursor: boolean = false) => {
    if (isRunning) return;
    
    const safeLimit = Math.min(Math.max(1, limit), 1000);
    
    setIsRunning(true);
    if (!useCursor) {
      setResult(null);
      setCursor(null);
    }

    try {
      const body: any = {
        dry_run: dryRun,
        limit: safeLimit,
      };

      // Use cursor for pagination if requested
      if (useCursor && cursor) {
        body.cursor_paid_at = cursor.paid_at;
        body.cursor_id = cursor.id;
      }

      const { data, error } = await supabase.functions.invoke(
        'admin-materialize-queue-payments',
        { body }
      );

      if (error) {
        toast.error(`Ошибка: ${error.message}`);
        setResult({
          success: false,
          dry_run: dryRun,
          stats: { scanned: 0, to_create: 0, created: 0, updated: 0, skipped: 0, errors: 1 },
          next_cursor: null,
          samples: [],
          warnings: [],
          duration_ms: 0,
          error: error.message,
        });
        return;
      }

      const typedData = data as MaterializeResult;
      setResult(typedData);

      // Save cursor for next batch
      if (typedData.next_cursor) {
        setCursor(typedData.next_cursor);
      }

      if (typedData.success) {
        if (dryRun) {
          toast.info(`Dry-run: найдено ${typedData.stats.to_create} записей для создания`);
        } else {
          toast.success(`Выполнено: создано ${typedData.stats.created}, обновлено ${typedData.stats.updated}`);
          onComplete?.();
        }
      } else {
        toast.error(`Ошибка: ${typedData.error || 'Неизвестная ошибка'}`);
      }
    } catch (err: any) {
      toast.error(`Ошибка вызова: ${err.message}`);
      setResult({
        success: false,
        dry_run: dryRun,
        stats: { scanned: 0, to_create: 0, created: 0, updated: 0, skipped: 0, errors: 1 },
        next_cursor: null,
        samples: [],
        warnings: [],
        duration_ms: 0,
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
      setCursor(null);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!isRunning) {
      setOpen(newOpen);
      if (!newOpen) {
        setResult(null);
        setCursor(null);
      }
    }
  };

  const getResultBadgeVariant = (resultType: string) => {
    switch (resultType) {
      case 'created': return 'default';
      case 'updated': return 'secondary';
      case 'skipped': return 'outline';
      case 'error': return 'destructive';
      default: return 'outline';
    }
  };

  const hasMoreItems = result?.next_cursor?.paid_at && result?.stats.scanned === limit;

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
            Перенос ТОЛЬКО незаматериализованных completed записей (ANTI-JOIN).
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
                Режим EXECUTE: записи будут созданы в payments_v2. Действие идемпотентно.
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
                  {result.duration_ms > 0 && (
                    <Badge variant="outline" className="ml-auto">
                      {result.duration_ms}ms
                    </Badge>
                  )}
                </div>

                {/* Stats grid - NEW METRICS */}
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div className="bg-background rounded p-2 text-center">
                    <div className="text-muted-foreground text-xs">Scanned</div>
                    <div className="font-mono font-medium">{result.stats.scanned}</div>
                  </div>
                  <div className="bg-background rounded p-2 text-center">
                    <div className="text-muted-foreground text-xs">To Create</div>
                    <div className="font-mono font-medium text-blue-600">{result.stats.to_create}</div>
                  </div>
                  <div className="bg-background rounded p-2 text-center">
                    <div className="text-muted-foreground text-xs">Created</div>
                    <div className="font-mono font-medium text-green-600">{result.stats.created}</div>
                  </div>
                  <div className="bg-background rounded p-2 text-center">
                    <div className="text-muted-foreground text-xs">Updated</div>
                    <div className="font-mono font-medium">{result.stats.updated}</div>
                  </div>
                  <div className="bg-background rounded p-2 text-center">
                    <div className="text-muted-foreground text-xs">Skipped</div>
                    <div className="font-mono font-medium">{result.stats.skipped}</div>
                  </div>
                  <div className="bg-background rounded p-2 text-center">
                    <div className="text-muted-foreground text-xs">Errors</div>
                    <div className={cn("font-mono font-medium", result.stats.errors > 0 && "text-destructive")}>
                      {result.stats.errors}
                    </div>
                  </div>
                </div>

                {/* Next batch indicator */}
                {hasMoreItems && (
                  <Alert>
                    <ChevronRight className="h-4 w-4" />
                    <AlertDescription>
                      Есть ещё записи. Используйте "Следующий батч" для продолжения.
                    </AlertDescription>
                  </Alert>
                )}

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
            {hasMoreItems && (
              <Button
                variant="outline"
                onClick={() => handleRun(true)}
                disabled={isRunning}
                className="gap-2"
              >
                {isRunning && <Loader2 className="h-4 w-4 animate-spin" />}
                <ChevronRight className="h-4 w-4" />
                Следующий батч
              </Button>
            )}
            <Button
              variant={dryRun ? "secondary" : "default"}
              onClick={() => handleRun(false)}
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
