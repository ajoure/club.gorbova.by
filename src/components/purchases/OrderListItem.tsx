import { useState } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { CreditCard, Download, FileText, Loader2, Mail, Send, ExternalLink, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { downloadDocumentBlob } from "@/utils/downloadDocumentBlob";
import { normalizeEdgeFunctionError } from "@/utils/normalizeEdgeFunctionError";
import { useOrderCanonicalDocuments, type CanonicalDocument } from "@/hooks/useOrderCanonicalDocuments";
import {
  hasRealSucceededPayment,
  getValidReceiptUrl,
  isOfferDocumentEnabled,
  type PaymentLike,
} from "@/lib/documents/purchaseDocumentRules";
import { useOrderOfferMeta } from "@/hooks/useOrderOfferMeta";
import { derivePaymentChannel } from "@/utils/derivePaymentChannel";

interface Order {
  id: string;
  order_number: string;
  final_price: number;
  currency: string;
  status: string;
  is_trial: boolean;
  trial_end_at: string | null;
  customer_email: string | null;
  created_at: string;
  offer_id?: string | null;
  tariff_id?: string | null;
  payer_type?: string | null;
  meta: Record<string, any> | null;
  purchase_snapshot: Record<string, any> | null;
  products_v2: { name: string; code: string } | null;
  tariffs: { name: string; code: string } | null;
  payments_v2: Array<{
    id: string;
    status: string;
    provider?: string | null;
    provider_payment_id: string | null;
    card_brand: string | null;
    card_last4: string | null;
    receipt_url?: string | null;
    provider_response: { transaction?: { receipt_url?: string } } | null;
  }>;
}

interface OrderListItemProps {
  order: Order;
  /** Legacy props — игнорируются, оставлены для совместимости. */
  onDownloadReceipt?: (order: Order) => void;
  onOpenBePaidReceipt?: (url: string) => void;
}

export function OrderListItem({ order }: OrderListItemProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const payments = (order.payments_v2 || []) as PaymentLike[];
  const payment = order.payments_v2?.[0];
  const isPaid = order.status === "paid" || payment?.status === "succeeded";
  const isFailed = order.status === "failed" || payment?.status === "failed";

  // PATCH-A: реальный bePaid-платёж (исключая admin/admin_test/manual/virtual/internal_test).
  const hasRealPayment = hasRealSucceededPayment(payments);
  // Валидный чек bePaid — только у реального платежа и при непустом receipt_url.
  const realPayment = payments.find((p) => isPaid && p.status === "succeeded");
  const receiptUrl = hasRealPayment ? getValidReceiptUrl(realPayment) : null;

  // Резолв купленного офера + его document rules.
  const { data: resolvedOffer } = useOrderOfferMeta(order);
  const offerMeta = resolvedOffer?.offer?.meta || null;
  const paymentChannel = derivePaymentChannel(realPayment as any);
  const payerType = (order.payer_type as any) || "individual";
  const docStatus = isOfferDocumentEnabled(offerMeta, { payerType, paymentChannel });

  // SOT: ai_generated_documents (context_type='order', context_id=order.id).
  // Существующие документы можно скачивать ВСЕГДА — даже если правила сейчас не выполняются.
  const { data: docs = [], refetch } = useOrderCanonicalDocuments(order.id);
  const primaryDoc: CanonicalDocument | undefined = docs[0];

  // Кнопка «Сформировать» доступна только при реальном платеже И включённом документе в офере.
  const canGenerateNew = hasRealPayment && docStatus.enabled && !primaryDoc;
  // «Документ не настроен»: generate_act=true, но template_id пуст / не выбран.
  const showNotConfigured = hasRealPayment && !primaryDoc && docStatus.reason === "no_template";

  const formatShortDate = (dateString: string) =>
    format(new Date(dateString), "d MMM yyyy, HH:mm", { locale: ru });

  /** Скачать существующий документ (PDF) — без расхода нового номера. */
  const downloadDoc = async (doc: CanonicalDocument) => {
    const kind = doc.file_mime?.includes("wordprocessingml") || doc.file_name?.toLowerCase().endsWith(".docx")
      ? "docx"
      : "pdf";
    const r = await downloadDocumentBlob(doc.id, kind);
    if (r.ok === false) toast.error(r.message);
  };

  /**
   * Сформировать документ ОДИН РАЗ через canonical-document-generate-strict.
   * idempotency_key внутри функции построен из template_id/payer/order — повторный
   * вызов не создаёт новую запись.
   */
  const generateDoc = async () => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "canonical-document-generate-strict",
        { body: { order_id: order.id, mode: "generate" } },
      );
      if (error) throw new Error(normalizeEdgeFunctionError(error, data));
      if (data?.error) throw new Error(normalizeEdgeFunctionError(null, data));
      toast.success("Документ сформирован");
      await refetch();
    } catch (e: any) {
      console.error("[generateDoc]", e);
      toast.error(e?.message || "Не удалось сформировать документ");
    } finally {
      setIsGenerating(false);
    }
  };

  /**
   * Отправка через canonical-document-send. Idempotent: НЕ создаёт новый номер,
   * шлёт уже существующий PDF из storage. Telegram → sendDocument (PDF файл).
   */
  const sendDoc = async (
    docId: string,
    channels: { email?: boolean; telegram?: boolean },
  ) => {
    setIsSending(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "canonical-document-send",
        {
          body: {
            document_id: docId,
            send_email: !!channels.email,
            send_telegram: !!channels.telegram,
          },
        },
      );
      if (error) throw new Error(normalizeEdgeFunctionError(error, data));
      if (data?.error) throw new Error(normalizeEdgeFunctionError(null, data));

      const r = data?.results || {};
      const msgs: string[] = [];
      if (channels.email) {
        if (r.email_sent) msgs.push("✉️ Отправлено на почту");
        else if (r.email_error) msgs.push(`❌ Почта: ${r.email_error}`);
      }
      if (channels.telegram) {
        if (r.telegram_sent) msgs.push("📱 PDF отправлен в Telegram");
        else if (r.telegram_error) msgs.push(`❌ Telegram: ${r.telegram_error}`);
      }
      if (r.email_sent || r.telegram_sent) toast.success(msgs.join("\n"));
      else toast.error(msgs.join("\n") || "Не удалось отправить");
    } catch (e: any) {
      console.error("[sendDoc]", e);
      toast.error(e?.message || "Ошибка отправки документа");
    } finally {
      setIsSending(false);
    }
  };

  const getStatusBadge = () => {
    if (order.status === "refunded") {
      return (
        <Badge className="text-xs bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
          Возврат
        </Badge>
      );
    }
    if (order.is_trial && isPaid) {
      return (
        <Badge className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
          Триал
        </Badge>
      );
    }
    if (isPaid) {
      return (
        <Badge className="text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
          Оплачено
        </Badge>
      );
    }
    if (isFailed) {
      return (
        <Badge variant="destructive" className="text-xs">
          Ошибка
        </Badge>
      );
    }
    const orderStatusMap: Record<string, string> = {
      paid: "Оплачено",
      failed: "Ошибка",
      canceled: "Отменён",
      cancelled: "Отменён",
      refunded: "Возврат",
      expired: "Истёк",
    };
    const label = orderStatusMap[String(order.status).toLowerCase()] ?? "Завершён";
    return (
      <Badge variant="outline" className="text-xs">
        {label}
      </Badge>
    );
  };

  const getProductName = (): string => {
    const productName = order.products_v2?.name || order.products_v2?.code || "";
    const tariffName = order.tariffs?.name || order.purchase_snapshot?.tariff_name || "";
    if (productName && tariffName) return `${productName} — ${tariffName}`;
    if (productName) return productName;
    if (order.purchase_snapshot?.product_name) {
      const pName = order.purchase_snapshot.product_name;
      const tName = order.purchase_snapshot.tariff_name;
      return tName ? `${pName} — ${tName}` : pName;
    }
    if (order.is_trial) return "Пробный период";
    return order.order_number;
  };

  const getPaymentMethod = () => {
    if (order.is_trial && order.final_price === 0) return "Пробный период";
    if (payment?.card_brand && payment?.card_last4)
      return `${payment.card_brand} **** ${payment.card_last4}`;
    return "Карта";
  };

  return (
    <div className="group flex items-start justify-between gap-3 p-4 sm:p-5 rounded-xl border border-border/60 bg-card hover:border-primary/30 hover:shadow-sm transition-all min-w-0 overflow-hidden">
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-medium text-foreground text-sm sm:text-base break-words leading-snug min-w-0">
            {getProductName()}
          </h3>
          <div className="shrink-0">{getStatusBadge()}</div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm text-muted-foreground">
          <span>{formatShortDate(order.created_at)}</span>
          <span className="font-semibold text-foreground">
            {order.final_price.toFixed(2)} {order.currency}
          </span>
          <span className="flex items-center gap-1">
            <CreditCard className="h-3.5 w-3.5" />
            {getPaymentMethod()}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {/* Чек bePaid — только реальный платёж с валидным receipt_url */}
        {receiptUrl && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.open(receiptUrl, "_blank", "noopener")}
            title="Чек bePaid"
          >
            <ExternalLink className="h-4 w-4" />
            <span className="hidden sm:inline ml-1">Чек</span>
          </Button>
        )}

        {/* Существующий канонический документ — доступен ВСЕГДА, даже если правила сейчас не выполняются */}
        {primaryDoc && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" disabled={isSending}>
                {isSending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
                <span className="hidden sm:inline ml-1">Документы</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {primaryDoc.title || "Документ"}
                {primaryDoc.document_number ? ` № ${primaryDoc.document_number}` : ""}
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => downloadDoc(primaryDoc)}>
                <Download className="h-4 w-4 mr-2" />
                Скачать {primaryDoc.file_mime?.includes("wordprocessingml") ? "DOCX" : "PDF"}
              </DropdownMenuItem>
              {!primaryDoc.file_mime?.includes("wordprocessingml") && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => sendDoc(primaryDoc.id, { email: true })}>
                    <Mail className="h-4 w-4 mr-2" />
                    Отправить на почту
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => sendDoc(primaryDoc.id, { telegram: true })}>
                    <Send className="h-4 w-4 mr-2" />
                    Отправить в Telegram (PDF)
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => sendDoc(primaryDoc.id, { email: true, telegram: true })}
                  >
                    <Send className="h-4 w-4 mr-2" />
                    Отправить везде
                  </DropdownMenuItem>
                </>
              )}
              {docs.length > 1 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    Все документы по заказу
                  </DropdownMenuLabel>
                  {docs.slice(1).map((d) => (
                    <DropdownMenuItem key={d.id} onClick={() => downloadDoc(d)}>
                      <Download className="h-4 w-4 mr-2" />
                      {d.document_number || d.title || d.id.slice(0, 8)}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* «Сформировать» — только реальный платёж + offer.document enabled + документа ещё нет */}
        {canGenerateNew && (
          <Button
            variant="ghost"
            size="sm"
            onClick={generateDoc}
            disabled={isGenerating}
            title="Сформировать документ (присвоит номер)"
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            <span className="hidden sm:inline ml-1">Сформировать</span>
          </Button>
        )}

        {/* «Документ не настроен» — generate_act=true, но template_id пуст */}
        {showNotConfigured && (
          <span className="text-xs text-muted-foreground italic px-2">
            Документ не настроен
          </span>
        )}
      </div>
    </div>
  );
}
