import { useRef, useState } from "react";
import { Copy, Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import type { UiPlan } from "@/hooks/useContactInstallmentsData";

type Quote = {
  fingerprint: string;
  payment_type: "one_time" | "subscription";
  remaining_minor: number;
  schedule_minor: number[];
  interval_days: number;
  replaces_live_mandate: boolean;
  preserves_purchase: true;
  changes_access: false;
};

const money = (minor: number) => `${(minor / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} BYN`;

export function ExistingInstallmentRepaymentDialog({ plan }: { plan: UiPlan }) {
  const defaultCount = Math.max(1, Math.ceil(plan.remainingTotal / Math.max(plan.perPayment, 1)));
  const [open, setOpen] = useState(false);
  const [paymentType, setPaymentType] = useState<"one_time" | "subscription">(defaultCount >= 2 ? "subscription" : "one_time");
  const [count, setCount] = useState(defaultCount);
  const [reason, setReason] = useState("Клиент запросил новую ссылку и переразбиение остатка рассрочки");
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestId = useRef(crypto.randomUUID());

  const invoke = async (action: "quote" | "create") => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-create-public-link", {
        body: { repayment: {
          action,
          order_id: plan.orderId,
          payment_type: paymentType,
          count,
          interval_days: 30,
          ...(action === "create" ? {
            expected_fingerprint: quote?.fingerprint,
            replace_mandate_confirmed: replaceConfirmed,
            request_id: requestId.current,
            reason: reason.trim(),
          } : {}),
        } },
      });
      if (error || data?.success === false || data?.error) throw new Error(data?.error || error?.message || "Не удалось создать ссылку");
      if (action === "quote") {
        setQuote(data.quote as Quote);
        setLink(null);
      } else {
        setLink(String(data.public_url));
        await navigator.clipboard.writeText(String(data.public_url));
        toast.success("Ссылка создана и скопирована");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось создать ссылку");
    } finally {
      setBusy(false);
    }
  };

  const resetQuote = () => { setQuote(null); setLink(null); setReplaceConfirmed(false); };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5" disabled={plan.uiStatus !== "active" || plan.remainingTotal <= 0}>
          <Link2 className="h-3.5 w-3.5" />
          Создать ссылку на остаток
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Оплата по существующей рассрочке</DialogTitle>
          <DialogDescription>
            Ссылка погасит остаток прежней покупки. Новый продукт, сделка и дополнительный доступ не создаются.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Оплачено</span><b>{plan.paidTotal.toFixed(2)} BYN</b></div>
            <div className="mt-1 flex justify-between"><span className="text-muted-foreground">Остаток</span><b>{plan.remainingTotal.toFixed(2)} BYN</b></div>
          </div>

          <div className="space-y-2">
            <Label>Как принять остаток</Label>
            <RadioGroup value={paymentType} onValueChange={(value) => { setPaymentType(value as typeof paymentType); resetQuote(); }} className="grid gap-2 sm:grid-cols-2">
              <Label className="flex cursor-pointer gap-2 rounded-lg border p-3 font-normal"><RadioGroupItem value="one_time" />Разовый платёж</Label>
              <Label className="flex cursor-pointer gap-2 rounded-lg border p-3 font-normal"><RadioGroupItem value="subscription" />Автоплатежи</Label>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="repayment-count">Количество оставшихся платежей</Label>
            <Input id="repayment-count" type="number" min={1} max={60} value={count}
              onChange={(event) => { setCount(Number(event.target.value)); resetQuote(); }} />
            <p className="text-xs text-muted-foreground">Для автоплатежей суммы должны делиться поровну. Интервал — 30 дней.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="repayment-reason">Причина изменения графика</Label>
            <Textarea id="repayment-reason" value={reason} maxLength={1000}
              onChange={(event) => setReason(event.target.value)} />
          </div>

          {quote && (
            <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
              <p className="font-medium">Новый график</p>
              {quote.schedule_minor.map((amount, index) => (
                <div key={index} className="flex justify-between">
                  <span>{index === 0 ? "Сегодня" : `Через ${quote.interval_days * index} дней`}</span>
                  <b>{money(amount)}</b>
                </div>
              ))}
              {quote.replaces_live_mandate && (
                <Label className="flex items-start gap-2 rounded-md border bg-background p-3 font-normal">
                  <Checkbox checked={replaceConfirmed} onCheckedChange={(checked) => setReplaceConfirmed(checked === true)} />
                  <span>После первого успешного платежа заменить прежнее автосписание новым, чтобы исключить двойное списание.</span>
                </Label>
              )}
            </div>
          )}

          {link && (
            <div className="flex items-center gap-2 rounded-lg border p-2">
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{link}</span>
              <Button variant="outline" size="icon" onClick={() => navigator.clipboard.writeText(link).then(() => toast.success("Ссылка скопирована"))}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {!quote ? (
            <Button onClick={() => invoke("quote")} disabled={busy || !Number.isInteger(count) || count < 1 || !reason.trim()}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Рассчитать график
            </Button>
          ) : !link ? (
            <>
              <Button variant="outline" onClick={resetQuote}>Изменить</Button>
              <Button onClick={() => invoke("create")} disabled={busy || (quote.replaces_live_mandate && !replaceConfirmed)}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Создать ссылку
              </Button>
            </>
          ) : (
            <Button onClick={() => setOpen(false)}>Готово</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
