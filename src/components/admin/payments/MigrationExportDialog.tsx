import { useState } from "react";
import { Database, Download, Loader2, FileCode, FileText } from "lucide-react";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

interface SchemaSummary {
  tables: number;
  enums: number;
  foreign_keys: number;
  indexes: number;
  rls_tables: number;
  policies: number;
}

interface MigrationExportDialogProps {
  renderTrigger: (onClick: () => void) => React.ReactNode;
}

export function MigrationExportDialog({ renderTrigger }: MigrationExportDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"data" | "schema">("data");
  
  // Data export state
  const [isExportingData, setIsExportingData] = useState(false);
  const [dataSummary, setDataSummary] = useState<ExportSummary | null>(null);
  const [dataDetails, setDataDetails] = useState<ExportDetail[]>([]);
  
  // Schema export state
  const [isExportingSchema, setIsExportingSchema] = useState(false);
  const [schemaSummary, setSchemaSummary] = useState<SchemaSummary | null>(null);
  
  const { toast } = useToast();

  const handleExportData = async () => {
    setIsExportingData(true);
    setDataSummary(null);
    setDataDetails([]);

    try {
      const { data, error } = await supabase.functions.invoke('migrate-data-export');

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error || 'Неизвестная ошибка');
      }

      setDataSummary(data.summary);
      setDataDetails(data.details);

      // Download SQL file
      const blob = new Blob([data.sql], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `data-export-${format(new Date(), 'yyyy-MM-dd-HHmm')}.sql`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Экспорт данных завершён",
        description: `Экспортировано ${data.summary.totalRows} записей из ${data.summary.tablesWithData} таблиц`,
      });
    } catch (e) {
      console.error('Data export error:', e);
      toast({
        title: "Ошибка экспорта данных",
        description: e instanceof Error ? e.message : 'Неизвестная ошибка',
        variant: "destructive",
      });
    } finally {
      setIsExportingData(false);
    }
  };

  const handleExportSchema = async () => {
    setIsExportingSchema(true);
    setSchemaSummary(null);

    try {
      const { data, error } = await supabase.functions.invoke('export-schema');

      if (error) throw error;

      if (data.error) {
        throw new Error(data.error);
      }

      setSchemaSummary(data.summary);

      // Download DDL file
      const blob = new Blob([data.ddl], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `schema-export-${format(new Date(), 'yyyy-MM-dd-HHmm')}.sql`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Экспорт схемы завершён",
        description: `Экспортировано ${data.summary.tables} таблиц, ${data.summary.policies} политик`,
      });
    } catch (e) {
      console.error('Schema export error:', e);
      toast({
        title: "Ошибка экспорта схемы",
        description: e instanceof Error ? e.message : 'Неизвестная ошибка',
        variant: "destructive",
      });
    } finally {
      setIsExportingSchema(false);
    }
  };

  const handleClose = () => {
    if (!isExportingData && !isExportingSchema) {
      setIsOpen(false);
      setDataSummary(null);
      setDataDetails([]);
      setSchemaSummary(null);
    }
  };

  const isExporting = isExportingData || isExportingSchema;

  return (
    <>
      {renderTrigger(() => setIsOpen(true))}

      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Экспорт для миграции
            </DialogTitle>
            <DialogDescription>
              Экспорт схемы (DDL) и данных для переноса в другой проект.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "data" | "schema")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="schema" className="flex items-center gap-2">
                <FileCode className="h-4 w-4" />
                Схема (DDL)
              </TabsTrigger>
              <TabsTrigger value="data" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Данные
              </TabsTrigger>
            </TabsList>

            {/* Schema Export Tab */}
            <TabsContent value="schema" className="space-y-4">
              {!schemaSummary && !isExportingSchema && (
                <div className="text-sm text-muted-foreground space-y-2">
                  <p>Будет экспортирована полная структура базы данных:</p>
                  <ul className="list-disc list-inside text-xs space-y-1">
                    <li>ENUM типы (app_role, order_status, etc.)</li>
                    <li>Все таблицы (CREATE TABLE)</li>
                    <li>Foreign Key constraints</li>
                    <li>Индексы</li>
                    <li>RLS политики</li>
                  </ul>
                  <p className="text-blue-600 dark:text-blue-400">
                    ℹ️ Выполните сначала схему, затем данные.
                  </p>
                </div>
              )}

              {isExportingSchema && (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Экспорт схемы...</p>
                </div>
              )}

              {schemaSummary && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-muted rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold">{schemaSummary.tables}</div>
                      <div className="text-xs text-muted-foreground">Таблиц</div>
                    </div>
                    <div className="bg-muted rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold">{schemaSummary.enums}</div>
                      <div className="text-xs text-muted-foreground">ENUM</div>
                    </div>
                    <div className="bg-muted rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold">{schemaSummary.policies}</div>
                      <div className="text-xs text-muted-foreground">Политик</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-muted rounded-lg p-3 text-center">
                      <div className="text-xl font-bold">{schemaSummary.foreign_keys}</div>
                      <div className="text-xs text-muted-foreground">FK</div>
                    </div>
                    <div className="bg-muted rounded-lg p-3 text-center">
                      <div className="text-xl font-bold">{schemaSummary.indexes}</div>
                      <div className="text-xs text-muted-foreground">Индексов</div>
                    </div>
                    <div className="bg-muted rounded-lg p-3 text-center">
                      <div className="text-xl font-bold">{schemaSummary.rls_tables}</div>
                      <div className="text-xs text-muted-foreground">RLS таблиц</div>
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    SQL файл скачан. Выполните его в новом проекте перед импортом данных.
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={handleClose} disabled={isExporting}>
                  {schemaSummary ? 'Закрыть' : 'Отмена'}
                </Button>
                {!schemaSummary && (
                  <Button onClick={handleExportSchema} disabled={isExporting}>
                    {isExportingSchema ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Экспорт...
                      </>
                    ) : (
                      <>
                        <Download className="h-4 w-4 mr-2" />
                        Экспорт схемы
                      </>
                    )}
                  </Button>
                )}
              </div>
            </TabsContent>

            {/* Data Export Tab */}
            <TabsContent value="data" className="space-y-4">
              {!dataSummary && !isExportingData && (
                <div className="text-sm text-muted-foreground space-y-2">
                  <p>Будут экспортированы данные из всех таблиц:</p>
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

              {isExportingData && (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Экспорт данных...</p>
                </div>
              )}

              {dataSummary && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-muted rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold">{dataSummary.totalTables}</div>
                      <div className="text-xs text-muted-foreground">Таблиц</div>
                    </div>
                    <div className="bg-muted rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold">{dataSummary.tablesWithData}</div>
                      <div className="text-xs text-muted-foreground">С данными</div>
                    </div>
                    <div className="bg-muted rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold">{dataSummary.totalRows.toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground">Записей</div>
                    </div>
                  </div>

                  <ScrollArea className="h-48 border rounded-lg">
                    <div className="p-2 space-y-1">
                      {dataDetails
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
                    SQL файл скачан. Используйте его для импорта после создания схемы.
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={handleClose} disabled={isExporting}>
                  {dataSummary ? 'Закрыть' : 'Отмена'}
                </Button>
                {!dataSummary && (
                  <Button onClick={handleExportData} disabled={isExporting}>
                    {isExportingData ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Экспорт...
                      </>
                    ) : (
                      <>
                        <Download className="h-4 w-4 mr-2" />
                        Экспорт данных
                      </>
                    )}
                  </Button>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
