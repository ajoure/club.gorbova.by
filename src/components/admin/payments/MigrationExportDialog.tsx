import { useState } from "react";
import { Database, Download, Loader2 } from "lucide-react";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ExportSummary {
  totalTables: number;
  tablesWithData: number;
  totalRows: number;
}

interface ExportDetail {
  table: string;
  count: number;
  error?: string;
}

interface MigrationExportDialogProps {
  renderTrigger: (onClick: () => void) => React.ReactNode;
}

export function MigrationExportDialog({ renderTrigger }: MigrationExportDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [summary, setSummary] = useState<ExportSummary | null>(null);
  const [details, setDetails] = useState<ExportDetail[]>([]);
  const { toast } = useToast();

  const handleExport = async () => {
    setIsExporting(true);
    setSummary(null);
    setDetails([]);

    try {
      const { data, error } = await supabase.functions.invoke('migrate-data-export');

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error || 'Неизвестная ошибка');
      }

      setSummary(data.summary);
      setDetails(data.details);

      // Download SQL file
      const blob = new Blob([data.sql], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `migration-export-${format(new Date(), 'yyyy-MM-dd-HHmm')}.sql`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Экспорт завершён",
        description: `Экспортировано ${data.summary.totalRows} записей из ${data.summary.tablesWithData} таблиц`,
      });
    } catch (e) {
      console.error('Export error:', e);
      toast({
        title: "Ошибка экспорта",
        description: e instanceof Error ? e.message : 'Неизвестная ошибка',
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleClose = () => {
    if (!isExporting) {
      setIsOpen(false);
      setSummary(null);
      setDetails([]);
    }
  };

  return (
    <>
      {renderTrigger(() => setIsOpen(true))}

      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Экспорт данных для миграции
            </DialogTitle>
            <DialogDescription>
              Экспорт всех данных из базы в SQL файл для переноса в другой проект.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {!summary && !isExporting && (
              <div className="text-sm text-muted-foreground space-y-2">
                <p>Будут экспортированы данные из следующих таблиц:</p>
                <ul className="list-disc list-inside text-xs space-y-1 max-h-32 overflow-y-auto">
                  <li>Пользователи (profiles)</li>
                  <li>Роли и права доступа</li>
                  <li>Продукты и тарифы</li>
                  <li>Заказы и платежи</li>
                  <li>Подписки и права доступа</li>
                  <li>Шаблоны документов</li>
                  <li>Telegram интеграции</li>
                  <li>И другие...</li>
                </ul>
                <p className="text-amber-600 dark:text-amber-400">
                  ⚠️ Auth Users (логины/пароли) не экспортируются — это ограничение системы.
                </p>
              </div>
            )}

            {isExporting && (
              <div className="flex flex-col items-center justify-center py-8 gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Экспорт данных...</p>
              </div>
            )}

            {summary && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-muted rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold">{summary.totalTables}</div>
                    <div className="text-xs text-muted-foreground">Таблиц</div>
                  </div>
                  <div className="bg-muted rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold">{summary.tablesWithData}</div>
                    <div className="text-xs text-muted-foreground">С данными</div>
                  </div>
                  <div className="bg-muted rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold">{summary.totalRows.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground">Записей</div>
                  </div>
                </div>

                <ScrollArea className="h-48 border rounded-lg">
                  <div className="p-2 space-y-1">
                    {details
                      .filter(d => d.count > 0 || d.error)
                      .map((detail) => (
                        <div
                          key={detail.table}
                          className="flex justify-between items-center text-xs py-1 px-2 rounded hover:bg-muted"
                        >
                          <span className="font-mono">{detail.table}</span>
                          {detail.error ? (
                            <span className="text-destructive">{detail.error}</span>
                          ) : (
                            <span className="text-muted-foreground">{detail.count} записей</span>
                          )}
                        </div>
                      ))}
                  </div>
                </ScrollArea>

                <p className="text-xs text-muted-foreground">
                  SQL файл скачан. Используйте его для импорта в новый проект.
                </p>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={handleClose} disabled={isExporting}>
              {summary ? 'Закрыть' : 'Отмена'}
            </Button>
            {!summary && (
              <Button onClick={handleExport} disabled={isExporting}>
                {isExporting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Экспорт...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    Начать экспорт
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
