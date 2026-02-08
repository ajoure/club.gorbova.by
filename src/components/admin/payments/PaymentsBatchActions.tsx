import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, X, Loader2, AlertTriangle, Link2, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { UnifiedPayment } from "@/hooks/useUnifiedPayments";
import { BulkCreateDealsDialog } from "./BulkCreateDealsDialog";

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
  operation: string;
}

export default function PaymentsBatchActions({ selectedPayments, onSuccess, onClearSelection }: PaymentsBatchActionsProps) {
  const [isFetchingReceipts, setIsFetchingReceipts] = useState(false);
  const [isAutoLinking, setIsAutoLinking] = useState(false);
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
  const [createDealsDialogOpen, setCreateDealsDialogOpen] = useState(false);

  // P0-guard: Calculate selected sum with useMemo (PATCH P0.8)
  const selectedSum = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of selectedPayments) {
      const cur = (p.currency || '—').toUpperCase();
      const amt = Number(p.amount || 0);
      map.set(cur, (map.get(cur) || 0) + amt);
    }
    
    if (map.size === 0) return '0,00';
    
    const parts = Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cur, amt]) => 
        `${amt.toLocaleString('ru-RU', { 
          minimumFractionDigits: 2, 
          maximumFractionDigits: 2 
        })} ${cur}`
      );
    return parts.join(' + ');
  }, [selectedPayments]);

  const handleFetchReceipts = async () => {
    // FIX: No longer require order_id - use uid (provider_payment_id) directly
    // Only skip if already has receipt
    const eligiblePayments = selectedPayments.filter(p => !p.receipt_url && p.uid);
    const skippedNoUid = selectedPayments.filter(p => !p.uid).length;
    const skippedHasReceipt = selectedPayments.filter(p => p.receipt_url).length;
    
    if (eligiblePayments.length === 0) {
      toast.info(
        skippedNoUid > 0 
          ? `Все выбранные платежи либо без UID (${skippedNoUid}), либо уже имеют чеки (${skippedHasReceipt})`
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
        // FIX: Call with payment_uid directly (no order_id required)
        const { data, error } = await supabase.functions.invoke('bepaid-get-payment-docs', {
          body: { 
            payment_uid: payment.uid,
            payment_id: payment.rawSource === 'payments_v2' ? payment.id : undefined,
            force_refresh: true 
          }
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
      skipped: skippedNoUid + skippedHasReceipt + (stopped ? eligiblePayments.length - limit : 0),
      errors: errors.slice(0, 10), // Show first 10 errors
      operation: 'receipts',
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

  // Auto-link deals by tracking_id/order_number
  const handleAutoLinkDeals = async () => {
    // Filter: need tracking_id (ORD-...) and no order_id yet, only queue items
    const eligiblePayments = selectedPayments.filter(p => 
      !p.order_id && 
      p.rawSource === 'queue' &&
      p.tracking_id && 
      p.tracking_id.startsWith('ORD-')
    );
    
    const skippedHasOrder = selectedPayments.filter(p => p.order_id).length;
    const skippedNoTracking = selectedPayments.filter(p => !p.order_id && (!p.tracking_id || !p.tracking_id.startsWith('ORD-'))).length;
    
    if (eligiblePayments.length === 0) {
      toast.info(
        `Нет платежей для автосвязывания. Уже связаны: ${skippedHasOrder}, без tracking_id: ${skippedNoTracking}`
      );
      return;
    }

    // STOP guard: limit 100
    const BATCH_LIMIT = 100;
    const limit = Math.min(eligiblePayments.length, BATCH_LIMIT);
    const toProcess = eligiblePayments.slice(0, limit);
    
    if (eligiblePayments.length > BATCH_LIMIT) {
      toast.info(`Будет обработано ${BATCH_LIMIT} из ${eligiblePayments.length} платежей (лимит)`);
    }
    
    setIsAutoLinking(true);
    setBatchResult(null);
    
    let success = 0;
    let failed = 0;
    const errors: string[] = [];
    let stopped = false;

    // Collect all tracking_ids to search for orders
    const trackingIds = toProcess.map(p => p.tracking_id!);
    
    // Fetch orders by order_number matching tracking_ids
    const { data: orders, error: ordersError } = await supabase
      .from('orders_v2')
      .select('id, order_number, profile_id')
      .in('order_number', trackingIds);
    
    if (ordersError) {
      toast.error(`Ошибка поиска сделок: ${ordersError.message}`);
      setIsAutoLinking(false);
      return;
    }
    
    // Create map: order_number -> order
    const ordersMap = new Map((orders || []).map(o => [o.order_number, o]));
    
    for (let i = 0; i < toProcess.length; i++) {
      const payment = toProcess[i];
      const order = ordersMap.get(payment.tracking_id!);
      
      if (!order) {
        // No matching order found - skip
        failed++;
        errors.push(`${payment.uid.substring(0, 8)}: Сделка ${payment.tracking_id} не найдена`);
        continue;
      }
      
      try {
        // Update queue item with matched order (and contact if available)
        const updateData: Record<string, any> = {
          matched_order_id: order.id,
        };
        
        // If order has profile_id, also link contact
        if (order.profile_id) {
          updateData.matched_profile_id = order.profile_id;
        }
        
        const { error: updateError } = await supabase
          .from('payment_reconcile_queue')
          .update(updateData)
          .eq('id', payment.id);
        
        if (updateError) {
          failed++;
          errors.push(`${payment.uid.substring(0, 8)}: ${updateError.message}`);
        } else {
          success++;
        }
        
        // STOP guard: if error rate > 20% after first 10 requests
        if (i >= 9 && failed / (i + 1) > 0.2) {
          stopped = true;
          toast.error(`Остановлено: слишком много ошибок (${Math.round(failed / (i + 1) * 100)}%)`);
          break;
        }
        
        // Small delay to avoid overwhelming
        if (i < toProcess.length - 1 && (i + 1) % 10 === 0) {
          await new Promise(r => setTimeout(r, 100));
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
      skipped: skippedHasOrder + skippedNoTracking + (stopped ? eligiblePayments.length - limit : 0),
      errors: errors.slice(0, 10),
      operation: 'autolink',
    };
    
    setBatchResult(result);
    setIsAutoLinking(false);
    
    if (success > 0) {
      toast.success(`Связано сделок: ${success} из ${toProcess.length}`);
      onSuccess();
    } else if (failed > 0) {
      toast.error(`Ошибки при связывании: ${failed}`);
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
          <span className="text-xs text-muted-foreground">Σ {selectedSum}</span>
          <Button variant="ghost" size="sm" onClick={onClearSelection}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="default" 
            size="sm" 
            onClick={() => setCreateDealsDialogOpen(true)}
            disabled={isAutoLinking || isFetchingReceipts}
          >
            <Plus className="h-4 w-4 mr-2" />
            Автосоздать сделки
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleAutoLinkDeals}
            disabled={isAutoLinking || isFetchingReceipts}
          >
            {isAutoLinking ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Link2 className="h-4 w-4 mr-2" />
            )}
            Автосвязать сделки
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleFetchReceipts}
            disabled={isFetchingReceipts || isAutoLinking}
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

      {/* Bulk Create Deals Dialog */}
      <BulkCreateDealsDialog
        open={createDealsDialogOpen}
        onOpenChange={setCreateDealsDialogOpen}
        selectedPayments={selectedPayments}
        onSuccess={() => {
          setCreateDealsDialogOpen(false);
          onSuccess();
        }}
      />
      
      {/* Batch result display */}
      {batchResult && (
        <div className="p-3 bg-muted/50 rounded-lg border">
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium text-sm">
              Результат: {batchResult.operation === 'receipts' ? 'Получение чеков' : 'Автосвязывание сделок'}
            </span>
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
