// ============================================================================
// DealDocumentsCard — Sprint 10
// ----------------------------------------------------------------------------
// Карточка «Документы» для сделки.
// Внутри две подвкладки:
//   • Поля       — orders_v2.meta.document_data в виде формы (read-only MVP).
//   • Документы  — история ai_generated_documents (context_type=order) +
//                  кнопки «Сформировать DOCX» и «Скачать».
//
// Авто-генерация и автоотправка НЕ выполняются — все действия ручные.
// ============================================================================

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  FileText,
  Download,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Loader2,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

interface DealDocumentsCardProps {
  orderId: string;
  /** Snapshot из orders_v2.meta.document_data (если был сделан) */
  documentData: any | null;
}

const FIELD_GROUPS: Array<{ title: string; fields: Array<{ key: string; label: string; format?: (v: any, all?: any) => string }> }> = [
  {
    title: "Шаблон и исполнитель",
    fields: [
      { key: "template_id", label: "Шаблон" },
      { key: "executor_id", label: "Исполнитель" },
    ],
  },
  {
    title: "Услуга",
    fields: [
      { key: "service_name", label: "Название услуги" },
      { key: "service_description", label: "Описание услуги" },
      { key: "unit", label: "Единица" },
    ],
  },
  {
    title: "Стоимость",
    fields: [
      { key: "quantity", label: "Количество" },
      {
        key: "unit_price",
        label: "Цена за единицу",
        format: (v, all) => v != null ? `${v} ${all?.currency || ""}` : "—",
      },
      {
        key: "amount",
        label: "Сумма акта",
        format: (v, all) => v != null ? `${v} ${all?.currency || ""}` : "—",
      },
      { key: "amount_words", label: "Сумма прописью" },
      { key: "currency", label: "Валюта" },
    ],
  },
  {
    title: "Сроки",
    fields: [
      { key: "payment_due_days", label: "Срок оплаты, дней" },
      { key: "execution_days", label: "Срок оказания, дней" },
      { key: "service_period_from", label: "Период с" },
      { key: "service_period_to", label: "Период по" },
      { key: "months_count", label: "Кол-во месяцев" },
    ],
  },
  {
    title: "Расчёты",
    fields: [
      { key: "prepayment_percent", label: "Предоплата, %" },
      { key: "prepayment_amount", label: "Предоплата, сумма" },
      { key: "discount_amount", label: "Скидка, сумма" },
      { key: "first_payment", label: "Первый платёж" },
      { key: "bank_credit_price", label: "Банковский кредит" },
      { key: "final_payment", label: "Итоговый платёж" },
      { key: "comment", label: "Комментарий" },
    ],
  },
];

const TECHNICAL_FIELDS = ["template_id", "executor_id"];

