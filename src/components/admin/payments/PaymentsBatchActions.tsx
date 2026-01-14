import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, X, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { UnifiedPayment } from "@/hooks/useUnifiedPayments";

interface PaymentsBatchActionsProps {
  selectedPayments: UnifiedPayment[];
  onSuccess: () => void;
  onClearSelection: () => void;
}

interface BatchResult {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  errors: string[];
}

export default function PaymentsBatchActions({ selectedPayments, onSuccess, onClearSelection }: PaymentsBatchActionsProps) {
  const [isFetchingReceipts, setIsFetchingReceipts] = useState(false);
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);

  const handleFetchReceipts = async () => {
    // Filter: need order_id and no receipt_url
    const eligiblePayments = selectedPayments.filter(p => p.order_id && !p.receipt_url);
    const skippedNoOrder = selectedPayments.filter(p => !p.order_id).length;
    const skippedHasReceipt = selectedPayments.filter(p => p.order_id && p.receipt_url).length;
    
    if (eligiblePayments.length === 0) {
      toast.info(
        skippedNoOrder > 0 
          ? `Все выбранные платежи либо без сделки (${skippedNoOrder}), либо уже имеют чеки (${skippedHasReceipt})`
          : "Все выбранные платежи уже имеют чеки"
      );
      return;
    }

    // STOP guard: limit 50
    const BATCH_LIMIT = 50;
    const limit = Math.min(eligiblePayments.length, BATCH_LIMIT);
    const toProcess = eligiblePayments.slice(0, limit);
    
    // Notify if limit applied
    if (eligiblePayments.length > BATCH_LIMIT) {
      toast.info(`Будет обработано ${BATCH_LIMIT} из ${eligiblePayments.length} платежей (лимит)`);
    }
    
    setIsFetchingReceipts(true);
    setBatchResult(null);
    
    let success = 0;
    let failed = 0;
    const errors: string[] = [];
    let stopped = false;

    for (let i = 0; i < toProcess.length; i++) {
      const payment = toProcess[i];
      
      try {
        // Call with order_id as per edge function contract
        const { data, error } = await supabase.functions.invoke('bepaid-get-payment-docs', {
          body: { order_id: payment.order_id, force_refresh: true }
        });
        
        if (error) {
          failed++;
          errors.push(`${payment.uid.substring(0, 8)}: ${error.message}`);
        } else if (data?.status === 'failed') {
          failed++;
          errors.push(`${payment.uid.substring(0, 8)}: ${data.error || 'Unknown error'}`);
        } else {
          success++;
        }
        
        // STOP guard: if error rate > 20% after first 10 requests
        if (i >= 9 && failed / (i + 1) > 0.2) {
          stopped = true;
          toast.error(`Остановлено: слишком много ошибок (${Math.round(failed / (i + 1) * 100)}%)`);
          break;
        }
        
        // Delay between requests: 300ms
        if (i < toProcess.length - 1) {
          await new Promise(r => setTimeout(r, 300));
        }
      } catch (e: any) {
        failed++;
        errors.push(`${payment.uid.substring(0, 8)}: ${e.message}`);
      }
    }
    
    const result: BatchResult = {
      total: toProcess.length,
      success,
      failed,
      skipped: skippedNoOrder + skippedHasReceipt + (stopped ? eligiblePayments.length - limit : 0),
      errors: errors.slice(0, 10), // Show first 10 errors
    };
    
    setBatchResult(result);
    setIsFetchingReceipts(false);
    
    if (success > 0) {
      toast.success(`Чеки получены: ${success} из ${toProcess.length}`);
      onSuccess();
    } else if (failed > 0) {
      toast.error(`Ошибки при получении чеков: ${failed}`);
    }
  };

  const closeBatchResult = () => {
    setBatchResult(null);
  };

  return (
    <div className="space-y-2 mb-4">
      <div className="flex items-center justify-between p-3 bg-primary/10 rounded-lg">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{selectedPayments.length} выбрано</Badge>
          <Button variant="ghost" size="sm" onClick={onClearSelection}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleFetchReceipts}
            disabled={isFetchingReceipts}
          >
            {isFetchingReceipts ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <FileText className="h-4 w-4 mr-2" />
            )}
            Получить чеки
          </Button>
        </div>
      </div>
      
      {/* Batch result display */}
      {batchResult && (
        <div className="p-3 bg-muted/50 rounded-lg border">
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium text-sm">Результат операции</span>
            <Button variant="ghost" size="sm" onClick={closeBatchResult}>
              <X className="h-3 w-3" />
            </Button>
          </div>
          <div className="flex gap-4 text-sm">
            <span>Всего: <strong>{batchResult.total}</strong></span>
            <span className="text-green-600">Успешно: <strong>{batchResult.success}</strong></span>
            <span className="text-red-600">Ошибок: <strong>{batchResult.failed}</strong></span>
            {batchResult.skipped > 0 && (
              <span className="text-muted-foreground">Пропущено: <strong>{batchResult.skipped}</strong></span>
            )}
          </div>
          {batchResult.errors.length > 0 && (
            <div className="mt-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-1 mb-1">
                <AlertTriangle className="h-3 w-3 text-amber-500" />
                <span>Первые ошибки:</span>
              </div>
              <ul className="list-disc list-inside space-y-0.5 max-h-24 overflow-auto">
                {batchResult.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
