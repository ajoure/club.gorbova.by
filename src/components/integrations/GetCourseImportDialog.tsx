import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Download, Upload, FileSpreadsheet, AlertTriangle, CheckCircle2, X } from "lucide-react";
import { toast } from "sonner";
// XLSX is imported dynamically to reduce bundle size

interface GetCourseImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceId?: string;
}

interface ParsedDeal {
  id: string | number;
  email: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  cost: number;
  status: string;
  offerName?: string;
  tariffType?: "CHAT" | "FULL" | "BUSINESS";
  createdAt?: string;
  paidAt?: string;
}

interface ImportResult {
  success: boolean;
  result: {
    total_fetched: number;
    profiles_created: number;
    profiles_updated: number;
    orders_created: number;
    orders_skipped: number;
    subscriptions_created: number;
    errors: number;
    details: string[];
  };
}

// Маппинг тарифов по содержимому "Состав заказа"
const TARIFF_MAP: Record<string, { type: "CHAT" | "FULL" | "BUSINESS"; id: string }> = {
  chat: { type: "CHAT", id: "31f75673-a7ae-420a-b5ab-5906e34cbf84" },
  full: { type: "FULL", id: "b276d8a5-8e5f-4876-9f99-36f818722d6c" },
  business: { type: "BUSINESS", id: "7c748940-dcad-4c7c-a92e-76a2344622d3" },
};

// Статусы, которые импортируем
const VALID_STATUSES = ["Завершен", "Активен", "Оплачено", "Завершён"];

const STATUS_LABELS: Record<string, string> = {
  "Завершен": "Завершён",
  "Завершён": "Завершён",
  "Активен": "Активен",
  "Оплачено": "Оплачено",
};

