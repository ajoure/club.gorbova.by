import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { UnifiedPayment } from "@/hooks/useUnifiedPayments";

interface PaymentsBatchActionsProps {
  selectedPayments: UnifiedPayment[];
  onSuccess: () => void;
  onClearSelection: () => void;
}

export default function PaymentsBatchActions({ selectedPayments, onSuccess, onClearSelection }: PaymentsBatchActionsProps) {
  const [isFetchingReceipts, setIsFetchingReceipts] = useState(false);

  const handleFetchReceipts = async () => {
    const paymentsWithoutReceipt = selectedPayments.filter(p => !p.receipt_url && p.source === 'payments_v2');
    if (paymentsWithoutReceipt.length === 0) {
      toast.info("Все выбранные платежи уже имеют чеки");
      return;
    }

    const limit = Math.min(paymentsWithoutReceipt.length, 50);
    setIsFetchingReceipts(true);
    
    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    for (let i = 0; i < limit; i++) {
      const payment = paymentsWithoutReceipt[i];
      try {
        const { error } = await supabase.functions.invoke('bepaid-get-payment-docs', {
          body: { paymentId: payment.id }
        });
        if (error) {
          failed++;
          errors.push(`${payment.uid}: ${error.message}`);
        } else {
          success++;
        }
        
        // Stop if error rate > 20% after first 10
        if (i >= 10 && failed / (i + 1) > 0.2) {
          toast.error("Остановлено: слишком много ошибок");
          break;
        }
        
        // Delay between requests
        await new Promise(r => setTimeout(r, 300));
      } catch (e: any) {
        failed++;
        errors.push(`${payment.uid}: ${e.message}`);
      }
    }
    
    setIsFetchingReceipts(false);
    toast.success(`Чеки: ${success} успешно, ${failed} ошибок`);
    onSuccess();
  };

  return (
    <div className="flex items-center justify-between p-3 bg-primary/10 rounded-lg mb-4">
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
          {isFetchingReceipts ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileText className="h-4 w-4 mr-2" />}
          Получить чеки
        </Button>
      </div>
    </div>
  );
}
