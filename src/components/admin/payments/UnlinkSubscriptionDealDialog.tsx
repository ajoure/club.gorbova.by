import { useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Unlink } from "lucide-react";

interface UnlinkSubscriptionDealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscriptionId: string; // bePaid subscription ID (sbs_*)
  orderId: string | null;
  orderNumber?: string | null;
  onSuccess: () => void;
}

export function UnlinkSubscriptionDealDialog({
  open,
  onOpenChange,
  subscriptionId,
  orderId,
  orderNumber,
  onSuccess,
}: UnlinkSubscriptionDealDialogProps) {
  const [loading, setLoading] = useState(false);

  const handleUnlink = async () => {
    if (!orderId) return;
    
    setLoading(true);
    try {
      // 1. Remove bepaid_subscription_id from orders_v2.meta
      const { data: orderData, error: fetchError } = await supabase
        .from("orders_v2")
        .select("meta")
        .eq("id", orderId)
        .single();
      
      if (fetchError) throw fetchError;
      
      const currentMeta = (orderData?.meta as Record<string, any>) || {};
      // Remove bepaid_subscription_id from meta
      const { bepaid_subscription_id, ...restMeta } = currentMeta;
      
      const { error: orderError } = await supabase
        .from("orders_v2")
        .update({ meta: Object.keys(restMeta).length > 0 ? restMeta : null })
        .eq("id", orderId);
      
      if (orderError) throw orderError;
      
      toast.success("Сделка отвязана от подписки");
      onSuccess();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Ошибка: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-[425px]">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <Unlink className="h-5 w-5 text-amber-600" />
            </div>
            Отвязать сделку
          </AlertDialogTitle>
          <AlertDialogDescription>
            Вы уверены, что хотите отвязать подписку от сделки{" "}
            <strong>{orderNumber || orderId?.substring(0, 8)}</strong>?
            <br /><br />
            Сама сделка не будет удалена — только связь с подпиской{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">{subscriptionId}</code>.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Отмена
          </Button>
          <Button variant="destructive" onClick={handleUnlink} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Отвязать
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
