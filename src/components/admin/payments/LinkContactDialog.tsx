import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CreditCard, Loader2 } from "lucide-react";
import { ContactPickerDialog, type PickedContact } from "@/components/admin/shared/pickers/ContactPickerDialog";

interface LinkContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentId: string;
  rawSource: 'queue' | 'payments_v2';
  initialEmail?: string | null;
  initialPhone?: string | null;
  cardLast4?: string | null;
  cardBrand?: string | null;
  cardHolder?: string | null;
  onSuccess: () => void;
}

/**
 * Wrapper around shared ContactPickerDialog that preserves the payment-contact
 * write path: card-link insert + autolink-by-card edge + queue/payments_v2 update
 * + bepaid-auto-process trigger. Behavior identical to pre-PATCH-B.
 */
export function LinkContactDialog({
  open,
  onOpenChange,
  paymentId,
  rawSource,
  initialEmail,
  initialPhone,
  cardLast4,
  cardBrand,
  cardHolder,
  onSuccess,
}: LinkContactDialogProps) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const handleLink = async (selected: PickedContact) => {
    setSaving(true);
    setPendingId(selected.id);
    try {
      // 1. Card-profile link + historical autolink
      if (cardLast4) {
        const { data: existingLink } = await supabase
          .from("card_profile_links")
          .select("id")
          .eq("card_last4", cardLast4)
          .eq("profile_id", selected.id)
          .maybeSingle();
        if (!existingLink) {
          await supabase
            .from("card_profile_links")
            .insert({
              card_last4: cardLast4,
              card_brand: cardBrand || null,
              card_holder: cardHolder || null,
              profile_id: selected.id,
            });
        }
        try {
          await supabase.functions.invoke("payments-autolink-by-card", {
            body: {
              profile_id: selected.id,
              card_last4: cardLast4,
              card_brand: cardBrand || "unknown",
              dry_run: false,
              limit: 200,
            },
          });
        } catch (e) {
          console.warn("Autolink invocation failed:", e);
        }
      }

      // 2. Link payment row
      if (rawSource === "queue") {
        const { error } = await supabase
          .from("payment_reconcile_queue")
          .update({ matched_profile_id: selected.id })
          .eq("id", paymentId);
        if (error) throw error;
        try {
          await supabase.functions.invoke("bepaid-auto-process", {
            body: { queueItemId: paymentId, dryRun: false },
          });
        } catch (e) {
          console.warn("Auto-process after link failed:", e);
        }
      } else {
        const { data: payment, error: fetchError } = await supabase
          .from("payments_v2")
          .select("id, order_id")
          .eq("id", paymentId)
          .single();
        if (fetchError) throw fetchError;

        const { error: updateError } = await supabase
          .from("payments_v2")
          .update({ profile_id: selected.id })
          .eq("id", paymentId);
        if (updateError) throw updateError;

        if (payment?.order_id) {
          const { error: orderError } = await supabase
            .from("orders_v2")
            .update({ profile_id: selected.id })
            .eq("id", payment.order_id);
          if (orderError) console.warn("Failed to update order profile_id:", orderError);
        }

        try {
          await supabase.functions.invoke("bepaid-auto-process", {
            body: { paymentId: paymentId, dryRun: false },
          });
        } catch (e) {
          console.warn("Auto-process after link failed:", e);
        }
      }

      const suffix = cardLast4 ? "ко всем платежам с этой картой" : "";
      toast.success(`Контакт связан ${suffix}`.trim());
      queryClient.invalidateQueries({ queryKey: ["unified-payments"] });
      queryClient.invalidateQueries({ queryKey: ["bepaid-queue"] });
      queryClient.invalidateQueries({ queryKey: ["bepaid-payments"] });
      queryClient.invalidateQueries({ queryKey: ["contact-payments"] });
      onSuccess();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Ошибка: ${e.message}`);
    } finally {
      setSaving(false);
      setPendingId(null);
    }
  };

  return (
    <ContactPickerDialog
      open={open}
      onOpenChange={onOpenChange}
      onPick={handleLink}
      options={{
        title: "Связать контакт",
        initialQuery: initialEmail || initialPhone || "",
      }}
      footerExtras={
        cardLast4 ? (
          <div className="pt-2 border-t">
            <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20">
              <CreditCard className="h-4 w-4 text-primary" />
              <div className="flex-1">
                <p className="text-sm font-medium text-primary">
                  Автопривязка к карте ****{cardLast4}
                </p>
                <p className="text-xs text-muted-foreground">
                  Контакт будет связан со всеми платежами этой картой, включая будущие.
                </p>
              </div>
              {saving && pendingId ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            </div>
          </div>
        ) : null
      }
    />
  );
}
