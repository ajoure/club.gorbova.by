import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { toast } from "sonner";
import { useFormsHubData, DEFAULT_FILTERS, type FormsHubFilters, type FormsSourceType } from "@/hooks/useFormsHubData";
import { FormsHubFiltersPanel } from "./FormsHubFilters";
import { exportToExcel, exportToCSV, type ExportColumn } from "@/utils/exportTableData";
import { format } from "date-fns";
import type { FormsHubRow } from "@/hooks/useFormsHubData";

const SOURCE_LABELS: Record<FormsSourceType, string> = {
  site_form: "Анкета сайта",
  preorder: "Предзапись",
  training: "Обучение",
};

const exportColumns: ExportColumn<FormsHubRow>[] = [
  { header: "Клиент", getValue: (r) => r.client_name },
  { header: "Email", getValue: (r) => r.client_email },
  { header: "Телефон", getValue: (r) => r.client_phone },
  { header: "Тип", getValue: (r) => SOURCE_LABELS[r.source_type] },
  { header: "Продукт", getValue: (r) => r.product_title },
  { header: "Источник", getValue: (r) => r.source_entity },
  { header: "Дата", getValue: (r) => r.created_at ? format(new Date(r.created_at), "dd.MM.yyyy HH:mm") : "" },
  { header: "Статус", getValue: (r) => r.status },
  { header: "Сделка", getValue: (r) => r.has_deal ? "Да" : "Нет" },
  { header: "Аккаунт", getValue: (r) => r.has_account ? "Да" : "Нет" },
];

/**
 * Export tab — uses exportMode to fetch ALL server-filtered records without pagination.
 */
export function FormsExportTabContent() {
  const [filters, setFilters] = useState<FormsHubFilters>(DEFAULT_FILTERS);
  const [exportFormat, setExportFormat] = useState<"xlsx" | "csv">("xlsx");
  const { data, isLoading } = useFormsHubData(filters, undefined, { page: 1, pageSize: 50 }, { exportMode: true });

  const rows = data?.rows;
  const totalCount = data?.totalCount ?? 0;

  const handleExport = async () => {
    if (!rows || rows.length === 0) {
      toast.error("Нет данных для экспорта");
      return;
    }

    const filename = `ankety_${format(new Date(), "yyyy-MM-dd")}`;

    try {
      if (exportFormat === "xlsx") {
        await exportToExcel(rows, exportColumns, `${filename}.xlsx`);
      } else {
        exportToCSV(rows, exportColumns, `${filename}.csv`);
      }
      toast.success(`Экспортировано ${rows.length} записей`);
    } catch (e: any) {
      toast.error(e.message || "Ошибка экспорта");
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <FormsHubFiltersPanel filters={filters} onChange={setFilters} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Download className="h-4 w-4" />
            Экспорт данных
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Select value={exportFormat} onValueChange={(v) => setExportFormat(v as "xlsx" | "csv")}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="xlsx">
                  <span className="flex items-center gap-2"><FileSpreadsheet className="h-3.5 w-3.5" /> Excel (.xlsx)</span>
                </SelectItem>
                <SelectItem value="csv">
                  <span className="flex items-center gap-2"><FileText className="h-3.5 w-3.5" /> CSV (.csv)</span>
                </SelectItem>
              </SelectContent>
            </Select>

            <Button onClick={handleExport} disabled={isLoading || !rows?.length}>
              <Download className="h-4 w-4 mr-2" />
              Экспортировать {totalCount ? `(${totalCount})` : ""}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Экспорт применяет текущие фильтры. Выберите нужные параметры выше.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