function fmtVal(v: any): string {
  if (v == null || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function DealDocumentsCard({ orderId, documentData }: DealDocumentsCardProps) {
  const qc = useQueryClient();
  const [showTech, setShowTech] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [generating, setGenerating] = useState(false);

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ["deal-documents", orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_generated_documents")
        .select("id, title, template_id, template_name, template_version_id, status, file_path, storage_bucket, created_at, missing_tokens, warnings_snapshot, meta")
        .eq("context_type", "order")
        .eq("context_id", orderId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: defaultTemplate } = useQuery({
    queryKey: ["deal-doc-default-template"],
    queryFn: async () => {
      const { data } = await supabase
        .from("document_templates")
        .select("id, name")
        .eq("is_active", true)
        .order("name")
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !documentData?.template_id,
  });

  const handleRefreshSnapshot = async () => {
    setRefreshing(true);
    try {
      // Force-refresh: clear meta.document_data and re-invoke hook.
      const { data: ord } = await supabase
        .from("orders_v2").select("meta").eq("id", orderId).maybeSingle();
      const newMeta = { ...(ord?.meta as any || {}) };
      delete (newMeta as any).document_data;
      await supabase.from("orders_v2").update({ meta: newMeta }).eq("id", orderId);

      const { error } = await supabase.functions.invoke("canonical-document-payment-hook", {
        body: { order_id: orderId, dry_run: false },
      });
      if (error) throw error;

      await supabase.from("audit_logs").insert({
        action: "document_data.snapshot_refreshed_manually",
        actor_type: "user",
        meta: { order_id: orderId },
      });

      toast.success("Снимок данных обновлён из продукта/кнопки");
      qc.invalidateQueries({ queryKey: ["admin-deals"] });
      qc.invalidateQueries({ queryKey: ["contact-deals"] });
    } catch (e: any) {
      toast.error(`Не удалось обновить: ${e?.message || e}`);
    } finally {
      setRefreshing(false);
      setConfirmOpen(false);
    }
  };

  const handleGenerate = async (templateId?: string) => {
    const tplId = templateId || documentData?.template_id || defaultTemplate?.id;
    if (!tplId) {
      toast.error("Шаблон не выбран. Укажите шаблон в настройках продукта/кнопки.");
      return;
    }
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("canonical-document-generate", {
        body: {
          mode: "generate",
          template_id: tplId,
          context_type: "order",
          context_id: orderId,
        },
      });
      if (error) throw error;
      if (!data?.success) {
        toast.error(`Не удалось сформировать: ${data?.error || "unknown"}`);
        return;
      }
      toast.success(`Документ ${data.document_number}${data.reused ? " (из истории)" : ""}`);
      qc.invalidateQueries({ queryKey: ["deal-documents", orderId] });
    } catch (e: any) {
      toast.error(`Ошибка: ${e?.message || e}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = async (doc: any) => {
    if (!doc.file_path) return;
    const { data } = await supabase.storage
      .from(doc.storage_bucket || "documents")
      .createSignedUrl(doc.file_path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
          <FileText className="w-4 h-4" />
          Документы
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="fields">
          <TabsList>
            <TabsTrigger value="fields">Поля</TabsTrigger>
            <TabsTrigger value="documents">
              Документы{documents.length > 0 ? ` (${documents.length})` : ""}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="fields" className="mt-4 space-y-4">
            {!documentData ? (
              <div className="text-center py-6 space-y-3">
                <p className="text-muted-foreground text-sm">
                  Снимок данных для документа ещё не зафиксирован.
                </p>
                <p className="text-xs text-muted-foreground">
                  Снимок создаётся автоматически после оплаты заказа.
                  Можно создать сейчас на основе текущих настроек продукта/кнопки.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmOpen(true)}
                  disabled={refreshing}
                >
                  {refreshing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  Создать снимок
                </Button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">v{documentData.snapshot_version || "—"}</Badge>
                    {documentData.snapshotted_at && (
                      <span>от {format(new Date(documentData.snapshotted_at), "dd.MM.yyyy HH:mm")}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch id="show-tech" checked={showTech} onCheckedChange={setShowTech} />
                    <Label htmlFor="show-tech" className="text-xs">Технические данные</Label>
                  </div>
                </div>

                {FIELD_GROUPS.map((group) => {
                  const visible = group.fields.filter(f => showTech || !TECHNICAL_FIELDS.includes(f.key));
                  if (visible.length === 0) return null;
                  return (
                    <div key={group.title} className="space-y-1">
                      <div className="text-xs font-medium text-muted-foreground uppercase">{group.title}</div>
                      <div className="rounded-md border divide-y">
                        {visible.map((f) => {
                          const raw = documentData?.[f.key];
                          const display = f.format ? f.format(raw, documentData) : fmtVal(raw);
                          return (
                            <div key={f.key} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                              <span className="text-muted-foreground">{f.label}</span>
                              <span className="font-medium text-right break-all max-w-[60%]">{display}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                <div className="flex items-center justify-between pt-2 border-t">
                  <p className="text-xs text-muted-foreground">
                    Редактирование полей будет добавлено позднее.
                  </p>
                  <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)} disabled={refreshing}>
                    {refreshing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                    Обновить из продукта
                  </Button>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="documents" className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                История сформированных документов по этой сделке.
              </p>
              <Button size="sm" onClick={() => handleGenerate()} disabled={generating}>
                {generating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
                Сформировать DOCX
              </Button>
            </div>

            {isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : documents.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm border rounded-md">
                Документы по этой сделке ещё не формировались.
              </div>
            ) : (
              <div className="space-y-2">
                {documents.map((d: any) => {
                  const check = d.meta?.docx_check;
                  const ok = check ? check.ok : (d.status === "success");
                  return (
                    <div key={d.id} className="rounded-md border p-3 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate">{d.title || d.template_name || "Документ"}</div>
                          <div className="text-xs text-muted-foreground">
                            {format(new Date(d.created_at), "dd.MM.yyyy HH:mm")}
                            {d.template_name ? ` · ${d.template_name}` : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {ok ? (
                            <Badge variant="outline" className="text-green-600 border-green-500/30">
                              <CheckCircle2 className="w-3 h-3 mr-1" /> ok
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-amber-600 border-amber-500/30">
                              <AlertTriangle className="w-3 h-3 mr-1" /> проверить
                            </Badge>
                          )}
                          {d.file_path && (
                            <Button variant="ghost" size="sm" onClick={() => handleDownload(d)}>
                              <Download className="w-4 h-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Перегенерировать"
                            onClick={() => handleGenerate(d.template_id)}
                            disabled={generating}
                          >
                            <RefreshCw className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                      {Array.isArray(d.warnings_snapshot) && d.warnings_snapshot.length > 0 && (
                        <div className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
                          {d.warnings_snapshot.slice(0, 3).join("; ")}
                          {d.warnings_snapshot.length > 3 ? ` (+${d.warnings_snapshot.length - 3})` : ""}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Обновить снимок данных?</AlertDialogTitle>
            <AlertDialogDescription>
              Текущие поля документа будут перезаписаны актуальными значениями из настроек продукта и кнопки оплаты.
              Документ при этом не отправляется и не генерируется.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={refreshing}>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleRefreshSnapshot} disabled={refreshing}>
              {refreshing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Обновить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