export function GetCourseImportDialog({ open, onOpenChange, instanceId }: GetCourseImportDialogProps) {
  const queryClient = useQueryClient();
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [parsedDeals, setParsedDeals] = useState<ParsedDeal[]>([]);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Определение тарифа по названию оффера
  const detectTariffType = (offerName: string): { type: "CHAT" | "FULL" | "BUSINESS"; id: string } | null => {
    const lower = offerName.toLowerCase();
    if (lower.includes("business")) return TARIFF_MAP.business;
    if (lower.includes("full")) return TARIFF_MAP.full;
    if (lower.includes("chat")) return TARIFF_MAP.chat;
    return null;
  };

  // Парсинг Excel файла
  const parseExcelFile = async (file: File): Promise<ParsedDeal[]> => {
    // Dynamic import of xlsx to reduce bundle size
    const XLSX = await import("xlsx");
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);

    console.log("[Excel Parse] Total rows:", rows.length);
    console.log("[Excel Parse] Sample row:", rows[0]);

    const deals: ParsedDeal[] = [];

    for (const row of rows) {
      const status = row["Статус"] || "";
      
      // Фильтруем только завершённые/активные/оплаченные
      if (!VALID_STATUSES.includes(status)) {
        continue;
      }

      const id = row["ID заказа"] || row["id"] || "";
      const email = (row["Email"] || row["E-mail"] || "").toLowerCase().trim();
      const phone = row["Телефон"] || "";
      const fullName = row["Пользователь"] || "";
      const offerName = row["Состав заказа"] || row["Предложение"] || "";
      const createdAt = row["Дата создания"] || "";
      const paidAt = row["Дата оплаты"] || "";
      
      // Парсим стоимость
      const costRaw = row["Стоимость, BYN"] || row["Стоимость"] || row["Сумма"] || "0";
      const cost = parseFloat(String(costRaw).replace(/[^\d.,]/g, "").replace(",", ".")) || 0;

      // Разделяем ФИО
      const nameParts = String(fullName).trim().split(/\s+/);
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";

      // Определяем тариф
      const tariff = detectTariffType(offerName);

      if (!email) {
        console.log("[Excel Parse] Skipping row without email:", row);
        continue;
      }

      deals.push({
        id,
        email,
        phone,
        firstName,
        lastName,
        fullName,
        cost,
        status,
        offerName,
        tariffType: tariff?.type,
        createdAt,
        paidAt,
      });
    }

    console.log("[Excel Parse] Filtered deals:", deals.length);
    return deals;
  };

  // Обработка загрузки файла
  const handleFileUpload = async (file: File) => {
    setUploadedFile(file);
    setImportResult(null);
    
    try {
      const deals = await parseExcelFile(file);
      setParsedDeals(deals);
      
      if (deals.length === 0) {
        toast.warning("Не найдено подходящих сделок. Проверьте, что файл содержит сделки со статусом 'Завершен', 'Активен' или 'Оплачено'.");
      } else {
        toast.success(`Найдено ${deals.length} сделок для импорта`);
      }
    } catch (error) {
      console.error("Error parsing file:", error);
      toast.error("Ошибка при чтении файла");
      setUploadedFile(null);
      setParsedDeals([]);
    }
  };

  // Drag & Drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith(".xlsx") || file.name.endsWith(".xls") || file.name.endsWith(".csv"))) {
      handleFileUpload(file);
    } else {
      toast.error("Поддерживаются только файлы Excel (.xlsx, .xls) или CSV");
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  // Скачать шаблон
  const downloadTemplate = async () => {
    const headers = [
      "ID заказа",
      "Email",
      "Телефон",
      "Пользователь",
      "Состав заказа",
      "Стоимость, BYN",
      "Статус",
      "Дата создания",
      "Дата оплаты",
    ];
    
    const sampleData = [
      ["123456", "example@mail.ru", "+375291234567", "Иванов Иван", "Клуб: full", "250", "Завершен", "01.01.2025", "01.01.2025"],
    ];

    // Dynamic import of xlsx to reduce bundle size
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleData]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Шаблон");
    XLSX.writeFile(wb, "getcourse_import_template.xlsx");
  };

  // Import mutation
  const importMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("getcourse-import-file", {
        body: {
          deals: parsedDeals.map(d => ({
            id: d.id,
            email: d.email,
            phone: d.phone,
            firstName: d.firstName,
            lastName: d.lastName,
            cost: d.cost,
            status: d.status,
            offerName: d.offerName,
            tariffId: d.tariffType ? TARIFF_MAP[d.tariffType.toLowerCase()]?.id : null,
            createdAt: d.createdAt,
            paidAt: d.paidAt,
          })),
          instance_id: instanceId,
        },
      });
      if (error) throw error;
      return data as ImportResult;
    },
    onSuccess: (data) => {
      setImportResult(data);
      if (data.result.orders_created > 0) {
        queryClient.invalidateQueries({ queryKey: ["orders"] });
        queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
        queryClient.invalidateQueries({ queryKey: ["profiles"] });
      }
      toast.success(`Импортировано ${data.result.orders_created} заказов`);
    },
    onError: (error) => {
      toast.error("Ошибка импорта: " + (error as Error).message);
    },
  });

  const handleClose = () => {
    setUploadedFile(null);
    setParsedDeals([]);
    setImportResult(null);
    onOpenChange(false);
  };

  const clearFile = () => {
    setUploadedFile(null);
    setParsedDeals([]);
    setImportResult(null);
  };

  // Статистика по тарифам
  const statsByTariff = parsedDeals.reduce((acc, d) => {
    const key = d.tariffType || "UNKNOWN";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Импорт сделок из GetCourse</DialogTitle>
          <DialogDescription>
            Загрузите Excel-файл с экспортом сделок из GetCourse
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Drag & Drop зона */}
          {!uploadedFile ? (
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <FileSpreadsheet className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground mb-2">
                Перетащите Excel файл сюда или нажмите для выбора
              </p>
              <p className="text-xs text-muted-foreground mb-4">
                Поддерживаются .xlsx, .xls, .csv
              </p>
              <div className="flex justify-center gap-2">
                <Button variant="outline" size="sm" asChild>
                  <label className="cursor-pointer">
                    <Upload className="h-4 w-4 mr-2" />
                    Выбрать файл
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className="hidden"
                      onChange={handleFileSelect}
                    />
                  </label>
                </Button>
                <Button variant="ghost" size="sm" onClick={downloadTemplate}>
                  <Download className="h-4 w-4 mr-2" />
                  Скачать шаблон
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* Загруженный файл */}
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="h-5 w-5 text-green-600" />
                  <div>
                    <p className="text-sm font-medium">{uploadedFile.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(uploadedFile.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={clearFile}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Результаты парсинга */}
              {parsedDeals.length > 0 && (
                <div className="border rounded-lg p-4 space-y-4 bg-muted/30">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    <span className="font-medium">
                      Найдено сделок: {parsedDeals.length}
                    </span>
                  </div>

                  {/* Разбивка по тарифам */}
                  <div className="space-y-2">
                    <div className="text-sm font-medium">По тарифам:</div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(statsByTariff).map(([tariff, count]) => (
                        <Badge 
                          key={tariff} 
                          variant={tariff === "UNKNOWN" ? "destructive" : "secondary"}
                        >
                          {tariff}: {count}
                        </Badge>
                      ))}
                    </div>
                    {statsByTariff["UNKNOWN"] > 0 && (
                      <p className="text-xs text-destructive">
                        ⚠️ {statsByTariff["UNKNOWN"]} сделок без определённого тарифа будут пропущены
                      </p>
                    )}
                  </div>

                  {/* Примеры сделок */}
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                      Примеры сделок ({Math.min(10, parsedDeals.length)})
                    </summary>
                    <div className="mt-2 space-y-2 max-h-60 overflow-y-auto">
                      {parsedDeals.slice(0, 10).map((deal, i) => (
                        <div key={i} className="text-xs p-2 bg-background rounded border">
                          <div className="font-medium">
                            {deal.fullName || [deal.firstName, deal.lastName].filter(Boolean).join(" ") || "Без имени"}
                          </div>
                          <div className="text-muted-foreground">
                            {deal.email} {deal.phone && `• ${deal.phone}`}
                          </div>
                          <div className="flex justify-between mt-1">
                            <span>{deal.cost} BYN</span>
                            <div className="flex gap-1">
                              {deal.tariffType && (
                                <Badge variant="outline" className="text-xs">
                                  {deal.tariffType}
                                </Badge>
                              )}
                              <Badge variant="secondary" className="text-xs">
                                {STATUS_LABELS[deal.status] || deal.status}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              )}

              {/* Кнопка импорта */}
              {parsedDeals.length > 0 && !importResult && (
                <Button
                  onClick={() => importMutation.mutate()}
                  disabled={importMutation.isPending}
                  className="w-full"
                >
                  {importMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  Импортировать {parsedDeals.filter(d => d.tariffType).length} сделок
                </Button>
              )}
            </>
          )}

          {/* Результаты импорта */}
          {importResult && (
            <div className="border rounded-lg p-4 space-y-3 bg-green-500/10">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <span className="font-medium">Импорт завершён</span>
              </div>
              
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>Обработано сделок: <strong>{importResult.result.total_fetched}</strong></div>
                <div>Создано профилей: <strong>{importResult.result.profiles_created}</strong></div>
                <div>Создано заказов: <strong>{importResult.result.orders_created}</strong></div>
                <div>Пропущено (дубли): <strong>{importResult.result.orders_skipped}</strong></div>
                <div>Создано подписок: <strong>{importResult.result.subscriptions_created}</strong></div>
                {importResult.result.errors > 0 && (
                  <div className="text-destructive">
                    Ошибок: <strong>{importResult.result.errors}</strong>
                  </div>
                )}
              </div>

              {importResult.result.details.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground">
                    Подробности
                  </summary>
                  <div className="mt-2 space-y-1 text-xs max-h-40 overflow-y-auto">
                    {importResult.result.details.map((d, i) => (
                      <div key={i}>{d}</div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          {/* Предупреждение */}
          <div className="flex items-start gap-2 text-sm text-muted-foreground border rounded-lg p-3 bg-yellow-500/10">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-yellow-600" />
            <div>
              <p>При импорте создаются «ghost»-профили для клиентов без аккаунта.</p>
              <p>Когда пользователь зарегистрируется с тем же email, профиль будет автоматически связан.</p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
