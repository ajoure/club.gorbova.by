import { useState, useMemo, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, ExternalLink, Loader2 } from "lucide-react";

import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { supabase } from "@/integrations/supabase/client";
import { copyToClipboard } from "@/utils/clipboardUtils";
import { useProductsV2, useTariffs } from "@/hooks/useProductsV2";
import { useTariffOffers } from "@/hooks/useTariffOffers";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type PaymentType = "one_time" | "subscription";

/**
 * CreatePublicLinkDialog — обёртка над admin-create-public-link.
 * Публичная ссылка без user_id = доступна любому плательщику.
 */
export function CreatePublicLinkDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const { data: products = [] } = useProductsV2();
  const [productId, setProductId] = useState<string>("");
  const { data: tariffs = [] } = useTariffs(productId || undefined);
  const [tariffId, setTariffId] = useState<string>("");
  const { data: offers = [] } = useTariffOffers(tariffId || undefined);

  const [paymentType, setPaymentType] = useState<PaymentType>("one_time");
  const [amount, setAmount] = useState<string>("");
  const [maxUses, setMaxUses] = useState<string>("");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [description, setDescription] = useState<string>("");

  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);

  // Auto-pick offer (active pay_now)
  const effectiveOffer = useMemo(() => {
    const active = offers.filter((o) => o.is_active && o.offer_type === "pay_now");
    if (!active.length) return null;
    const primary = active.find((o) => o.is_primary);
    return primary || (active.length === 1 ? active[0] : null);
  }, [offers]);

  // Auto-fill amount from offer
  useEffect(() => {
    if (effectiveOffer && !amount) {
      setAmount((effectiveOffer.amount / 100).toString());
    }
  }, [effectiveOffer]); // eslint-disable-line

  const reset = () => {
    setProductId(""); setTariffId(""); setPaymentType("one_time");
    setAmount(""); setMaxUses(""); setExpiresAt(""); setDescription("");
    setGeneratedUrl(null);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!productId || !tariffId) throw new Error("Выберите продукт и тариф");
      if (!effectiveOffer) throw new Error("У тарифа нет активной кнопки оплаты");
      const amt = Number(amount);
      if (!amt || amt <= 0) throw new Error("Введите корректную сумму");

      const { data, error } = await supabase.functions.invoke("admin-create-public-link", {
        body: {
          product_id: productId,
          tariff_id: tariffId,
          offer_id: effectiveOffer.id,
          amount: Math.round(amt * 100),
          payment_type: paymentType,
          description: description || null,
          max_uses: maxUses ? parseInt(maxUses, 10) : null,
          expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
          // user_id intentionally omitted → публичная ссылка для любого плательщика
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Не удалось создать ссылку");
      return data as { public_url: string };
    },
    onSuccess: (data) => {
      setGeneratedUrl(data.public_url);
      toast.success("Публичная ссылка создана");
      qc.invalidateQueries({ queryKey: ["payment-links-enriched"] });
    },
    onError: (e) => {
      toast.error("Ошибка: " + (e as Error).message);
    },
  });

  const handleClose = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Создать публичную ссылку</DialogTitle>
          <DialogDescription>
            Ссылка не привязана к конкретному пользователю и может быть оплачена любым человеком.
            Заказ, доступ и сделка будут привязаны к плательщику в момент оплаты.
          </DialogDescription>
        </DialogHeader>

        {!generatedUrl ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Продукт</Label>
              <Select value={productId} onValueChange={(v) => { setProductId(v); setTariffId(""); }}>
                <SelectTrigger><SelectValue placeholder="Выберите продукт" /></SelectTrigger>
                <SelectContent>
                  {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Тариф</Label>
              <Select value={tariffId} onValueChange={setTariffId} disabled={!productId}>
                <SelectTrigger><SelectValue placeholder="Выберите тариф" /></SelectTrigger>
                <SelectContent>
                  {tariffs.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Тип оплаты</Label>
                <Select value={paymentType} onValueChange={(v) => setPaymentType(v as PaymentType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="one_time">Разовая</SelectItem>
                    <SelectItem value="subscription">Подписка</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Сумма (BYN)</Label>
                <Input type="number" min="1" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Лимит использований</Label>
                <Input
                  type="number" min="1" placeholder="Без лимита"
                  value={maxUses} onChange={(e) => setMaxUses(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Истекает</Label>
                <Input
                  type="datetime-local"
                  value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Описание</Label>
              <Textarea
                rows={2}
                placeholder="Внутренняя пометка (необязательно)"
                value={description} onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {effectiveOffer && (
              <div className="text-xs text-muted-foreground">
                Кнопка оплаты: <strong>{effectiveOffer.button_label || "Оплатить"}</strong>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm">Ссылка создана и готова к использованию:</div>
            <div className="flex items-center gap-1.5">
              <code className="flex-1 text-xs bg-muted px-2 py-1.5 rounded truncate">{generatedUrl}</code>
              <Button size="icon" variant="ghost" onClick={() => copyToClipboard(generatedUrl, "Ссылка скопирована")}>
                <Copy className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => window.open(generatedUrl, "_blank")}>
                <ExternalLink className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          {!generatedUrl ? (
            <>
              <Button variant="outline" onClick={() => handleClose(false)}>Отмена</Button>
              <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
                {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Создать ссылку
              </Button>
            </>
          ) : (
            <Button onClick={() => handleClose(false)}>Готово</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
