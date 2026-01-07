import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AlertTriangle, CreditCard, Ban, Calendar, RefreshCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface RefundDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  orderNumber: string;
  amount: number;
  currency: string;
  onSuccess?: () => void;
}

type AccessAction = "revoke" | "reduce" | "keep" | "keep_subscription";

export function RefundDialog({
  open,
  onOpenChange,
  orderId,
  orderNumber,
  amount,
  currency,
  onSuccess,
}: RefundDialogProps) {
  const [reason, setReason] = useState("");
  const [refundAmount, setRefundAmount] = useState(amount);
  const [isProcessing, setIsProcessing] = useState(false);
  const [accessAction, setAccessAction] = useState<AccessAction>("revoke");
  const [reduceDays, setReduceDays] = useState(30);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setRefundAmount(amount);
      setReason("");
      setAccessAction(refundAmount >= amount ? "revoke" : "reduce");
      setReduceDays(30);
    }
  }, [open, amount]);

  // Auto-set access action based on refund amount
  useEffect(() => {
    if (refundAmount >= amount) {
      setAccessAction("revoke");
    }
  }, [refundAmount, amount]);

  const isFullRefund = refundAmount >= amount;

  const handleRefund = async () => {
    if (!reason.trim()) {
      toast.error("Укажите причину возврата");
      return;
    }

    if (refundAmount <= 0 || refundAmount > amount) {
      toast.error("Некорректная сумма возврата");
      return;
    }

    if (accessAction === "reduce" && reduceDays <= 0) {
      toast.error("Укажите количество дней для сокращения");
      return;
    }

    setIsProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke("subscription-admin-actions", {
        body: {
          action: "refund",
          order_id: orderId,
          refund_amount: refundAmount,
          refund_reason: reason.trim(),
          access_action: accessAction,
          reduce_days: accessAction === "reduce" ? reduceDays : undefined,
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      const messages: Record<string, string> = {
        revoke: "Возврат оформлен, доступ аннулирован",
        reduce: `Возврат оформлен, доступ сокращён на ${reduceDays} дней`,
        keep: "Возврат оформлен, доступ сохранён",
        keep_subscription: "Возврат оформлен, подписка сохранена, списания продолжатся",
      };

      toast.success(messages[accessAction]);
      setReason("");
      setRefundAmount(amount);
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error("Refund error:", error);
      toast.error("Ошибка возврата: " + (error as Error).message);
    } finally {
      setIsProcessing(false);
    }
  };

  const formatAmount = (val: number) => {
    return new Intl.NumberFormat("ru-BY", {
      style: "currency",
      currency,
    }).format(val);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="w-5 h-5" />
            Возврат средств
          </DialogTitle>
          <DialogDescription>
            Заказ {orderNumber} • Сумма: {formatAmount(amount)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800 dark:text-amber-200">
              Возврат будет проведён через платёжную систему и записан в историю.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="refund-amount">Сумма возврата</Label>
            <Input
              id="refund-amount"
              type="number"
              value={refundAmount}
              onChange={(e) => setRefundAmount(parseFloat(e.target.value) || 0)}
              max={amount}
              min={0.01}
              step={0.01}
            />
            <p className="text-xs text-muted-foreground">
              Максимум: {formatAmount(amount)}
            </p>
          </div>

          <div className="space-y-3">
            <Label>Действие с доступом</Label>
            <RadioGroup
              value={accessAction}
              onValueChange={(val) => setAccessAction(val as AccessAction)}
              className="space-y-2"
            >
              <div className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                <RadioGroupItem value="revoke" id="revoke" disabled={!isFullRefund} />
                <Label
                  htmlFor="revoke"
                  className={`flex-1 cursor-pointer ${!isFullRefund ? "opacity-50" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    <Ban className="w-4 h-4 text-red-500" />
                    <span className="font-medium">Аннулировать доступ</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Полный возврат — доступ будет немедленно отозван
                  </p>
                </Label>
              </div>

              <div className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                <RadioGroupItem value="reduce" id="reduce" />
                <Label htmlFor="reduce" className="flex-1 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-amber-500" />
                    <span className="font-medium">Сократить срок доступа</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Частичный возврат — уменьшить срок на указанное количество дней
                  </p>
                </Label>
              </div>

              {!isFullRefund && (
                <div className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                  <RadioGroupItem value="keep" id="keep" />
                  <Label htmlFor="keep" className="flex-1 cursor-pointer">
                    <div className="flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-green-500" />
                      <span className="font-medium">Сохранить доступ</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Только возврат денег, без изменения доступа
                    </p>
                  </Label>
                </div>
              )}

              <div className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                <RadioGroupItem value="keep_subscription" id="keep_subscription" />
                <Label htmlFor="keep_subscription" className="flex-1 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <RefreshCcw className="w-4 h-4 text-blue-500" />
                    <span className="font-medium">Сохранить подписку</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Возврат денег, подписка остаётся, следующее списание по графику
                  </p>
                </Label>
              </div>
            </RadioGroup>
          </div>

          {accessAction === "reduce" && (
            <div className="space-y-2 p-3 rounded-lg bg-muted/50">
              <Label htmlFor="reduce-days">Сократить на (дней)</Label>
              <Input
                id="reduce-days"
                type="number"
                value={reduceDays === 0 ? "" : reduceDays}
                onChange={(e) => setReduceDays(e.target.value === "" ? 0 : parseInt(e.target.value) || 0)}
                onBlur={() => { if (reduceDays < 1) setReduceDays(1); }}
                min={1}
                max={365}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="refund-reason">
              Причина возврата <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="refund-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Опишите причину возврата..."
              rows={3}
              className="resize-none"
            />
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isProcessing}
            className="w-full sm:w-auto"
          >
            Отмена
          </Button>
          <Button
            variant="destructive"
            onClick={handleRefund}
            disabled={isProcessing || !reason.trim()}
            className="w-full sm:w-auto"
          >
            {isProcessing ? "Обработка..." : `Вернуть ${formatAmount(refundAmount)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
