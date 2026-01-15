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

interface UnlinkDealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentId: string;
  rawSource: 'queue' | 'payments_v2';
  orderId: string | null;
  orderNumber?: string | null;
  onSuccess: () => void;
}

export function UnlinkDealDialog({
  open,
  onOpenChange,
  paymentId,
  rawSource,
  orderId,
  orderNumber,
  onSuccess,
}: UnlinkDealDialogProps) {
  const [loading, setLoading] = useState(false);

  const handleUnlink = async () => {
    setLoading(true);
    try {
      if (rawSource === 'queue') {
        const { error } = await supabase
          .from("payment_reconcile_queue")
          .update({ matched_order_id: null })
          .eq("id", paymentId);
        
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("payments_v2")
          .update({ order_id: null })
          .eq("id", paymentId);
        
        if (error) throw error;
      }
      
      toast.success("Сделка отвязана от платежа");
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
            Вы уверены, что хотите отвязать платёж от сделки{" "}
            <strong>{orderNumber || orderId?.substring(0, 8)}</strong>?
            <br /><br />
            Сама сделка не будет удалена - только связь с этим платежом.
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
