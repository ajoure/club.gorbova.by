import { useState, useEffect } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { CreditCard, Download, Eye, FileText, Loader2, Mail, Send, FileDown, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { downloadDocumentBlob } from "@/utils/downloadDocumentBlob";
import { InvoiceActPreviewDialog } from "./InvoiceActPreviewDialog";

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
  meta: Record<string, any> | null;
  purchase_snapshot: Record<string, any> | null;
  products_v2: {
    name: string;
    code: string;
  } | null;
  tariffs: {
    name: string;
    code: string;
  } | null;
  payments_v2: Array<{
    id: string;
    status: string;
    provider_payment_id: string | null;
    card_brand: string | null;
    card_last4: string | null;
    receipt_url?: string | null;
    provider_response: {
      transaction?: {
        receipt_url?: string;
      };
    } | null;
  }>;
}

interface OrderListItemProps {
  order: Order;
  onDownloadReceipt: (order: Order) => void;
  onOpenBePaidReceipt: (url: string) => void;
}

export function OrderListItem({ order, onDownloadReceipt, onOpenBePaidReceipt }: OrderListItemProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [generatedDocs, setGeneratedDocs] = useState<any[]>([]);
  
  const payment = order.payments_v2?.[0];
  const isPaid = order.status === "paid" || payment?.status === "succeeded";
  const isFailed = order.status === "failed" || payment?.status === "failed";
  // Priority: receipt_url column > provider_response. bePaid даёт URL и для failed.
  const receiptUrl = payment?.receipt_url || payment?.provider_response?.transaction?.receipt_url;

  // Fetch the most recent generated document for this order (only one)
  useEffect(() => {
    if (isPaid && order.id) {
      supabase
        .from("generated_documents")
        .select("id, document_number, document_type, file_path, created_at, status")
        .eq("order_id", order.id)
        .eq("status", "generated")
        .order("created_at", { ascending: false })
        .limit(1)
        .then(({ data }) => {
          if (data) setGeneratedDocs(data);
        });
    }
  }, [order.id, isPaid]);

  const formatShortDate = (dateString: string) => {
    return format(new Date(dateString), "d MMM yyyy, HH:mm", { locale: ru });
  };

  const openPreview = async () => {
    setPreviewOpen(true);
    setIsLoadingPreview(true);
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Необходима авторизация");
        setPreviewOpen(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke("generate-invoice-act", {
        body: { order_id: order.id },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      setPreviewData({
        documentNumber: data.document.document_number,
        documentDate: new Date().toISOString(),
        executor: data.document.executor,
        client: data.document.client,
        order: data.document.order,
        profile: data.document.profile,
      });
    } catch (error) {
      console.error("Preview error:", error);
      toast.error("Ошибка загрузки документа");
      setPreviewOpen(false);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const sendDocument = async (sendEmail = false, sendTelegram = false) => {
    setIsSending(true);
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Необходима авторизация");
        return;
      }

      const { data, error } = await supabase.functions.invoke("generate-invoice-act", {
        body: { 
          order_id: order.id,
          send_email: sendEmail,
          send_telegram: sendTelegram,
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      const results = data.send_results;
      const messages: string[] = [];
      
      if (sendEmail && results?.email_sent) {
        messages.push("✉️ Отправлено на почту");
      }
      if (sendEmail && results?.email_error) {
        messages.push(`❌ Почта: ${results.email_error}`);
      }
      if (sendTelegram && results?.telegram_sent) {
        messages.push("📱 Отправлено в Telegram");
      }
      if (sendTelegram && results?.telegram_error) {
        messages.push(`❌ Telegram: ${results.telegram_error}`);
      }
      
      if (results?.email_sent || results?.telegram_sent) {
        toast.success(messages.join("\n"));
      } else {
        toast.error(messages.join("\n"));
      }
    } catch (error) {
      console.error("Send error:", error);
      toast.error("Ошибка отправки документа");
    } finally {
      setIsSending(false);
    }
  };

  const downloadGeneratedDoc = async (docId: string) => {
    const r = await downloadDocumentBlob(docId, "pdf");
    if (r.ok === false) toast.error(r.message);
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
    if (order.status === "failed" || payment?.status === "failed") {
      return (
        <Badge variant="destructive" className="text-xs">
          Ошибка
        </Badge>
      );
    }
    // pending/processing/created — это шум, не показываем как полноценный статус.
    // visibleOrders в Purchases уже их фильтрует, но на всякий случай — neutral бейдж.
    const orderStatusMap: Record<string, string> = {
      paid: "Оплачено",
      failed: "Ошибка",
      canceled: "Отменён",
      cancelled: "Отменён",
      refunded: "Возврат",
      expired: "Истёк",
    };
    const label = orderStatusMap[String(order.status).toLowerCase()] ?? "Завершён";
    return <Badge variant="outline" className="text-xs">{label}</Badge>;
  };

  const getProductName = (): string => {
    const productName = order.products_v2?.name || order.products_v2?.code || "";
    const tariffName = order.tariffs?.name || order.purchase_snapshot?.tariff_name || "";
    
    if (productName && tariffName) {
      return `${productName} — ${tariffName}`;
    }
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
    if (order.is_trial && order.final_price === 0) {
      return "Пробный период";
    }
    if (payment?.card_brand && payment?.card_last4) {
      return `${payment.card_brand} **** ${payment.card_last4}`;
    }
    return "Карта";
  };

  return (
    <>
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
        {(isPaid || isFailed) && (
          <div className="flex items-center gap-1 shrink-0">
            {/* BePaid receipt button — для оплаченных и для ошибок (bePaid возвращает URL и для failed) */}
            {receiptUrl && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenBePaidReceipt(receiptUrl)}
                title={isPaid ? "Чек bePaid" : "Чек ошибки bePaid"}
              >
                <ExternalLink className="h-4 w-4" />
                <span className="hidden sm:inline ml-1">Чек</span>
              </Button>
            )}

            {/* Document actions dropdown — только для оплаченных */}
            {isPaid && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" disabled={isGenerating || isSending}>
                    {isGenerating || isSending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <FileText className="h-4 w-4" />
                    )}
                    <span className="hidden sm:inline ml-1">Документы</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onClick={openPreview}>
                    <Eye className="h-4 w-4 mr-2" />
                    Просмотр и скачивание PDF
                  </DropdownMenuItem>

                  <DropdownMenuSeparator />

                  <DropdownMenuItem onClick={() => sendDocument(true, false)}>
                    <Mail className="h-4 w-4 mr-2" />
                    Отправить на почту
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => sendDocument(false, true)}>
                    <Send className="h-4 w-4 mr-2" />
                    Отправить в Telegram
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => sendDocument(true, true)}>
                    <Send className="h-4 w-4 mr-2" />
                    Отправить везде
                  </DropdownMenuItem>

                  {generatedDocs.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-xs text-muted-foreground">
                        Сгенерированные документы
                      </DropdownMenuLabel>
                      {generatedDocs.map((doc) => (
                        <DropdownMenuItem
                          key={doc.id}
                          onClick={() => downloadGeneratedDoc(doc.id)}
                        >
                          <FileDown className="h-4 w-4 mr-2" />
                          {doc.document_number}
                        </DropdownMenuItem>
                      ))}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </div>

      <InvoiceActPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        data={previewData}
        isLoading={isLoadingPreview}
      />
    </>
  );
}
