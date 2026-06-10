import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { FileText, Clock, AlertCircle, XCircle, RefreshCw, ExternalLink } from "lucide-react";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type ReceiptStatus = 'available' | 'pending' | 'unavailable' | 'error';
export type ReceiptErrorCode = 
  | 'NO_PROVIDER_ID' 
  | 'PROVIDER_NO_RECEIPT' 
  | 'API_ERROR' 
  | 'NOT_SUCCESSFUL' 
  | 'UNKNOWN';

interface ReceiptStatusBadgeProps {
  receiptUrl?: string | null;
  receiptStatus?: ReceiptStatus;
  receiptErrorCode?: ReceiptErrorCode;
  paymentId: string;
  orderId?: string | null;
  isQueueItem: boolean;
  statusNormalized: string;
  providerUid?: string;
  /** PATCH-LIVE-2: 'stripe' → не зовём bepaid-get-receipt; только открываем receipt_url. */
  provider?: string | null;
  /** Stage 2C: 'payment' | 'refund' — влияет на формулировку tooltip для Stripe. */
  transactionType?: string | null;
  /** Stage 2C: источник document_url (parent_charge_receipt → особый текст). */
  documentSource?: string | null;
  onRefetch?: () => void;
  className?: string;
}


const ErrorMessages: Record<ReceiptErrorCode, string> = {
  NO_PROVIDER_ID: 'Нет UID провайдера',
  PROVIDER_NO_RECEIPT: 'Чек не предусмотрен',
  API_ERROR: 'Ошибка получения',
  NOT_SUCCESSFUL: 'Платеж не успешен',
  UNKNOWN: 'Неизвестная ошибка',
};

export default function ReceiptStatusBadge({
  receiptUrl,
  receiptStatus,
  receiptErrorCode,
  paymentId,
  orderId,
  isQueueItem,
  statusNormalized,
  providerUid,
  provider,
  transactionType,
  documentSource,
  onRefetch,
  className,
}: ReceiptStatusBadgeProps) {
  const [isLoading, setIsLoading] = useState(false);

  const isStripe = (provider ?? '').toLowerCase() === 'stripe';
  const isRefund = (transactionType ?? '').toLowerCase() === 'refund';
  const isParentReceiptFallback = documentSource === 'parent_charge_receipt' || documentSource === 'parent_invoice_hosted';


  // Derive status from available data if not explicitly set
  // PATCH-LIVE-2: для Stripe без receipt_url не маркируем как pending с retry —
  // мы не зовём bepaid-get-receipt; либо чек уже есть, либо помечаем unavailable.
  const derivedStatus: ReceiptStatus =
    receiptStatus ||
    (receiptUrl ? 'available' : (isStripe ? 'unavailable' : 'pending'));
  
  // Handle manual receipt fetch
  const handleFetchReceipt = async () => {
    // PATCH-LIVE-2: Stripe receipt приходит только из webhook materialization,
    // bepaid-get-receipt для Stripe не применим. Безопасный no-op.
    if (isStripe) {
      toast.info("Чек Stripe материализуется автоматически по webhook. Откройте платёж позже.");
      return;
    }
    if (!providerUid) {
      toast.error("Нет UID провайдера для получения чека");
      return;
    }
    
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('bepaid-get-receipt', {
        body: { 
          payment_id: paymentId,
          source: isQueueItem ? 'queue' : 'payments_v2',
        }
      });
      
      if (error) throw error;
      
      if (data?.status === 'available') {
        toast.success("Чек получен");
      } else if (data?.status === 'unavailable') {
        toast.warning(`Чек недоступен: ${ErrorMessages[data.error_code as ReceiptErrorCode] || data.error_code}`);
      } else if (data?.status === 'error') {
        toast.error(`Ошибка: ${data.message || 'Не удалось получить чек'}`);
      }
      
      onRefetch?.();
    } catch (e: any) {
      toast.error(`Ошибка: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };
  
  // Available: show icon with link
  if (derivedStatus === 'available' && receiptUrl) {
    let tooltipText = 'Открыть чек';
    if (isStripe) {
      if (isRefund && isParentReceiptFallback) {
        tooltipText = 'Открыть документ Stripe с информацией о возврате';
      } else if (isRefund) {
        tooltipText = 'Открыть документ возврата Stripe';
      } else {
        tooltipText = 'Открыть документ Stripe';
      }
    }
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" className={cn("h-6 px-1", className)} asChild>
            <a href={receiptUrl} target="_blank" rel="noopener noreferrer">
              <FileText className="h-4 w-4 text-green-600" />
            </a>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <div className="flex items-center gap-1 text-xs">
            <span>{tooltipText}</span>
            <ExternalLink className="h-3 w-3" />
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  
  // Pending: show clock icon with retry option
  if (derivedStatus === 'pending') {
    // Only allow retry if payment is successful and has provider UID
    const canRetry = ['successful', 'succeeded'].includes(statusNormalized) && providerUid;
    
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button 
            variant="ghost" 
            size="sm" 
            className={cn("h-6 px-1", className)}
            disabled={!canRetry || isLoading}
            onClick={canRetry ? handleFetchReceipt : undefined}
          >
            {isLoading ? (
              <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <Clock className="h-4 w-4 text-amber-500" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs">
            <div>Чек ожидается</div>
            {canRetry && <div className="text-muted-foreground">Нажмите для получения</div>}
            {!providerUid && <div className="text-muted-foreground">Нет UID провайдера</div>}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  // Unavailable: show X icon with reason
  if (derivedStatus === 'unavailable') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button 
            variant="ghost" 
            size="sm" 
            className={cn("h-6 px-1 cursor-default", className)}
            disabled
          >
            <XCircle className="h-4 w-4 text-muted-foreground" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs">
            <div>Чек недоступен</div>
            {receiptErrorCode && (
              <div className="text-muted-foreground">
                {ErrorMessages[receiptErrorCode] || receiptErrorCode}
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  // Error: show warning icon with retry
  if (derivedStatus === 'error') {
    const canRetry = ['successful', 'succeeded'].includes(statusNormalized) && providerUid;
    
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button 
            variant="ghost" 
            size="sm" 
            className={cn("h-6 px-1", className)}
            disabled={!canRetry || isLoading}
            onClick={canRetry ? handleFetchReceipt : undefined}
          >
            {isLoading ? (
              <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <AlertCircle className="h-4 w-4 text-destructive" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs">
            <div>Ошибка получения чека</div>
            {receiptErrorCode && (
              <div className="text-muted-foreground">
                {ErrorMessages[receiptErrorCode] || receiptErrorCode}
              </div>
            )}
            {canRetry && <div className="text-muted-foreground">Нажмите для повтора</div>}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  // Fallback
  return <span className="text-muted-foreground text-xs">—</span>;
}
