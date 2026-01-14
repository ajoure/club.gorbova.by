import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Trash2, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
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

interface PurgeImportsDialogProps {
  onComplete?: () => void;
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

export default function PurgeImportsDialog({ onComplete }: PurgeImportsDialogProps) {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<PurgeReport | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const handlePurge = async (executeDryRun: boolean) => {
    setIsLoading(true);
    setDryRun(executeDryRun);
    try {
      const { data, error } = await supabase.functions.invoke('admin-purge-imported-transactions', {
        body: {
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          source_filter: 'csv',
          dry_run: executeDryRun,
          limit: 500,
        }
      });

      if (error) throw error;

      if (data?.success && data.report) {
        setReport(data.report);
        
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

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 text-destructive hover:text-destructive">
          <Trash2 className="h-4 w-4" />
          Удалить CSV-импорт
        </Button>
      </DialogTrigger>
      
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Удаление импортированных транзакций
          </DialogTitle>
          <DialogDescription>
            Удаляет транзакции, загруженные через CSV-импорт. Используйте dry-run для предпросмотра.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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
              />
            </div>
          </div>

          {/* Report */}
          {report && (
            <div className="space-y-3">
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
                <div className="rounded-lg border p-2">
                  <div className="text-lg font-semibold">{report.deleted}</div>
                  <div className="text-xs text-muted-foreground">Удалено</div>
                </div>
              </div>

              <div className="text-sm">
                Сумма к удалению: <span className="font-semibold">{formatAmount(report.total_amount)} BYN</span>
              </div>

              {/* Examples */}
              {report.examples.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">Примеры (к удалению):</div>
                  <ScrollArea className="h-[100px] rounded-md border">
                    <div className="p-2 space-y-1">
                      {report.examples.map((r) => (
                        <div key={r.id} className="flex items-center gap-2 text-xs py-1 border-b last:border-0">
                          <CheckCircle className="h-3 w-3 text-green-500 flex-shrink-0" />
                          <span className="font-mono truncate max-w-[80px]">
                            {r.bepaid_uid?.substring(0, 8) || r.id.substring(0, 8)}...
                          </span>
                          <span className="tabular-nums">{formatAmount(r.amount)}</span>
                          <span className="text-muted-foreground">{r.currency}</span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {/* Conflicts */}
              {report.conflicts.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-amber-600 mb-1">Конфликты (не будут удалены):</div>
                  <ScrollArea className="h-[80px] rounded-md border border-amber-200 dark:border-amber-800">
                    <div className="p-2 space-y-1">
                      {report.conflicts.map((r) => (
                        <div key={r.id} className="flex items-center gap-2 text-xs py-1 border-b last:border-0">
                          <XCircle className="h-3 w-3 text-amber-500 flex-shrink-0" />
                          <span className="font-mono truncate max-w-[80px]">
                            {r.bepaid_uid?.substring(0, 8) || r.id.substring(0, 8)}...
                          </span>
                          <Badge variant="outline" className="text-[9px]">
                            {r.conflict_reason || 'CONFLICT'}
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

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Закрыть
          </Button>
          <Button
            variant="secondary"
            onClick={() => handlePurge(true)}
            disabled={isLoading}
          >
            {isLoading && dryRun ? "Проверяю..." : "Dry-run"}
          </Button>
          {report && report.eligible_for_deletion > 0 && (
            <Button
              variant="destructive"
              onClick={() => handlePurge(false)}
              disabled={isLoading}
            >
              {isLoading && !dryRun ? "Удаляю..." : `Удалить (${report.eligible_for_deletion})`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}