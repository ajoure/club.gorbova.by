/**
 * ManualPaymentDialog — Stage 3R.1
 *
 * Ручной платёж напрямую в payments_v2 (origin='manual_admin') через RPC
 * `admin_create_manual_payment_v1`. Дизайн повторяет AdminPaymentLinkDialog:
 * иконка+заголовок, секции с Label + мягкой рамкой, DateTimePicker, DialogFooter.
 *
 * Режимы:
 *   A. без контакта и без сделки       → standalone
 *   B. только контакт                   → profile_id заполняется, order_id NULL
 *   C. контакт + существующая сделка   → атомарно на сервере (lock + recalc)
 *
 * Follow-up «создать сделку» открывается только в режимах A/B (когда
 * существующая сделка не выбрана).
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
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Landmark,
  Loader2,
  Wallet,
  User as UserIcon,
  Layers,
  X,
  CreditCard,
  Building2,
  Pencil,
} from "lucide-react";
import { CreateDealFromPaymentDialog } from "./CreateDealFromPaymentDialog";
import { normalizeEdgeFunctionErrorAsync } from "@/utils/normalizeEdgeFunctionError";
import { invokeAuthenticatedFunction } from "@/utils/invokeAuthenticatedFunction";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import {
  ContactPickerDialog,
  type PickedContact,
} from "@/components/admin/shared/pickers/ContactPickerDialog";
import {
  DealPickerDialog,
  type PickedDeal,
} from "@/components/admin/shared/pickers/DealPickerDialog";

import {
  ACTIVE_PAYMENT_PROVIDERS,
  PAYMENT_PROVIDER_LABELS,
  type ActivePaymentProvider,
} from "@/lib/payments/providers";

type Provider = ActivePaymentProvider;

// Stage 5: единый источник — allowlist + labels из @/lib/payments/providers.
// Локально задаются только иконки, специфичные для UI-компонента.
const PROVIDER_ICONS: Record<Provider, React.ReactNode> = {
  bepaid: <CreditCard className="h-3.5 w-3.5 opacity-70" />,
  stripe: <CreditCard className="h-3.5 w-3.5 opacity-70" />,
  rr: <Wallet className="h-3.5 w-3.5 opacity-70" />,
  bank: <Landmark className="h-3.5 w-3.5 opacity-70" />,
};

const PROVIDERS: Array<{ value: Provider; label: string; icon: React.ReactNode }> =
  ACTIVE_PAYMENT_PROVIDERS.map((value) => ({
    value,
    label: PAYMENT_PROVIDER_LABELS[value],
    icon: PROVIDER_ICONS[value],
  }));

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
  profileId: string | null;
  hadOrder: boolean;
}

interface ManualPaymentResponse {
  ok: boolean;
  error?: string;
  detail?: { order_currency?: string } | null;
  payment_written?: boolean;
  downstream_complete?: boolean;
  downstream_retryable?: boolean;
  idempotent_replay?: boolean;
  payment_id?: string;
  amount?: number;
  currency?: string;
  paid_at?: string;
  profile_id?: string | null;
  fulfillment?: {
    state?: string;
    error_code?: string;
  };
  crm_stage?: {
    applied?: boolean;
    reason?: string;
  };
}

function newIdempotencyKey() {
  return `manual-payment:v3:${crypto.randomUUID()}`;
}

export function ManualPaymentDialog({
  open,
  onOpenChange,
  onSuccess,
}: ManualPaymentDialogProps) {
  const [saving, setSaving] = useState(false);
  const [retryPending, setRetryPending] = useState(false);
  const [retryPaymentId, setRetryPaymentId] = useState<string | null>(null);
  const [provider, setProvider] = useState<Provider>("bank");
  const [amount, setAmount] = useState<string>("");
  const [currency, setCurrency] = useState<string>("BYN");
  const [paidAtDate, setPaidAtDate] = useState<Date | undefined>(() => new Date());
  const [paidAtTime, setPaidAtTime] = useState<string>(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });
  const [receivingBank, setReceivingBank] = useState<string>("");
  const [comment, setComment] = useState<string>("");

  // Optional links
  const [contact, setContact] = useState<PickedContact | null>(null);
  const [deal, setDeal] = useState<PickedDeal | null>(null);

  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [dealPickerOpen, setDealPickerOpen] = useState(false);

  const idempotencyKeyRef = useRef<string>(newIdempotencyKey());

  useEffect(() => {
    if (open) {
      idempotencyKeyRef.current = newIdempotencyKey();
      setRetryPending(false);
      setRetryPaymentId(null);
    }
  }, [open]);

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
    setReceivingBank("");
    setComment("");
    setContact(null);
    setDeal(null);
    setRetryPending(false);
    setRetryPaymentId(null);
    idempotencyKeyRef.current = newIdempotencyKey();
  };

  // Deal selected → auto-adopt its contact + currency
  const handleDealPicked = (picked: PickedDeal) => {
    setDeal(picked);
    setDealPickerOpen(false);
    if (picked.currency) setCurrency(picked.currency);
    if (picked.profile_id && (!contact || contact.id !== picked.profile_id)) {
      setContact({
        id: picked.profile_id,
        user_id: picked.user_id,
        full_name: picked.contact_name ?? null,
        email: picked.contact_email ?? null,
        phone: picked.contact_phone ?? null,
      });
    }
  };

  const handleContactPicked = (picked: PickedContact) => {
    // Guard: если уже выбрана сделка с другим контактом — блокируем.
    if (deal && deal.profile_id && deal.profile_id !== picked.id) {
      toast.error("Выбранный контакт не совпадает с контактом сделки");
      return;
    }
    setContact(picked);
    setContactPickerOpen(false);
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
    if (provider === "bank" && !receivingBank.trim()) {
      toast.error("Укажите банк зачисления");
      return;
    }

    setSaving(true);
    try {
      const paidAtIso = paidAt.toISOString();

      const { data, error } = await invokeAuthenticatedFunction<ManualPaymentResponse>(
        "admin-create-manual-payment",
        {
          provider,
          amount: numericAmount,
          currency,
          paidAt: paidAtIso,
          profileId: contact?.id ?? null,
          orderId: deal?.id ?? null,
          receivingBankName: provider === "bank" ? receivingBank.trim() : null,
          comment: comment.trim() || null,
          contactNameSnapshot: contact?.full_name || contact?.email || null,
          orderNumberSnapshot: deal?.order_number || null,
          idempotencyKey: idempotencyKeyRef.current,
        },
      );

      if (error || !data?.ok) {
        // Stage 3R.2: явные тексты для новых серверных кодов.
        const code = String(data?.error ?? "");
        const localized: Record<string, string> = {
          order_currency_conflict:
            `Валюта платежа (${currency}) не совпадает с валютой сделки${
              data?.detail?.order_currency
                ? ` (${data.detail.order_currency})`
                : ""
            }.`,
          order_profile_conflict:
            "Выбранный контакт не совпадает с контактом сделки.",
          missing_receiving_bank_name: "Укажите банк зачисления.",
          receiving_bank_name_too_long:
            "Название банка слишком длинное (максимум 120 символов).",
          idempotency_conflict:
            "Платёж с таким ключом уже создан с другими данными.",
          order_already_fully_paid:
            "Эта сделка уже полностью оплачена. Новый платёж не создан.",
        };
        const normalized = await normalizeEdgeFunctionErrorAsync(
          error ?? data,
          data ?? undefined,
        );
        const msg =
          localized[code] ??
          (normalized && normalized !== "null" && normalized !== "undefined"
            ? normalized
            : "Не удалось создать ручной платёж");
        toast.error(msg);
        return;
      }

      const hasDownstreamWarning =
        data.payment_written === true && data.downstream_complete === false;
      if (hasDownstreamWarning) {
        const code = data.fulfillment?.error_code;
        const message = code
          ? "Платёж создан, но последующая обработка не завершена."
          : "Платёж создан, но сделка не перешла в настроенную успешную стадию.";
        if (data.downstream_retryable) {
          const createdPaymentId = data.payment_id ? String(data.payment_id) : null;
          if (!createdPaymentId) {
            toast.error(
              "Платёж создан, но сервер не вернул его ID. Повторная обработка заблокирована, чтобы не создать дубль.",
            );
            setRetryPending(false);
            setRetryPaymentId(null);
            onSuccess();
            return;
          }
          toast.warning(
            `${message} Нажмите «Повторить обработку»: будет продолжена только обработка уже созданного платежа.`,
          );
          setRetryPending(true);
          setRetryPaymentId(createdPaymentId);
          onSuccess();
          return;
        }
        toast.warning(`${message} Проверьте настройки кнопки оплаты.`);
        setRetryPending(false);
        setRetryPaymentId(null);
      }

      if (!hasDownstreamWarning && data.idempotent_replay) {
        toast.info("Платёж уже был зарегистрирован ранее");
      } else if (!hasDownstreamWarning) {
        toast.success("Ручной платёж создан");
      }

      const paymentSnapshot: CreatedPaymentSnapshot = {
        paymentId: String(data.payment_id),
        provider,
        amount: Number(data.amount) || numericAmount,
        currency: String(data.currency || currency),
        paidAtIso: String(data.paid_at || paidAtIso),
        profileId: (data.profile_id as string | null) ?? contact?.id ?? null,
        hadOrder: !!deal?.id,
      };
      setSnapshot(paymentSnapshot);

      onOpenChange(false);
      onSuccess();

      // Follow-up «создать сделку» — только если сделка не была выбрана.
      if (!deal?.id) {
        setFollowUpOpen(true);
      } else {
        // Уже привязан к существующей сделке — сразу сброс.
        setSnapshot(null);
        resetForm();
      }
    } catch (e: unknown) {
      console.error("Manual payment error:", e);
      toast.error(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleRetryDownstream = async () => {
    if (!retryPaymentId || saving) return;
    setSaving(true);
    try {
      const { data, error } = await invokeAuthenticatedFunction<ManualPaymentResponse>(
        "admin-retry-manual-payment-downstream",
        { paymentId: retryPaymentId },
      );
      if (error || !data?.ok) {
        const normalized = await normalizeEdgeFunctionErrorAsync(
          error ?? data,
          data ?? undefined,
        );
        toast.error(
          normalized && normalized !== "null" && normalized !== "undefined"
            ? normalized
            : "Не удалось завершить обработку уже созданного платежа",
        );
        return;
      }
      if (data.downstream_complete === false) {
        toast.warning(
          "Платёж не дублировался, но последующая обработка всё ещё не завершена. Ошибка сохранена для диагностики.",
        );
        return;
      }

      toast.success("Обработка платежа завершена: сделка и доступы обновлены");
      setRetryPending(false);
      setRetryPaymentId(null);
      onOpenChange(false);
      onSuccess();
      setSnapshot(null);
      resetForm();
    } catch (e: unknown) {
      toast.error(
        `Ошибка: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setSaving(false);
    }
  };

  const handleFollowUpChange = (v: boolean) => {
    setFollowUpOpen(v);
    if (!v) {
      setSnapshot(null);
      resetForm();
    }
  };

  const contactDisplayName =
    contact?.full_name || contact?.email || contact?.phone || "";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[560px] overflow-x-hidden overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex min-w-0 items-center gap-2 pr-8">
              <Wallet className="h-5 w-5 shrink-0 text-primary" />
              <span className="min-w-0 break-words">Добавить ручной платёж</span>
            </DialogTitle>
            <DialogDescription>
              Платёж будет создан напрямую в реестре платежей. Контакт и сделку
              можно привязать сразу или позже.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Provider + Date */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Провайдер</Label>
                <Select
                  value={provider}
                  onValueChange={(v) => setProvider(v as Provider)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        <span className="flex items-center gap-2">
                          {p.icon}
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

            {/* Amount + Currency */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

            {/* Bank of receipt — only for provider=bank */}
            {provider === "bank" && (
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 opacity-70" />
                  Банк зачисления
                </Label>
                <Input
                  value={receivingBank}
                  onChange={(e) => setReceivingBank(e.target.value)}
                  placeholder="Например: Паритетбанк"
                />
                <p className="text-[11px] text-muted-foreground">
                  Наш банк-получатель средств. Отобразится в поле «Плательщик».
                </p>
              </div>
            )}

            {/* Contact picker */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <UserIcon className="h-3.5 w-3.5 opacity-70" />
                Контакт
                <span className="text-[11px] text-muted-foreground">
                  (необязательно)
                </span>
              </Label>
              {contact ? (
                <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border bg-muted/30 p-2">
                  <UserIcon className="h-4 w-4 shrink-0 text-green-500" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {contactDisplayName || "Контакт выбран"}
                    </div>
                    {contact.email ? (
                      <div className="truncate text-xs text-muted-foreground">
                        {contact.email}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {contact.user_id ? null : (
                      <Badge variant="outline" className="hidden text-[10px] sm:inline-flex">Ghost</Badge>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-9 w-9 px-0 sm:w-auto sm:px-3"
                      onClick={() => setContactPickerOpen(true)}
                      aria-label="Изменить контакт"
                    >
                      <Pencil className="h-4 w-4 sm:hidden" />
                      <span className="hidden sm:inline">Изменить</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-9 w-9 px-0 sm:w-auto sm:px-3"
                      onClick={() => {
                        setContact(null);
                        // Stage 3R.2: если контакт снимают, но сделка привязана к нему —
                        // также снимаем сделку, чтобы не оставлять некорректное состояние.
                        if (deal) setDeal(null);
                      }}
                      aria-label="Убрать контакт"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full min-w-0 justify-start overflow-hidden"
                  onClick={() => setContactPickerOpen(true)}
                >
                  <UserIcon className="mr-2 h-4 w-4" />
                  <span className="truncate">Найти контакт по имени</span>
                </Button>
              )}
            </div>

            {/* Deal picker */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 opacity-70" />
                Сделка
                <span className="text-[11px] text-muted-foreground">
                  (необязательно)
                </span>
              </Label>
              {deal ? (
                <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border bg-muted/30 p-2">
                  <Layers className="h-4 w-4 shrink-0 text-indigo-500" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {deal.contact_name || "Без контакта"}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {(deal.product_name ?? "—") + " · "}
                      {deal.order_number || deal.id.slice(0, 8)} ·{" "}
                      {deal.final_price} {deal.currency}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-9 w-9 px-0 sm:w-auto sm:px-3"
                      onClick={() => setDealPickerOpen(true)}
                      aria-label="Изменить сделку"
                    >
                      <Pencil className="h-4 w-4 sm:hidden" />
                      <span className="hidden sm:inline">Изменить</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-9 w-9 px-0"
                      onClick={() => setDeal(null)}
                      aria-label="Убрать сделку"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full min-w-0 justify-start overflow-hidden"
                  onClick={() => setDealPickerOpen(true)}
                >
                  <Layers className="mr-2 h-4 w-4" />
                  <span className="truncate">Найти существующую сделку</span>
                </Button>
              )}
            </div>

            {/* Comment */}
            <div className="space-y-1.5">
              <Label>Комментарий</Label>
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Основание, реквизиты, комментарий бухгалтера…"
                rows={2}
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:space-x-0">
            <Button
              className="w-full sm:w-auto"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Отмена
            </Button>
            <Button
              className="w-full sm:w-auto"
              onClick={retryPending ? handleRetryDownstream : handleSubmit}
              disabled={saving || (retryPending ? !retryPaymentId : amountInvalid)}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {retryPending ? "Повторить обработку" : "Создать платёж"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ContactPickerDialog
        open={contactPickerOpen}
        onOpenChange={setContactPickerOpen}
        onPick={handleContactPicked}
        options={{ title: "Выбрать контакт", searchMode: "name_only" }}
      />

      <DealPickerDialog
        open={dealPickerOpen}
        onOpenChange={setDealPickerOpen}
        onPick={handleDealPicked}
        options={{
          title: "Выбрать существующую сделку",
          amount: numericAmount > 0 ? numericAmount : undefined,
          currency,
          profileId: contact?.id ?? null,
          contactSearchMode: "name_only",
        }}
        footerExtras={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-2 text-muted-foreground"
            onClick={() => {
              setDeal(null);
              setDealPickerOpen(false);
              toast.info(
                "После создания платежа откроется мастер создания новой сделки",
              );
            }}
          >
            + Создать сделку
          </Button>
        }
        emptyStateExtras={
          <div className="space-y-3">
            <p>Нет сделок</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-2 text-muted-foreground"
              onClick={() => {
                setDeal(null);
                setDealPickerOpen(false);
                toast.info(
                  "После создания платежа откроется мастер создания новой сделки",
                );
              }}
            >
              + Создать сделку
            </Button>
          </div>
        }
      />

      {/*
        Follow-up: привязка standalone/contact-only платежа к новой сделке.
        Открывается только если существующая сделка не была выбрана.
      */}
      {snapshot && !snapshot.hadOrder && (
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
