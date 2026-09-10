import { useState, useEffect, useId } from "react";
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
import { useQuery } from "@tanstack/react-query";
import { isRefundablePayment, type RefundPayment } from "../../../supabase/functions/_shared/refund-payment-selection";
import {
  adjustRefundAccessActionForAmount,
  DEFAULT_REFUND_ACCESS_ACTION,
  type RefundAccessAction,
} from "@/lib/refundAccessPolicy";

interface GroupRefundItem {
  id: string;
  role: "primary" | "addon";
  order_id: string | null;
  final_amount: number;
  item_snapshot: {
    product_name?: string;
    tariff_name?: string;
  } | null;
  payment_allocations?: Array<{
    amount: number;
    refunded_amount: number;
  }>;
}

interface RefundDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  orderNumber: string;
  amount: number;
  currency: string;
  paymentProvider?: string | null;
  paymentId?: string;
  onSuccess?: () => void;
}

interface RefundAccessActionSelectorProps {
  value: RefundAccessAction;
  isFullRefund: boolean;
  onValueChange: (value: RefundAccessAction) => void;
}

export function RefundAccessActionSelector({
  value,
  isFullRefund,
  onValueChange,
}: RefundAccessActionSelectorProps) {
  const groupId = useId();

  const options: Array<{
    value: RefundAccessAction;
    title: string;
    description: string;
    icon: typeof Ban;
    iconClassName: string;
    disabled?: boolean;
  }> = [
    {
      value: "revoke",
      title: "Аннулировать доступ",
      description: "Полный возврат — доступ будет немедленно отозван",
      icon: Ban,
      iconClassName: "text-red-500",
      disabled: !isFullRefund,
    },
    {
      value: "reduce",
      title: "Сократить срок доступа",
      description: "Частичный возврат — уменьшить срок на указанное количество дней",
      icon: Calendar,
      iconClassName: "text-amber-500",
    },
    {
      value: "keep",
      title: "Сохранить доступ",
      description: "Только возврат денег, без изменения доступа и Telegram",
      icon: CreditCard,
      iconClassName: "text-green-500",
    },
    {
      value: "keep_subscription",
      title: "Сохранить подписку",
      description: "Возврат денег, подписка остаётся, следующее списание по графику",
      icon: RefreshCcw,
      iconClassName: "text-blue-500",
    },
  ];

  return (
    <RadioGroup
      value={value}
      onValueChange={(nextValue) => onValueChange(nextValue as RefundAccessAction)}
      className="space-y-2"
      aria-label="Действие с доступом"
    >
      {options.map((option) => {
        const optionId = `${groupId}-${option.value}`;
        const Icon = option.icon;
        const isSelected = value === option.value;
        const selectOption = () => {
          if (!option.disabled) onValueChange(option.value);
        };

        return (
          <div
            key={option.value}
            data-testid={`refund-access-action-${option.value}`}
            data-selected={isSelected ? "true" : "false"}
            onClick={selectOption}
            className={`flex items-center space-x-3 rounded-lg border p-3 transition-colors ${
              option.disabled
                ? "cursor-not-allowed opacity-50"
                : "cursor-pointer hover:bg-muted/50"
            } ${isSelected ? "border-primary bg-primary/5" : ""}`}
          >
            <RadioGroupItem
              value={option.value}
              id={optionId}
              disabled={option.disabled}
              onClick={(event) => event.stopPropagation()}
            />
            <Label
              htmlFor={optionId}
              className={`flex-1 ${option.disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
              onClick={(event) => {
                event.preventDefault();
                selectOption();
              }}
            >
              <div className="flex items-center gap-2">
                <Icon className={`h-4 w-4 ${option.iconClassName}`} />
                <span className="font-medium">{option.title}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{option.description}</p>
            </Label>
          </div>
        );
      })}
    </RadioGroup>
  );
}

export function RefundDialog({
  open,
  onOpenChange,
  orderId,
  orderNumber,
  amount,
  currency,
  paymentProvider,
  paymentId,
  onSuccess,
}: RefundDialogProps) {
  const [selectedPaymentId, setSelectedPaymentId] = useState(paymentId || "");
  const { data: refundPayments, isLoading: paymentsLoading, error: paymentsError } = useQuery({
    queryKey: ["refund-payments", orderId],
    enabled: open,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("payments_v2")
        .select("id,order_id,status,provider,provider_payment_id,transaction_type,amount,refunded_amount,currency,is_deleted,paid_at,created_at")
        .eq("order_id", orderId).order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as RefundPayment[];
    },
  });
  const refundablePayments = (refundPayments ?? []).filter(isRefundablePayment);
  const selectedPayment = refundablePayments.find(p => p.id === selectedPaymentId);
  const paymentAvailable = selectedPayment ? Number(selectedPayment.amount) - Number(selectedPayment.refunded_amount || 0) : null;
  const requiresPayment = !!paymentId || refundablePayments.length > 0;
  const effectiveProvider = selectedPayment?.provider ?? paymentProvider;
  const [providerProof, setProviderProof] = useState<any>(null);
  const [checkingProvider, setCheckingProvider] = useState(false);
  useEffect(() => { setProviderProof(null); }, [open, selectedPaymentId]);
  const [reason, setReason] = useState("");
  const [refundAmount, setRefundAmount] = useState(amount);
  const [isProcessing, setIsProcessing] = useState(false);
  const [accessAction, setAccessAction] = useState<RefundAccessAction>(DEFAULT_REFUND_ACCESS_ACTION);
  const [reduceDays, setReduceDays] = useState(30);
  const [groupItems, setGroupItems] = useState<GroupRefundItem[]>([]);
  const [groupPrimaryOrderId, setGroupPrimaryOrderId] = useState<string | null>(null);
  const [selectedGroupItemId, setSelectedGroupItemId] = useState<string>("");
  const [refundRequestKey, setRefundRequestKey] = useState(() => crypto.randomUUID());
  const selectedGroupItem = groupItems.find((item) => item.id === selectedGroupItemId);
  const selectedAllocation = selectedGroupItem?.payment_allocations?.[0];
  const selectedAvailable = selectedAllocation
    ? Number(selectedAllocation.amount) - Number(selectedAllocation.refunded_amount || 0)
    : null;
  const maxAvailable = Math.min(selectedAvailable ?? Infinity, paymentAvailable ?? amount);
  const orderAvailable = refundablePayments.reduce((sum,p) => sum + Number(p.amount) - Number(p.refunded_amount || 0), 0);
  const isFullRefund = refundAmount >= (selectedAvailable ?? (orderAvailable || amount));
  const selectionReady = !paymentsLoading && !paymentsError && (!requiresPayment || !!selectedPayment);

  useEffect(() => {
    if (!open || !refundPayments) return;
    const eligible = refundPayments.filter(isRefundablePayment);
    const id = paymentId || (eligible.length === 1 ? eligible[0].id : "");
    setSelectedPaymentId(id);
    const p = eligible.find(p => p.id === id);
    if (p) setRefundAmount(Number(p.amount) - Number(p.refunded_amount || 0));
  }, [open, paymentId, refundPayments]);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedPaymentId(paymentId || "");
      setRefundAmount(amount);
      setReason("");
      setAccessAction(DEFAULT_REFUND_ACCESS_ACTION);
      setReduceDays(30);
      setRefundRequestKey(crypto.randomUUID());
      setGroupItems([]);
      setSelectedGroupItemId("");
      setGroupPrimaryOrderId(null);
      if (paymentId) return;
      void (async () => {
        const { data: selectedItem } = await (supabase as any)
          .from("order_group_items")
          .select("id,order_group_id")
          .eq("order_id", orderId)
          .maybeSingle();

        let groupId = selectedItem?.order_group_id ?? null;
        if (!groupId) {
          const { data: primaryGroup } = await (supabase as any)
            .from("order_groups")
            .select("id,primary_order_id")
            .eq("primary_order_id", orderId)
            .maybeSingle();
          groupId = primaryGroup?.id ?? null;
        }
        if (!groupId) return;

        const { data: group } = await (supabase as any)
          .from("order_groups")
          .select("primary_order_id")
          .eq("id", groupId)
          .single();
        setGroupPrimaryOrderId(group?.primary_order_id ?? null);

        const { data } = await (supabase as any)
          .from("order_group_items")
          .select("id,role,order_id,final_amount,item_snapshot,payment_allocations(amount,refunded_amount)")
          .eq("order_group_id", groupId)
          .order("sort_order");
        const items = (data ?? []) as unknown as GroupRefundItem[];
        setGroupItems(items);

        const matchingItem = items.find((item) => item.order_id === orderId);
        if (matchingItem) {
          const allocation = matchingItem.payment_allocations?.[0];
          const available = allocation
            ? Number(allocation.amount) - Number(allocation.refunded_amount || 0)
            : Number(matchingItem.final_amount);
          setSelectedGroupItemId(matchingItem.id);
          setRefundAmount(Math.max(available, 0));
        }
      })();
    }
  }, [open, amount, orderId, paymentId]);

  // A partial refund cannot revoke all access. A full refund keeps the explicit
  // administrator choice and never silently switches `keep` back to `revoke`.
  useEffect(() => {
    const adjusted = adjustRefundAccessActionForAmount(accessAction, isFullRefund);
    if (adjusted !== accessAction) setAccessAction(adjusted);
  }, [accessAction, isFullRefund]);

  const checkProvider = async () => {
    setCheckingProvider(true);
    setProviderProof(null);
    try {
      const {data,error} = await supabase.functions.invoke("subscription-admin-actions", {body:{
        action:"refund_preflight",order_id:orderId,payment_id:selectedPaymentId,
      }});
      if (error || !data?.success) throw new Error("Не удалось проверить bePaid. Повторите проверку позже.");
      setProviderProof(data);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Ошибка проверки bePaid"); }
    finally { setCheckingProvider(false); }
  };

  const handleRefund = async () => {
    if (!reason.trim()) {
      toast.error("Укажите причину возврата");
      return;
    }

    if (!selectionReady) { toast.error("Выберите доступный платёж для возврата"); return; }
    const maxRefundAmount = maxAvailable;
    if (!Number.isFinite(refundAmount) || refundAmount <= 0 || refundAmount > maxRefundAmount || Math.abs(refundAmount * 100 - Math.round(refundAmount * 100)) > 1e-6) {
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
          order_id: groupPrimaryOrderId ?? orderId,
          refund_amount: refundAmount,
          refund_reason: reason.trim(),
          access_action: accessAction,
          reduce_days: accessAction === "reduce" ? reduceDays : undefined,
          order_group_item_id: selectedGroupItemId || undefined,
          payment_id: selectedPaymentId || undefined,
          refund_request_key: refundRequestKey,
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
          {paymentsLoading && <p role="status">Загрузка платежей…</p>}
          {paymentsError && <p role="alert">Не удалось загрузить платежи. Закройте окно и повторите позже.</p>}
          {requiresPayment && (
            <div className="space-y-2">
              <Label htmlFor="refund-payment">Платёж для возврата</Label>
              <select id="refund-payment" value={selectedPaymentId} disabled={!!paymentId || isProcessing}
                className="w-full min-w-0 rounded-md border bg-background p-2 text-sm"
                onChange={event => {
                  const id = event.target.value;
                  setSelectedPaymentId(id);
                  const p = refundablePayments.find(p => p.id === id);
                  if (p) setRefundAmount(Number(p.amount) - Number(p.refunded_amount || 0));
                  setRefundRequestKey(crypto.randomUUID());
                }}>
                <option value="">Выберите списание</option>
                {refundablePayments.map(p => <option key={p.id} value={p.id}>
                  {new Date(p.paid_at || p.created_at || "").toLocaleDateString("ru-RU")} · {formatAmount(Number(p.amount))} · {p.id.slice(-8)}
                </option>)}
              </select>
              {paymentId && !paymentsLoading && !selectedPayment && <p role="alert">Выбранный платёж уже возвращён или недоступен.</p>}
              <p className="text-xs text-muted-foreground">Возврат относится только к выбранному списанию. Остальные оплаты сохраняются.</p>
            </div>
          )}
          {effectiveProvider === "bepaid" && selectedPayment && (
            <div className="space-y-2 rounded-lg border p-3 text-sm">
              <Button type="button" variant="outline" disabled={checkingProvider || isProcessing}
                onClick={checkProvider}>{checkingProvider ? "Проверка…" : "Проверить в bePaid"}</Button>
              <p className="text-xs text-muted-foreground">Проверяет платёж и связанные подписки. Деньги и доступ не изменяются.</p>
              {providerProof && <div role="status" className="space-y-2 break-words">
                <p>Платёж: {providerProof.transaction.matches_payment ? "сумма и валюта подтверждены" : "требует проверки"} · {providerProof.transaction.status} · HTTP {providerProof.transaction.http ?? "нет ответа"}</p>
                {providerProof.subscriptions.map((s: any) => <div key={s.id}>
                  <p>{s.id}: {s.status} · HTTP {s.http ?? "нет ответа"}</p>
                  {s.next_charge_at && <p>Следующая дата у провайдера: {new Date(s.next_charge_at).toLocaleString("ru-RU")}</p>}
                </div>)}
                <p>{providerProof.all_subscriptions_terminal ? "Все найденные подписки завершены или отменены." : "Отсутствие дальнейших списаний пока не подтверждено."}</p>
                <p className="text-xs text-muted-foreground">Проверено: {new Date(providerProof.checked_at).toLocaleString("ru-RU")}. История возвратов требует отдельной сверки.</p>
              </div>}
            </div>
          )}
          {groupItems.length > 0 && (
            <div className="rounded-2xl border border-white/70 bg-gradient-to-br from-white/90 to-fuchsia-50/60 p-4 shadow-[0_12px_35px_rgba(112,57,91,.08)] backdrop-blur-xl">
              <Label className="text-slate-700">Позиция комплекта</Label>
              <div className="mt-3 space-y-2">
                {groupItems.map((item) => {
                  const allocation = item.payment_allocations?.[0];
                  const available = allocation
                    ? Number(allocation.amount) - Number(allocation.refunded_amount || 0)
                    : 0;
                  const selected = selectedGroupItemId === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={available <= 0}
                      onClick={() => {
                        setSelectedGroupItemId(item.id);
                        setRefundAmount(available);
                        setAccessAction(DEFAULT_REFUND_ACCESS_ACTION);
                        setRefundRequestKey(crypto.randomUUID());
                      }}
                      className={`w-full rounded-xl border p-3 text-left transition ${
                        selected
                          ? "border-fuchsia-300 bg-white shadow-sm"
                          : "border-white/80 bg-white/55 hover:bg-white/85"
                      } disabled:opacity-45`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-slate-800">
                            {item.item_snapshot?.product_name || (item.role === "primary" ? "Основной продукт" : "Дополнительный модуль")}
                          </div>
                          {item.item_snapshot?.tariff_name && (
                            <div className="mt-0.5 text-xs text-slate-500">{item.item_snapshot.tariff_name}</div>
                          )}
                        </div>
                        <div className="text-sm font-semibold text-slate-700">
                          {formatAmount(available)}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-500">
                Выберите позицию, если возврат относится к конкретному модулю. Денежный возврат проводится по общему платежу, а распределение фиксируется отдельно.
              </p>
            </div>
          )}
          {effectiveProvider === 'stripe' ? (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800">
              <AlertTriangle className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-indigo-800 dark:text-indigo-200">
                Возврат будет проведён через Stripe. Статус заказа обновится после подтверждения платёжной системы.
              </p>
            </div>
          ) : effectiveProvider && effectiveProvider !== 'bepaid' ? (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-orange-50 dark:bg-orange-950/30 border border-orange-300 dark:border-orange-700">
              <AlertTriangle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-orange-800 dark:text-orange-200">
                <p className="font-medium">Ручной платёж ({effectiveProvider})</p>
                <p className="mt-1">Этот заказ был оплачен вручную. Возврат через bePaid невозможен — будет только изменён статус в системе.</p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800 dark:text-amber-200">
                Возврат будет проведён через платёжную систему bePaid и записан в историю.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="refund-amount">Сумма возврата</Label>
            <Input
              id="refund-amount"
              type="number"
              value={refundAmount}
              onChange={(e) => setRefundAmount(parseFloat(e.target.value) || 0)}
              max={maxAvailable}
              min={0.01}
              step={0.01}
            />
            <p className="text-xs text-muted-foreground">
              Максимум: {formatAmount(maxAvailable)}
            </p>
          </div>

          <div className="space-y-3">
            <Label>Действие с доступом</Label>
            <RefundAccessActionSelector
              value={accessAction}
              isFullRefund={isFullRefund}
              onValueChange={setAccessAction}
            />
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
            disabled={isProcessing || !reason.trim() || !selectionReady}
            className="w-full sm:w-auto"
          >
            {isProcessing ? "Обработка..." : `Вернуть ${formatAmount(refundAmount)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
