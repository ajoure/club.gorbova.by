import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Download, Eye, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

interface GetCourseImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceId?: string;
}

interface PreviewResult {
  success: boolean;
  result: {
    total: number;
    byOffer: Record<string, number>;
    byStatus: Record<string, number>;
    sample: any[];
  };
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

const OFFERS = [
  { id: "6744625", name: "CHAT", tariff: "31f75673-a7ae-420a-b5ab-5906e34cbf84" },
  { id: "6744626", name: "FULL", tariff: "b276d8a5-8e5f-4876-9f99-36f818722d6c" },
  { id: "6744628", name: "BUSINESS", tariff: "7c748940-dcad-4c7c-a92e-76a2344622d3" },
];

const STATUS_LABELS: Record<string, string> = {
  payed: "Оплачено",
  new: "Новый",
  cancelled: "Отменён",
  in_work: "В работе",
  payment_waiting: "Ожидает оплаты",
  part_payed: "Частично оплачен",
};

export function GetCourseImportDialog({ open, onOpenChange, instanceId }: GetCourseImportDialogProps) {
  const queryClient = useQueryClient();
  const [selectedOffers, setSelectedOffers] = useState<string[]>(OFFERS.map(o => o.id));
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // Preview mutation
  const previewMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("getcourse-import-deals", {
        body: {
          action: "preview",
          offer_ids: selectedOffers,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          instance_id: instanceId,
        },
      });
      if (error) throw error;
      return data as PreviewResult;
    },
    onSuccess: (data) => {
      setPreviewResult(data);
      setImportResult(null);
    },
    onError: (error) => {
      toast.error("Ошибка предпросмотра: " + (error as Error).message);
    },
  });

  // Import mutation
  const importMutation = useMutation({
    mutationFn: async (dryRun: boolean) => {
      const { data, error } = await supabase.functions.invoke("getcourse-import-deals", {
        body: {
          action: "import",
          offer_ids: selectedOffers,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          instance_id: instanceId,
          dry_run: dryRun,
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

  const handleOfferToggle = (offerId: string) => {
    setSelectedOffers(prev => 
      prev.includes(offerId) 
        ? prev.filter(id => id !== offerId)
        : [...prev, offerId]
    );
  };

  const handleClose = () => {
    setPreviewResult(null);
    setImportResult(null);
    onOpenChange(false);
  };

  const isLoading = previewMutation.isPending || importMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Импорт сделок из GetCourse</DialogTitle>
          <DialogDescription>
            Импортируйте исторические данные о покупках клуба из GetCourse
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Выбор офферов */}
          <div className="space-y-3">
            <Label>Офферы для импорта</Label>
            <div className="flex flex-wrap gap-3">
              {OFFERS.map((offer) => (
                <label 
                  key={offer.id}
                  className="flex items-center gap-2 px-3 py-2 border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
                >
                  <Checkbox
                    checked={selectedOffers.includes(offer.id)}
                    onCheckedChange={() => handleOfferToggle(offer.id)}
                  />
                  <span>{offer.name}</span>
                  <Badge variant="outline" className="text-xs">
                    {offer.id}
                  </Badge>
                </label>
              ))}
            </div>
          </div>

          {/* Фильтр по датам */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Дата от</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                placeholder="Начало периода"
              />
            </div>
            <div className="space-y-2">
              <Label>Дата до</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                placeholder="Конец периода"
              />
            </div>
          </div>

          {/* Кнопки действий */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => previewMutation.mutate()}
              disabled={isLoading || selectedOffers.length === 0}
            >
              {previewMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Eye className="h-4 w-4 mr-2" />
              )}
              Предпросмотр
            </Button>
            <Button
              onClick={() => importMutation.mutate(false)}
              disabled={isLoading || selectedOffers.length === 0}
            >
              {importMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              Импортировать
            </Button>
          </div>

          {/* Результаты предпросмотра */}
          {previewResult && (
            <div className="border rounded-lg p-4 space-y-4 bg-muted/30">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <span className="font-medium">
                  Найдено сделок: {previewResult.result?.total || 0}
                </span>
              </div>
              
              {/* Разбивка по офферам */}
              {previewResult.result?.byOffer && (
                <div className="space-y-2">
                  <div className="text-sm font-medium">По офферам:</div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(previewResult.result.byOffer).map(([offerId, count]) => (
                      <Badge key={offerId} variant="secondary">
                        {OFFERS.find(o => o.id === offerId)?.name || offerId}: {count}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Разбивка по статусам */}
              {previewResult.result?.byStatus && (
                <div className="space-y-2">
                  <div className="text-sm font-medium">По статусам:</div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(previewResult.result.byStatus).map(([status, count]) => (
                      <Badge key={status} variant="outline">
                        {STATUS_LABELS[status] || status}: {count}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Пример данных */}
              {previewResult.result?.sample && previewResult.result.sample.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    Примеры сделок ({previewResult.result.sample.length})
                  </summary>
                  <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                    {previewResult.result.sample.map((deal, i) => (
                      <div key={i} className="text-xs p-2 bg-background rounded">
                        {deal.email} - {deal.cost} BYN - {STATUS_LABELS[deal.status] || deal.status}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          {/* Результаты импорта */}
          {importResult && (
            <div className="border rounded-lg p-4 space-y-3 bg-green-500/10">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <span className="font-medium">Импорт завершён</span>
              </div>
              
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>Получено сделок: <strong>{importResult.result.total_fetched}</strong></div>
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
                  <div className="mt-2 space-y-1 text-xs">
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
