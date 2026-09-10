import { useState } from "react";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RefundDialog } from "./RefundDialog";
import { isRefundablePayment, type RefundPayment } from "../../../supabase/functions/_shared/refund-payment-selection";

export function PaymentRefundButton({ payment, orderNumber, onSuccess }: {
  payment: RefundPayment; orderNumber: string; onSuccess?: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (!payment.order_id || !isRefundablePayment(payment) || !['bepaid','stripe'].includes(payment.provider || '')) return null;
  return <>
    <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
      <Undo2 className="mr-1 h-4 w-4" />Возврат
    </Button>
    {open && <RefundDialog open={open} onOpenChange={setOpen} paymentId={payment.id}
      orderId={payment.order_id} orderNumber={orderNumber}
      amount={Number(payment.amount) - Number(payment.refunded_amount || 0)}
      currency={payment.currency || 'BYN'} paymentProvider={payment.provider} onSuccess={onSuccess} />}
  </>;
}
