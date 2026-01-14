import { useState, useEffect } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { CreditCard, Download, Eye, FileText, Loader2, Mail, Send, FileDown, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
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
  // Priority: new receipt_url column > fallback to provider_response
  const receiptUrl = (payment as any)?.receipt_url || payment?.provider_response?.transaction?.receipt_url;

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

  const downloadGeneratedDoc = async (filePath: string, docNumber: string) => {
    try {
      const { data, error } = await supabase.storage
        .from("documents")
        .createSignedUrl(filePath, 3600);
      
      if (error) throw error;
      
      // Open in new tab
      window.open(data.signedUrl, "_blank");
    } catch (error) {
      console.error("Download error:", error);
      toast.error("Ошибка скачивания документа");
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
    if (order.status === "failed" || payment?.status === "failed") {
      return (
        <Badge variant="destructive" className="text-xs">
          Ошибка
        </Badge>
      );
    }
    if (order.status === "pending" || order.status === "processing") {
      return (
        <Badge variant="secondary" className="text-xs">
          В обработке
        </Badge>
      );
    }
    return <Badge variant="outline" className="text-xs">{order.status}</Badge>;
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
      <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-medium text-foreground truncate">{getProductName()}</h3>
            {getStatusBadge()}
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 mt-1 text-sm text-muted-foreground">
            <span>{formatShortDate(order.created_at)}</span>
            <span className="font-medium text-foreground">
              {order.final_price.toFixed(2)} {order.currency}
            </span>
            <span className="flex items-center gap-1">
              <CreditCard className="h-3 w-3" />
              {getPaymentMethod()}
            </span>
          </div>
        </div>
        {isPaid && (
          <div className="flex items-center gap-1 ml-2 flex-shrink-0">
            {/* BePaid receipt button */}
            {receiptUrl && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => onOpenBePaidReceipt(receiptUrl)}
                title="Чек bePaid"
              >
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline ml-1">Чек</span>
              </Button>
            )}
            
            {/* Document actions dropdown */}
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
                
                {/* Generated documents from templates */}
                {generatedDocs.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs text-muted-foreground">
                      Сгенерированные документы
                    </DropdownMenuLabel>
                    {generatedDocs.map((doc) => (
                      <DropdownMenuItem 
                        key={doc.id}
                        onClick={() => downloadGeneratedDoc(doc.file_path, doc.document_number)}
                      >
                        <FileDown className="h-4 w-4 mr-2" />
                        {doc.document_number}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
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
