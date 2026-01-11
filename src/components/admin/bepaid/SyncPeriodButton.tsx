import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { 
  Download, RefreshCw, CheckCircle, AlertTriangle, XCircle, Loader2
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { DateFilter } from "@/hooks/useBepaidData";

interface SyncPeriodButtonProps {
  dateFilter: DateFilter;
  onSuccess?: () => void;
}

interface SyncStats {
  total_fetched: number;
  matched_by_email: number;
  matched_by_card: number;
  matched_by_name: number;
  not_matched: number;
  skipped_duplicate: number;
  created: number;
  errors: number;
}

interface SyncResult {
  success: boolean;
  dryRun: boolean;
  stats: SyncStats;
  total_results: number;
}

export default function SyncPeriodButton({ dateFilter, onSuccess }: SyncPeriodButtonProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [result, setResult] = useState<SyncResult | null>(null);

  const syncMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("bepaid-full-sync", {
        body: {
          dryRun,
          fromDate: dateFilter.from || "2026-01-01",
          toDate: dateFilter.to || undefined,
        },
      });
      if (error) throw error;
      return data as SyncResult;
    },
    onSuccess: (data) => {
      setResult(data);
      if (!data.dryRun && data.stats.created > 0) {
        toast.success(`Синхронизировано: ${data.stats.created} новых записей`);
        onSuccess?.();
      }
    },
    onError: (error) => {
      toast.error("Ошибка синхронизации: " + (error as Error).message);
    },
  });

  const handleOpen = () => {
    setResult(null);
    setDryRun(true);
    setDialogOpen(true);
  };

  const handleSync = () => {
    syncMutation.mutate();
  };

  return (
    <>
      <Button variant="outline" onClick={handleOpen}>
        <Download className="h-4 w-4 mr-2" />
        Синхронизировать за период
      </Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Синхронизация данных из bePaid
            </DialogTitle>
            <DialogDescription>
              Загрузка транзакций и подписок из bePaid за период с {dateFilter.from} 
              {dateFilter.to ? ` по ${dateFilter.to}` : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Dry run toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div className="space-y-0.5">
                <Label htmlFor="dry-run">Тестовый режим (dry run)</Label>
                <p className="text-xs text-muted-foreground">
                  Только предпросмотр без сохранения в базу
                </p>
              </div>
              <Switch
                id="dry-run"
                checked={dryRun}
                onCheckedChange={setDryRun}
              />
            </div>

            {/* Results */}
            {result && (
              <ScrollArea className="max-h-[300px]">
                <div className="space-y-3">
                  {/* Summary */}
                  <div className="p-3 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-2 mb-2">
                      {result.dryRun ? (
                        <Badge variant="secondary">Предпросмотр</Badge>
                      ) : (
                        <Badge variant="default" className="bg-green-600">Выполнено</Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Всего получено:</span>
                        <span className="font-medium">{result.stats.total_fetched}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Создано:</span>
                        <span className="font-medium text-green-600">{result.stats.created}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Пропущено (дубликаты):</span>
                        <span className="font-medium">{result.stats.skipped_duplicate}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Ошибки:</span>
                        <span className="font-medium text-destructive">{result.stats.errors}</span>
                      </div>
                    </div>
                  </div>

                  {/* Matching stats */}
                  <div className="p-3 rounded-lg border">
                    <p className="text-sm font-medium mb-2">Сопоставление контактов:</p>
                    <div className="space-y-1 text-sm">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        <span>По email: {result.stats.matched_by_email}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-blue-600" />
                        <span>По карте: {result.stats.matched_by_card}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-amber-600" />
                        <span>По имени: {result.stats.matched_by_name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <XCircle className="h-4 w-4 text-muted-foreground" />
                        <span>Не найдено: {result.stats.not_matched}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </ScrollArea>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Закрыть
            </Button>
            <Button 
              onClick={handleSync} 
              disabled={syncMutation.isPending}
              variant={dryRun ? "secondary" : "default"}
            >
              {syncMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Синхронизация...
                </>
              ) : dryRun ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Предпросмотр
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Синхронизировать
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
