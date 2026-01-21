import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Play, AlertTriangle, CheckCircle, XCircle } from "lucide-react";

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
  const [dryRun, setDryRun] = useState(true);
  const [limit, setLimit] = useState(200);
  const [result, setResult] = useState<MaterializeResult | null>(null);
  const [mode, setMode] = useState<'idle' | 'preview' | 'executed'>('idle');

  const handleRun = async () => {
    setIsRunning(true);
    setResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('admin-materialize-queue-payments', {
        body: {
          dry_run: dryRun,
          limit: limit,
        },
      });

      if (error) {
        throw new Error(error.message);
      }

      setResult(data as MaterializeResult);
      setMode(dryRun ? 'preview' : 'executed');

      if (!dryRun && data?.stats) {
        const { created, updated, errors } = data.stats;
        if (created > 0 || updated > 0) {
          toast.success(`Материализовано: ${created} создано, ${updated} обновлено`);
          onComplete?.();
        } else if (errors > 0) {
          toast.error(`Ошибки при материализации: ${errors}`);
        } else {
          toast.info('Нет записей для материализации');
        }
      }
    } catch (e: any) {
      console.error('Materialize error:', e);
      toast.error('Ошибка: ' + e.message);
      setResult({ 
        success: false, 
        error: e.message,
        dry_run: dryRun,
        stats: { scanned: 0, eligible: 0, created: 0, updated: 0, skipped: 0, duplicates: 0, errors: 0 },
        samples: [],
        warnings: [],
      });
    } finally {
      setIsRunning(false);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setResult(null);
    setMode('idle');
    setDryRun(true);
  };

  const getResultBadge = (r: string) => {
    switch (r) {
      case 'created':
        return <Badge variant="default" className="text-xs">Создан</Badge>;
      case 'updated':
        return <Badge variant="secondary" className="text-xs">Обновлён</Badge>;
      case 'duplicate':
        return <Badge variant="outline" className="text-xs">Дубликат</Badge>;
      case 'skipped':
        return <Badge variant="outline" className="text-xs text-muted-foreground">Пропущен</Badge>;
      case 'error':
        return <Badge variant="destructive" className="text-xs">Ошибка</Badge>;
      default:
        return <Badge variant="outline" className="text-xs">{r}</Badge>;
    }
  };

  return (
    <>
      {renderTrigger ? (
        renderTrigger(() => setOpen(true))
      ) : (
        <Button variant="outline" onClick={() => setOpen(true)}>
          Материализовать очередь
        </Button>
      )}

      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Play className="h-5 w-5" />
              Материализация очереди → payments_v2
            </DialogTitle>
            <DialogDescription>
              Перенос завершённых (completed) записей из payment_reconcile_queue в payments_v2 
              с сохранением связей profile_id и order_id.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Controls */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="limit">Лимит записей</Label>
                <Input
                  id="limit"
                  type="number"
                  value={limit}
                  onChange={(e) => setLimit(Math.min(500, Math.max(1, parseInt(e.target.value) || 200)))}
                  min={1}
                  max={500}
                  disabled={isRunning}
                />
                <p className="text-xs text-muted-foreground">Максимум 500</p>
              </div>

              <div className="space-y-2">
                <Label>Режим</Label>
                <div className="flex items-center gap-2 pt-2">
                  <Switch
                    checked={dryRun}
                    onCheckedChange={setDryRun}
                    disabled={isRunning}
                  />
                  <span className="text-sm">
                    {dryRun ? 'Предпросмотр (без изменений)' : 'Выполнение'}
                  </span>
                </div>
              </div>
            </div>

            {/* Warning for execute mode */}
            {!dryRun && (
              <div className="flex items-start gap-2 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                <AlertTriangle className="h-5 w-5 text-orange-600 shrink-0 mt-0.5" />
                <div className="text-sm text-orange-800">
                  <strong>Внимание:</strong> В режиме выполнения записи будут созданы/обновлены в payments_v2.
                  Рекомендуется сначала запустить предпросмотр.
                </div>
              </div>
            )}

            {/* Results */}
            {result && (
              <Card>
                <CardContent className="py-4 space-y-4">
                  {/* Success/Error header */}
                  {result.success ? (
                    <div className="flex items-center gap-2 text-green-700">
                      <CheckCircle className="h-5 w-5" />
                      <span className="font-medium">
                        {result.dry_run ? 'Предпросмотр завершён' : 'Материализация завершена'}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-red-700">
                      <XCircle className="h-5 w-5" />
                      <span className="font-medium">Ошибка: {result.error}</span>
                    </div>
                  )}

                  {/* Stats */}
                  {result.stats && (
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <div className="p-2 bg-muted rounded">
                        <div className="text-muted-foreground">Просканировано</div>
                        <div className="font-bold">{result.stats.scanned}</div>
                      </div>
                      <div className="p-2 bg-muted rounded">
                        <div className="text-muted-foreground">Подходящих</div>
                        <div className="font-bold">{result.stats.eligible}</div>
                      </div>
                      <div className="p-2 bg-green-50 rounded">
                        <div className="text-green-700">Создано</div>
                        <div className="font-bold text-green-700">{result.stats.created}</div>
                      </div>
                      <div className="p-2 bg-blue-50 rounded">
                        <div className="text-blue-700">Обновлено</div>
                        <div className="font-bold text-blue-700">{result.stats.updated}</div>
                      </div>
                      <div className="p-2 bg-gray-50 rounded">
                        <div className="text-gray-600">Дубликаты</div>
                        <div className="font-bold text-gray-600">{result.stats.duplicates}</div>
                      </div>
                      <div className="p-2 bg-red-50 rounded">
                        <div className="text-red-700">Ошибки</div>
                        <div className="font-bold text-red-700">{result.stats.errors}</div>
                      </div>
                    </div>
                  )}

                  {/* Warnings */}
                  {result.warnings && result.warnings.length > 0 && (
                    <div className="space-y-1">
                      {result.warnings.map((w, i) => (
                        <div key={i} className="text-sm text-orange-700 flex items-start gap-1">
                          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                          {w}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Samples */}
                  {result.samples && result.samples.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Примеры ({result.samples.length}):</div>
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {result.samples.map((s, i) => (
                          <div key={i} className="text-xs font-mono p-2 bg-muted rounded flex items-center gap-2">
                            {getResultBadge(s.result)}
                            <span className="truncate">{s.stable_uid}</span>
                            {s.error && <span className="text-red-600">({s.error})</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleClose} disabled={isRunning}>
                Закрыть
              </Button>
              <Button onClick={handleRun} disabled={isRunning}>
                {isRunning ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Выполняется...
                  </>
                ) : dryRun ? (
                  'Предпросмотр'
                ) : (
                  'Выполнить'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
