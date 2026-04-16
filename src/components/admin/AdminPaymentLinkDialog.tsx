import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link2, Copy, ExternalLink, Loader2, Layers, Tag, CheckCircle, Send, AlertTriangle } from "lucide-react";
import { useProductsV2, useTariffs } from "@/hooks/useProductsV2";
import { copyToClipboard } from "@/utils/clipboardUtils";
import { formatPaymentTimeIANA } from "@/lib/formatPaymentTime";

interface AdminPaymentLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userName?: string;
  userEmail?: string;
  telegramUserId?: number | null;
}

export function AdminPaymentLinkDialog({
  open,
  onOpenChange,
  userId,
  userName,
  userEmail,
  telegramUserId,
}: AdminPaymentLinkDialogProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [selectedTariffId, setSelectedTariffId] = useState<string>("");
  const [customAmount, setCustomAmount] = useState<string>("");
  const [description, setDescription] = useState("");
  const [paymentType, setPaymentType] = useState<"one_time" | "subscription">("one_time");
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [conflictData, setConflictData] = useState<any>(null);
  const [replaceStep, setReplaceStep] = useState<'idle' | 'cancelling' | 'creating' | 'error'>('idle');

  // Fetch products
  const { data: products, isLoading: productsLoading } = useProductsV2();
  
  // Fetch tariffs for selected product
  const { data: tariffs, isLoading: tariffsLoading } = useTariffs(selectedProductId);

  // Fetch tariff prices
  const { data: tariffPrices } = useQuery({
    queryKey: ["tariff_prices_for_link", selectedTariffId],
    queryFn: async () => {
      if (!selectedTariffId) return null;
      const { data, error } = await supabase
        .from("tariff_prices")
        .select("*")
        .eq("tariff_id", selectedTariffId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data?.[0] || null;
    },
    enabled: !!selectedTariffId,
  });

  // === PATCH E: No more client-side duplicate check — server handles it via structured conflict response ===

  // Replace subscription mutation (cancel old + create new)
  const replaceSubscriptionMutation = useMutation({
    mutationFn: async (conflictInfo: any) => {
      const subV2Id = conflictInfo.subscription_v2_id;

      // Step 1: Cancel old subscription at provider
      setReplaceStep('cancelling');
      const { data: cancelData, error: cancelError } = await supabase.functions.invoke('bepaid-cancel-subscriptions', {
        body: { subscription_v2_id: subV2Id, source: 'admin_replace' }
      });
      if (cancelError) throw new Error('Ошибка отмены у провайдера: ' + cancelError.message);
      if (cancelData?.failed?.length > 0) {
        throw new Error('Провайдер не смог отменить подписку: ' + (cancelData.failed[0]?.error || 'неизвестная ошибка'));
      }

      // Step 2: Mark old subscription as superseded
      const { error: updateErr } = await supabase
        .from('subscriptions_v2')
        .update({ status: 'superseded', auto_renew: false })
        .eq('id', subV2Id);
      if (updateErr) {
        console.error('[PATCH E] Failed to mark old sub as superseded:', updateErr);
        // Don't block — provider cancel already succeeded
      }

      // Step 3: Audit — stage 1: replace_started (after cancel, before new checkout)
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const { error: auditErr } = await supabase.from('audit_logs').insert({
        actor_type: 'user',
        actor_user_id: currentUser?.id || null,
        target_user_id: userId,
        action: 'subscription.replace_started',
        meta: {
          old_subscription_v2_id: subV2Id,
          product_id: conflictInfo.product_id,
          tariff_id: conflictInfo.tariff_id,
          old_bepaid_subscription_id: conflictInfo.bepaid_subscription_id,
          cancel_result: cancelData,
          actor_type: 'admin',
        },
      });
      if (auditErr) console.error('[PATCH E] replace_started audit insert failed:', auditErr);
      // Note: subscription.replaced (stage 2) is written server-side in create-payment-checkout.ts after new order is created

      // Step 4: Create new checkout with replacement_of_subscription_v2_id
      setReplaceStep('creating');
      const { data, error } = await supabase.functions.invoke("admin-create-payment-link", {
        body: {
          user_id: userId,
          product_id: selectedProductId,
          tariff_id: selectedTariffId,
          amount: Math.round(amount * 100),
          payment_type: paymentType,
          description: description || `${selectedProduct?.name} — ${selectedTariff?.name}`,
          replacement_of_subscription_v2_id: subV2Id,
        },
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.error || "Ошибка создания ссылки");
      return data;
    },
    onSuccess: (data) => {
      setGeneratedUrl(data.redirect_url);
      setConflictData(null);
      setReplaceStep('idle');
      toast.success("Старая подписка отменена, новая ссылка создана");
      queryClient.invalidateQueries({ queryKey: ['contact-provider-subscriptions', userId] });
    },
    onError: (error: Error) => {
      setReplaceStep('error');
      toast.error('Ошибка замены подписки: ' + error.message);
    },
  });

  // Reset tariff when product changes
  useEffect(() => {
    setSelectedTariffId("");
    setCustomAmount("");
    setGeneratedUrl(null);
  }, [selectedProductId]);

  // Auto-fill amount from tariff price
  useEffect(() => {
    if (tariffPrices?.price) {
      setCustomAmount(String(tariffPrices.price));
    }
    setGeneratedUrl(null);
  }, [tariffPrices]);

  // Reset form on close
  useEffect(() => {
    if (!open) {
      setSelectedProductId("");
      setSelectedTariffId("");
      setCustomAmount("");
      setDescription("");
      setPaymentType("one_time");
      setGeneratedUrl(null);
      setShowCancelConfirm(false);
      setConflictData(null);
      setReplaceStep('idle');
    }
  }, [open]);

  const selectedProduct = products?.find(p => p.id === selectedProductId);
  const selectedTariff = tariffs?.find(t => t.id === selectedTariffId);
  const amount = parseFloat(customAmount) || 0;

  const createLinkMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProductId || !selectedTariffId) {
        throw new Error("Выберите продукт и тариф");
      }
      if (amount <= 0) {
        throw new Error("Введите корректную сумму");
      }

      const { data, error } = await supabase.functions.invoke("admin-create-payment-link", {
        body: {
          user_id: userId,
          product_id: selectedProductId,
          tariff_id: selectedTariffId,
          amount: Math.round(amount * 100),
          payment_type: paymentType,
          description: description || `${selectedProduct?.name} — ${selectedTariff?.name}`,
        },
      });

      if (error) throw error;
      // PATCH E: handle structured conflict response
      if (!data.success && data.error === 'existing_subscription_conflict' && data.conflict) {
        setConflictData(data.conflict);
        return null; // don't treat as error — show conflict UI
      }
      if (!data.success) throw new Error(data.error || "Ошибка создания ссылки");
      return data;
    },
    onSuccess: (data) => {
      if (data) {
        setGeneratedUrl(data.redirect_url);
        toast.success("Ссылка на оплату создана");
      }
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
    },
  });

  const sendToTelegramMutation = useMutation({
    mutationFn: async () => {
      if (!generatedUrl || !selectedProduct || !selectedTariff) {
        throw new Error("Нет данных для отправки");
      }

      const typeLabel = paymentType === "subscription" ? "Подписка (ежемесячно)" : "Разовая оплата";
      const telegramMessage = `💳 *Оплата подписки*

📦 Продукт: ${selectedProduct.name}
📋 Тариф: ${selectedTariff.name}
💰 Стоимость: ${amount} BYN
📅 Тип: ${typeLabel}`;

      const { data, error } = await supabase.functions.invoke("telegram-send-notification", {
        body: {
          user_id: userId,
          message_type: "custom",
          custom_message: telegramMessage,
          reply_markup: {
            inline_keyboard: [[{ text: "💳 Ссылка на оплату", url: generatedUrl }]]
          },
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Ошибка отправки");
      return data;
    },
    onSuccess: () => {
      toast.success("Ссылка отправлена клиенту в Telegram");
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createLinkMutation.mutate();
  };

  const handleReplaceSubscription = () => {
    if (conflictData) {
      setShowCancelConfirm(true);
    }
  };

  const confirmReplace = () => {
    setShowCancelConfirm(false);
    if (conflictData) {
      replaceSubscriptionMutation.mutate(conflictData);
    }
  };

  const activeProducts = products?.filter(p => p.is_active) || [];

  const isCreateDisabled =
    createLinkMutation.isPending ||
    !selectedProductId ||
    !selectedTariffId ||
    amount <= 0 ||
    !!conflictData;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5" />
              Ссылка на оплату
            </DialogTitle>
            <DialogDescription>
              Создайте ссылку для самостоятельной оплаты клиентом
            </DialogDescription>
          </DialogHeader>

          {generatedUrl ? (
            // Show generated URL
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle className="h-5 w-5 text-primary" />
                  <p className="font-medium">Ссылка создана</p>
                </div>
                <p className="text-sm text-muted-foreground mb-2">
                  {selectedProduct?.name} — {selectedTariff?.name} · {amount} BYN
                  {paymentType === "subscription" ? " (подписка)" : " (разовая)"}
                </p>
                <Input
                  readOnly
                  value={generatedUrl}
                  className="font-mono text-xs"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1 gap-2"
                  onClick={() => copyToClipboard(generatedUrl)}
                >
                  <Copy className="h-4 w-4" />
                  Копировать
                </Button>
                <Button
                  className="flex-1 gap-2"
                  onClick={() => window.open(generatedUrl, '_blank')}
                >
                  <ExternalLink className="h-4 w-4" />
                  Открыть
                </Button>
              </div>
              {telegramUserId && (
                <Button
                  variant="outline"
                  className="w-full gap-2"
                  disabled={sendToTelegramMutation.isPending}
                  onClick={() => sendToTelegramMutation.mutate()}
                >
                  {sendToTelegramMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Отправить клиенту в Telegram
                </Button>
              )}
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => setGeneratedUrl(null)}
              >
                Создать ещё одну ссылку
              </Button>
            </div>
          ) : (
            // Show form
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* User info */}
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="font-medium">{userName || "—"}</p>
                <p className="text-sm text-muted-foreground">{userEmail}</p>
              </div>

              {/* Product selection */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-indigo-500" />
                  Продукт
                </Label>
                {productsLoading ? (
                  <Skeleton className="h-10 w-full" />
                ) : (
                  <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите продукт" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeProducts.map((product) => (
                        <SelectItem key={product.id} value={product.id}>
                          {product.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Tariff selection */}
              {selectedProductId && (
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Tag className="h-4 w-4" />
                    Тариф
                  </Label>
                  {tariffsLoading ? (
                    <Skeleton className="h-10 w-full" />
                  ) : tariffs && tariffs.length > 0 ? (
                    <Select value={selectedTariffId} onValueChange={setSelectedTariffId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите тариф" />
                      </SelectTrigger>
                      <SelectContent>
                        {tariffs.filter(t => t.is_active).map((tariff) => (
                          <SelectItem key={tariff.id} value={tariff.id}>
                            {tariff.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm text-muted-foreground">Нет доступных тарифов</p>
                  )}
                </div>
              )}

              {/* Amount */}
              {selectedTariffId && (
                <div className="space-y-2">
                  <Label htmlFor="link-amount">Сумма (BYN)</Label>
                  <Input
                    id="link-amount"
                    type="number"
                    step="0.01"
                    min="1"
                    placeholder="0.00"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    required
                  />
                  {tariffPrices?.price && (
                    <p className="text-xs text-muted-foreground">
                      Цена тарифа: {tariffPrices.price} BYN
                    </p>
                  )}
                </div>
              )}

              {/* Payment type */}
              {selectedTariffId && amount > 0 && (
                <div className="space-y-2">
                  <Label>Тип оплаты</Label>
                  <RadioGroup
                    value={paymentType}
                    onValueChange={(v) => setPaymentType(v as "one_time" | "subscription")}
                    className="space-y-2"
                  >
                    <Label htmlFor="pt-one-time" className="flex items-center space-x-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/30">
                      <RadioGroupItem value="one_time" id="pt-one-time" />
                      <div>
                        <p className="font-medium">Разовая оплата</p>
                        <p className="text-xs text-muted-foreground">
                          Одноразовое списание. Клиент может привязать карту.
                        </p>
                      </div>
                    </Label>
                    <Label htmlFor="pt-subscription" className="flex items-center space-x-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/30">
                      <RadioGroupItem value="subscription" id="pt-subscription" />
                      <div>
                        <p className="font-medium">Подписка bePaid</p>
                        <p className="text-xs text-muted-foreground">
                          Ежемесячное автосписание. Управляется через bePaid.
                        </p>
                      </div>
                    </Label>
                  </RadioGroup>
                </div>
              )}

              {/* PATCH E: Conflict warning from server response */}
              {conflictData && (
                <div className="p-3 rounded-lg border border-destructive/50 bg-destructive/5 space-y-2">
                  <div className="flex items-center gap-2 text-destructive">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <p className="text-sm font-medium">Активная подписка уже существует</p>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <p>Статус: {conflictData.status}</p>
                    {conflictData.display_next_charge_at && (
                      <p>Следующее списание: {formatPaymentTimeIANA(conflictData.display_next_charge_at, conflictData.timezone_used || 'Europe/Minsk')}</p>
                    )}
                    {conflictData.display_access_end_at && (
                      <p>Доступ до: {formatPaymentTimeIANA(conflictData.display_access_end_at, conflictData.timezone_used || 'Europe/Minsk')}</p>
                    )}
                    {conflictData.bepaid_subscription_id && (
                      <p>bePaid ID: {conflictData.bepaid_subscription_id}</p>
                    )}
                  </div>
                  {replaceStep !== 'idle' && replaceStep !== 'error' ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {replaceStep === 'cancelling' && 'Отменяем текущую подписку…'}
                      {replaceStep === 'creating' && 'Создаём новую ссылку…'}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2 mt-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() => setConflictData(null)}
                      >
                        Оставить текущую подписку
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        className="text-xs"
                        disabled={replaceSubscriptionMutation.isPending}
                        onClick={handleReplaceSubscription}
                      >
                        Заменить подписку (отменить старую)
                      </Button>
                    </div>
                  )}
                  {replaceStep === 'error' && (
                    <p className="text-xs text-destructive mt-1">Ошибка замены. Попробуйте снова или отмените вручную.</p>
                  )}
                </div>
              )}

              {/* Description */}
              {selectedTariffId && (
                <div className="space-y-2">
                  <Label htmlFor="link-description">Комментарий (опционально)</Label>
                  <Textarea
                    id="link-description"
                    placeholder="Описание для клиента..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                  />
                </div>
              )}

              {/* Summary */}
              {selectedProduct && selectedTariff && amount > 0 && (
                <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 space-y-1">
                  <p className="font-medium">Ссылка на оплату:</p>
                  <p className="text-sm text-muted-foreground">
                    {selectedProduct.name} — {selectedTariff.name}
                  </p>
                  <p className="text-lg font-bold">{amount} BYN</p>
                  <p className="text-xs text-muted-foreground">
                    {paymentType === "subscription" ? "Подписка (ежемесячно)" : "Разовая оплата"}
                  </p>
                </div>
              )}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  Отмена
                </Button>
                <Button
                  type="submit"
                  disabled={isCreateDisabled}
                >
                  {createLinkMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Link2 className="h-4 w-4 mr-2" />
                  )}
                  Создать ссылку
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Replace confirmation dialog */}
      <AlertDialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Заменить подписку?</AlertDialogTitle>
            <AlertDialogDescription>
              Текущая подписка будет отменена у провайдера. После успешной отмены будет создана новая ссылка на оплату. Если отмена не пройдёт, новая подписка не будет создана.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Нет, оставить</AlertDialogCancel>
            <AlertDialogAction onClick={confirmReplace}>
              Да, заменить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}