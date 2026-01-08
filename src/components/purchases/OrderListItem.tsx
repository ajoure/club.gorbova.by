import { useState } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { ChevronRight, CheckCircle, XCircle, Clock, CreditCard, Download, FileText, Loader2, Mail, Send, Files } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
  const payment = order.payments_v2?.[0];
  const isPaid = order.status === "paid" || payment?.status === "succeeded";
  const receiptUrl = payment?.provider_response?.transaction?.receipt_url;

  const formatShortDate = (dateString: string) => {
    return format(new Date(dateString), "d MMM yyyy, HH:mm", { locale: ru });
  };

  const generateDocument = async (type: "invoice" | "act", sendEmail = false, sendTelegram = false) => {
    if (sendEmail || sendTelegram) {
      setIsSending(true);
    } else {
      setIsGenerating(true);
    }
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Необходима авторизация");
        return;
      }

      const { data, error } = await supabase.functions.invoke("generate-invoice-act", {
        body: { 
          order_id: order.id, 
          document_type: type,
          send_email: sendEmail,
          send_telegram: sendTelegram,
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      // Show results
      const results = data.send_results;
      
      if (sendEmail || sendTelegram) {
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
      } else {
        // Open document in new window
        const docWindow = window.open("", "_blank");
        if (docWindow) {
          docWindow.document.write(data.document.html);
          docWindow.document.close();
          toast.success(type === "invoice" ? "Счёт сформирован" : "Акт сформирован");
        }
      }
    } catch (error) {
      console.error("Generate error:", error);
      toast.error("Ошибка генерации документа");
    } finally {
      setIsGenerating(false);
      setIsSending(false);
    }
  };

  // Generate all documents (invoice + act)
  const generateAllDocuments = async (sendEmail = false, sendTelegram = false) => {
    if (sendEmail || sendTelegram) {
      setIsSending(true);
    } else {
      setIsGenerating(true);
    }
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Необходима авторизация");
        return;
      }

      const allMessages: string[] = [];
      let hasSuccess = false;

      // Generate invoice
      const { data: invoiceData, error: invoiceError } = await supabase.functions.invoke("generate-invoice-act", {
        body: { 
          order_id: order.id, 
          document_type: "invoice",
          send_email: sendEmail,
          send_telegram: sendTelegram,
        },
      });

      if (invoiceError || !invoiceData?.success) {
        allMessages.push("❌ Счёт: ошибка");
      } else {
        if (sendEmail || sendTelegram) {
          if (invoiceData.send_results?.email_sent) allMessages.push("✉️ Счёт → почта");
          if (invoiceData.send_results?.telegram_sent) allMessages.push("📱 Счёт → Telegram");
          if (invoiceData.send_results?.email_sent || invoiceData.send_results?.telegram_sent) hasSuccess = true;
        } else {
          const docWindow = window.open("", "_blank");
          if (docWindow) {
            docWindow.document.write(invoiceData.document.html);
            docWindow.document.close();
          }
          hasSuccess = true;
        }
      }

      // Generate act
      const { data: actData, error: actError } = await supabase.functions.invoke("generate-invoice-act", {
        body: { 
          order_id: order.id, 
          document_type: "act",
          send_email: sendEmail,
          send_telegram: sendTelegram,
        },
      });

      if (actError || !actData?.success) {
        allMessages.push("❌ Акт: ошибка");
      } else {
        if (sendEmail || sendTelegram) {
          if (actData.send_results?.email_sent) allMessages.push("✉️ Акт → почта");
          if (actData.send_results?.telegram_sent) allMessages.push("📱 Акт → Telegram");
          if (actData.send_results?.email_sent || actData.send_results?.telegram_sent) hasSuccess = true;
        } else {
          const docWindow = window.open("", "_blank");
          if (docWindow) {
            docWindow.document.write(actData.document.html);
            docWindow.document.close();
          }
          hasSuccess = true;
        }
      }

      if (sendEmail || sendTelegram) {
        if (hasSuccess) {
          toast.success(allMessages.join("\n"));
        } else {
          toast.error(allMessages.join("\n"));
        }
      } else {
        if (hasSuccess) {
          toast.success("Документы сформированы");
        } else {
          toast.error("Ошибка формирования документов");
        }
      }
    } catch (error) {
      console.error("Generate all error:", error);
      toast.error("Ошибка генерации документов");
    } finally {
      setIsGenerating(false);
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
          {/* BePaid receipt button - always visible for paid orders with receipt */}
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
          
          {/* Document generation dropdown */}
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
            <DropdownMenuContent align="end" className="w-64">
              {/* View individual documents */}
              <DropdownMenuItem onClick={() => generateDocument("invoice")}>
                <FileText className="h-4 w-4 mr-2" />
                Открыть счёт
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => generateDocument("act")}>
                <FileText className="h-4 w-4 mr-2" />
                Открыть акт
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => generateAllDocuments()}>
                <Files className="h-4 w-4 mr-2" />
                Открыть всё (счёт + акт)
              </DropdownMenuItem>
              
              <DropdownMenuSeparator />
              
              {/* Send all documents */}
              <DropdownMenuItem onClick={() => generateAllDocuments(true, false)}>
                <Mail className="h-4 w-4 mr-2" />
                Отправить всё на почту
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => generateAllDocuments(false, true)}>
                <Send className="h-4 w-4 mr-2" />
                Отправить всё в Telegram
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => generateAllDocuments(true, true)}>
                <Send className="h-4 w-4 mr-2" />
                Отправить всё везде
              </DropdownMenuItem>
              
              <DropdownMenuSeparator />
              
              {/* Individual document sending */}
              <DropdownMenuItem onClick={() => generateDocument("invoice", true, false)}>
                <Mail className="h-4 w-4 mr-2" />
                Счёт → почта
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => generateDocument("act", true, false)}>
                <Mail className="h-4 w-4 mr-2" />
                Акт → почта
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => generateDocument("invoice", false, true)}>
                <Send className="h-4 w-4 mr-2" />
                Счёт → Telegram
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => generateDocument("act", false, true)}>
                <Send className="h-4 w-4 mr-2" />
                Акт → Telegram
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
