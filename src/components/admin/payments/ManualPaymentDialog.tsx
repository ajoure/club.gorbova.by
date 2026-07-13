/**
 * ManualPaymentDialog — Stage 3
 *
 * Позволяет админу вручную зафиксировать успешный платёж (банковский перевод,
 * приход по RR-квитанции, оффлайн-приход). Создаёт каноническую строку в
 * `payment_reconcile_queue` через edge `admin-create-manual-payment`.
 *
 * После успешного создания сразу открывает `CreateDealFromPaymentDialog`,
 * чтобы админ мог привязать платёж к сделке в той же сессии (использует
 * атомарный RPC admin_create_deal_from_payment).
 */
import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Landmark, Loader2, Wallet } from "lucide-react";
import { CreateDealFromPaymentDialog } from "./CreateDealFromPaymentDialog";
import { normalizeEdgeFunctionError } from "@/utils/normalizeEdgeFunctionError";
import { DateTimePicker } from "@/components/ui/datetime-picker";

type Provider = "bank" | "rr" | "bepaid" | "stripe";

const PROVIDERS: Array<{ value: Provider; label: string }> = [
  { value: "bank", label: "Банк (ручной перевод)" },
  { value: "rr", label: "RR (квитанция)" },
  { value: "bepaid", label: "bePaid (ручная фиксация)" },
  { value: "stripe", label: "Stripe (ручная фиксация)" },
];

const CURRENCIES = ["BYN", "RUB", "USD", "EUR"];

interface ManualPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function ManualPaymentDialog({
  open,
  onOpenChange,
  onSuccess,
}: ManualPaymentDialogProps) {
  const [saving, setSaving] = useState(false);
  const [provider, setProvider] = useState<Provider>("bank");
  const [amount, setAmount] = useState<string>("");
  const [currency, setCurrency] = useState<string>("BYN");
  const [paidAtDate, setPaidAtDate] = useState<Date | undefined>(() => new Date());
  const [paidAtTime, setPaidAtTime] = useState<string>(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });
  const [externalId, setExternalId] = useState<string>("");
  const [customerEmail, setCustomerEmail] = useState<string>("");
  const [note, setNote] = useState<string>("");

  // После создания queue row — открываем дилог создания сделки.
  const [createdQueueRowId, setCreatedQueueRowId] = useState<string | null>(null);
  const [followUpOpen, setFollowUpOpen] = useState(false);

  const numericAmount = useMemo(() => Number(amount), [amount]);
  const amountInvalid =
    amount.trim() === "" || !Number.isFinite(numericAmount) || numericAmount <= 0;

  const buildPaidAtDate = (): Date | null => {
    if (!paidAtDate) return null;
    const d = new Date(paidAtDate);
    if (paidAtTime) {
      const [hh, mm] = paidAtTime.split(":").map(Number);
      d.setHours(hh || 0, mm || 0, 0, 0);
    } else {
      d.setHours(0, 0, 0, 0);
    }
    return d;
  };

  const resetForm = () => {
    setProvider("bank");
    setAmount("");
    setCurrency("BYN");
    const now = new Date();
    setPaidAtDate(now);
    setPaidAtTime(
      `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
    );
    setExternalId("");
    setCustomerEmail("");
    setNote("");
  };

  const handleSubmit = async () => {
    if (amountInvalid) {
      toast.error("Введите положительную сумму");
      return;
    }
    const paidAtDateObj = buildPaidAtDate();
    if (!paidAtDateObj) {
      toast.error("Укажите дату платежа");
      return;
    }

    setSaving(true);
    try {
      const paidAtIso = paidAtDateObj.toISOString();
      const idempotencyKey =
        `admin-manual-payment:v1:${provider}:${numericAmount}:${currency}` +
        `:${paidAtIso}:${externalId.trim() || "auto"}:${customerEmail.trim().toLowerCase()}`;

      const { data, error } = await supabase.functions.invoke(
        "admin-create-manual-payment",
        {
          body: {
            provider,
            amount: numericAmount,
            currency,
            paidAt: paidAtIso,
            externalId: externalId.trim() || null,
            note: note.trim() || null,
            customerEmail: customerEmail.trim() || null,
            idempotencyKey,
          },
        },
      );

      if (error || !data?.ok) {
        const msg = normalizeEdgeFunctionError(
          error ?? data,
          "Не удалось создать ручной платёж",
        );
        toast.error(msg);
        return;
      }

      if (data.idempotent_replay) {
        toast.info("Платёж уже был зарегистрирован ранее");
      } else {
        toast.success("Ручной платёж создан");
      }

      setCreatedQueueRowId(data.queue_row_id as string);
      onOpenChange(false);
      resetForm();
      onSuccess();
      // Сразу предлагаем создать сделку по свежесозданному платежу.
      setFollowUpOpen(true);
    } catch (e: any) {
      console.error("Manual payment error:", e);
      toast.error(`Ошибка: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5" />
              Добавить ручной платёж
            </DialogTitle>
            <DialogDescription>
              Регистрирует успешный платёж в очереди сверки. После создания
              можно сразу привязать его к сделке.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Источник</Label>
                <Select value={provider} onValueChange={(v) => setProvider(v as Provider)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        <span className="flex items-center gap-2">
                          <Landmark className="h-3.5 w-3.5 opacity-70" />
                          {p.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Дата платежа</Label>
                <DateTimePicker
                  date={paidAtDate}
                  time={paidAtTime}
                  onDateChange={setPaidAtDate}
                  onTimeChange={setPaidAtTime}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Сумма</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Валюта</Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Внешний идентификатор (номер квитанции / чека)</Label>
              <Input
                value={externalId}
                onChange={(e) => setExternalId(e.target.value)}
                placeholder="Например: BANK-2026-000123"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Email плательщика (необязательно)</Label>
              <Input
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="client@example.com"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Комментарий</Label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Основание платежа, реквизиты, комментарий бухгалтера…"
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Отмена
            </Button>
            <Button onClick={handleSubmit} disabled={saving || amountInvalid}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Создать платёж
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* После успешного создания — сразу предлагаем привязать к сделке. */}
      {createdQueueRowId && (
        <CreateDealFromPaymentDialog
          open={followUpOpen}
          onOpenChange={(v) => {
            setFollowUpOpen(v);
            if (!v) setCreatedQueueRowId(null);
          }}
          paymentId={createdQueueRowId}
          rawSource="queue"
          amount={numericAmount || 0}
          currency={currency}
          paidAt={buildPaidAtDate()?.toISOString()}
          onSuccess={() => {
            setFollowUpOpen(false);
            setCreatedQueueRowId(null);
            onSuccess();
          }}
        />
      )}
    </>
  );
}
