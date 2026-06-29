import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Loader2 } from "lucide-react";
import { CreateDealFromPaymentDialog } from "./CreateDealFromPaymentDialog";
import { DealPickerDialog, type PickedDeal } from "@/components/admin/shared/pickers/DealPickerDialog";

interface LinkDealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentId: string;
  rawSource: 'queue' | 'payments_v2';
  amount?: number;
  currency?: string;
  paidAt?: string;
  profileId?: string | null;
  transactionType?: string;
  onSuccess: () => void;
}

/**
 * Wrapper around shared DealPickerDialog that preserves the payment-linking write path:
 *   queue → payment_reconcile_queue.matched_order_id (+ matched_profile_id)
 *   payments_v2 → payments_v2.order_id (+ profile_id/user_id when present on deal)
 * Adds the payment-only "Create deal" CTA in footer/empty-state slots.
 */
export function LinkDealDialog({
  open,
  onOpenChange,
  paymentId,
  rawSource,
  amount,
  currency,
  paidAt,
  profileId,
  transactionType,
  onSuccess,
}: LinkDealDialogProps) {
  const isRefund = transactionType === 'Возврат средств' || transactionType === 'refund';
  const [saving, setSaving] = useState(false);
  const [createDealOpen, setCreateDealOpen] = useState(false);
  const queryClient = useQueryClient();

  const handleLink = async (selected: PickedDeal) => {
    setSaving(true);
    try {
      if (rawSource === 'queue') {
        const updateData: Record<string, any> = { matched_order_id: selected.id };
        if (selected.profile_id) updateData.matched_profile_id = selected.profile_id;
        const { error } = await supabase
          .from("payment_reconcile_queue")
          .update(updateData as any)
          .eq("id", paymentId);
        if (error) throw error;
      } else {
        const updateData: Record<string, any> = { order_id: selected.id };
        if (selected.profile_id) updateData.profile_id = selected.profile_id;
        if (selected.user_id) updateData.user_id = selected.user_id;
        const { error } = await supabase
          .from("payments_v2")
          .update(updateData as any)
          .eq("id", paymentId);
        if (error) throw error;
      }

      toast.success("Сделка связана");
      queryClient.invalidateQueries({ queryKey: ["unified-payments"] });
      onSuccess();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Ошибка: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateDealSuccess = () => {
    setCreateDealOpen(false);
    onSuccess();
    onOpenChange(false);
  };

  const createButton = (
    <Button
      variant="ghost"
      size="sm"
      className="gap-2 text-muted-foreground"
      onClick={() => setCreateDealOpen(true)}
      disabled={saving}
    >
      <Plus className="h-4 w-4" />
      Создать сделку
    </Button>
  );

  return (
    <>
      <DealPickerDialog
        open={open}
        onOpenChange={onOpenChange}
        onPick={handleLink}
        options={{
          isRefund,
          amount,
          currency,
          title: isRefund ? "Связать возврат со сделкой" : "Связать сделку",
          helperText: isRefund
            ? "Вы привязываете возврат. Будут найдены оплаченные сделки с похожей суммой."
            : undefined,
        }}
        footerExtras={
          <>
            {createButton}
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          </>
        }
        emptyStateExtras={
          <div className="space-y-3">
            <p>Нет сделок</p>
            {createButton}
          </div>
        }
      />

      <CreateDealFromPaymentDialog
        open={createDealOpen}
        onOpenChange={setCreateDealOpen}
        paymentId={paymentId}
        rawSource={rawSource}
        amount={amount}
        currency={currency}
        paidAt={paidAt}
        profileId={profileId}
        onSuccess={handleCreateDealSuccess}
      />
    </>
  );
}
