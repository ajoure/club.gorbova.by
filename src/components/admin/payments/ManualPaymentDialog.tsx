/**
 * ManualPaymentDialog — Stage 3R
 *
 * Позволяет админу вручную зафиксировать успешный платёж напрямую в payments_v2
 * (origin='manual_admin') через edge `admin-create-manual-payment` → RPC
 * `admin_create_manual_payment_v1`. Никаких записей в payment_reconcile_queue.
 *
 * После успешного создания сразу открывает `CreateDealFromPaymentDialog`
 * (rawSource='payments_v2') на созданном payment_id для привязки к сделке.
 * Snapshot созданного платежа неизменяем: сумма/валюта/дата передаются в
 * follow-up диалог именно те, что были на момент создания.
 */
import { useEffect, useMemo, useRef, useState } from "react";
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

const CURRENCIES = ["BYN", "RUB", "USD", "EUR", "KZT", "UAH", "PLN"];

interface ManualPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

interface CreatedPaymentSnapshot {
  paymentId: string;
  provider: Provider;
  amount: number;
  currency: string;
  paidAtIso: string;
}

function newIdempotencyKey() {
  return `manual-payment:v2:${crypto.randomUUID()}`;
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
  const [bankName, setBankName] = useState<string>("");
  const [bankDocumentNo, setBankDocumentNo] = useState<string>("");
  const [externalId, setExternalId] = useState<string>("");
  const [purpose, setPurpose] = useState<string>("");
  const [customerEmail, setCustomerEmail] = useState<string>("");
  const [note, setNote] = useState<string>("");

  // Idempotency key рождается вместе с открытием формы; НЕ выводится из бизнес-полей.
  const idempotencyKeyRef = useRef<string>(newIdempotencyKey());

  useEffect(() => {
    if (open) {
      idempotencyKeyRef.current = newIdempotencyKey();
    }
  }, [open]);

  // Immutable snapshot созданного платежа для follow-up диалога.
  const [snapshot, setSnapshot] = useState<CreatedPaymentSnapshot | null>(null);
  const [followUpOpen, setFollowUpOpen] = useState(false);

  const numericAmount = useMemo(() => Number(amount), [amount]);
  const amountInvalid =
    amount.trim() === "" || !Number.isFinite(numericAmount) || numericAmount <= 0;

  const buildPaidAt = (): Date | null => {
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
    setBankName("");
    setBankDocumentNo("");
    setExternalId("");
    setPurpose("");
    setCustomerEmail("");
    setNote("");
    idempotencyKeyRef.current = newIdempotencyKey();
  };

  const handleSubmit = async () => {
    if (amountInvalid) {
      toast.error("Введите положительную сумму");
      return;
    }
    const paidAt = buildPaidAt();
    if (!paidAt) {
      toast.error("Укажите дату платежа");
      return;
    }
    if (provider === "bank" && !bankName.trim()) {
      toast.error("Для банковского платежа укажите название банка");
      return;
    }

    setSaving(true);
    try {
      const paidAtIso = paidAt.toISOString();

      const { data, error } = await supabase.functions.invoke(
        "admin-create-manual-payment",
        {
          body: {
            provider,
            amount: numericAmount,
            currency,
            paidAt: paidAtIso,
            customerEmail: customerEmail.trim() || null,
            bankName: bankName.trim() || null,
            bankDocumentNo: bankDocumentNo.trim() || null,
            externalId: externalId.trim() || null,
            purpose: purpose.trim() || null,
            note: note.trim() || null,
            idempotencyKey: idempotencyKeyRef.current,
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

      // Immutable snapshot: то, что реально попало в payments_v2.
      const paymentSnapshot: CreatedPaymentSnapshot = {
        paymentId: String(data.payment_id),
        provider,
        amount: Number(data.amount) || numericAmount,
        currency: String(data.currency || currency),
        paidAtIso: String(data.paid_at || paidAtIso),
      };
      setSnapshot(paymentSnapshot);

      onOpenChange(false);
      onSuccess();
      // Форму НЕ сбрасываем сейчас — сброс произойдёт при закрытии обоих
      // диалогов (см. handleFollowUpClose ниже). Это защищает follow-up.
      setFollowUpOpen(true);
    } catch (e: any) {
      console.error("Manual payment error:", e);
      toast.error(`Ошибка: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleFollowUpChange = (v: boolean) => {
    setFollowUpOpen(v);
    if (!v) {
      // Follow-up закрыт (создали сделку или отменили) — теперь безопасно
      // сбросить форму и снять snapshot.
      setSnapshot(null);
      resetForm();
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5" />
              Добавить ручной платёж
            </DialogTitle>
            <DialogDescription>
              Создаёт канонический платёж в payments_v2 (origin=manual_admin).
              После этого можно сразу привязать его к сделке.
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

            {provider === "bank" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Название банка</Label>
                  <Input
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="Например: Приорбанк"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>№ банковского документа</Label>
                  <Input
                    value={bankDocumentNo}
                    onChange={(e) => setBankDocumentNo(e.target.value)}
                    placeholder="Платёжное поручение №"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Назначение платежа</Label>
              <Input
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="Оплата по договору №… / за услуги…"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Внешний идентификатор</Label>
                <Input
                  value={externalId}
                  onChange={(e) => setExternalId(e.target.value)}
                  placeholder="Например: RR-2026-000123"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Email плательщика</Label>
                <Input
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="client@example.com"
                />
              </div>
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
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Создать платёж
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/*
        Follow-up: привязка созданного канонического платежа к сделке. Snapshot
        неизменяем и не зависит от resetForm() основной формы.
      */}
      {snapshot && (
        <CreateDealFromPaymentDialog
          open={followUpOpen}
          onOpenChange={handleFollowUpChange}
          paymentId={snapshot.paymentId}
          rawSource="payments_v2"
          amount={snapshot.amount}
          currency={snapshot.currency}
          paidAt={snapshot.paidAtIso}
          onSuccess={() => {
            setFollowUpOpen(false);
            setSnapshot(null);
            resetForm();
            onSuccess();
          }}
        />
      )}
    </>
  );
}
