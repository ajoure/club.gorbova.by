/**
 * InvoiceCheckoutDialog — мультистеп-визард для сценария
 * legal_entity + bank_transfer (invoice-only оффер).
 *
 * Шаги:
 *   1. Auth (inline) — если пользователь ещё не залогинен.
 *   2. Плательщик — выбор из существующих реквизитов ЮЛ/ИП или добавление нового.
 *   3. Подтверждение — сводка «продукт · тариф · плательщик · сумма».
 *   4. Успех — счёт выписан, PDF выгружен, копии ушли на email и в Telegram.
 *
 * Дизайн формы полностью переиспользует OrganizationDetailsForm из настроек
 * (Настройки → Реквизиты для документов). Ничего своего не рисуем — тот же
 * автозаполнитель по УНП через useGrpLookup, тот же StructuredAddressBlock.
 * Физлица здесь исключены — счёт возможен только для ЮЛ/ИП.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLegalDetails, ClientLegalDetails } from "@/hooks/useLegalDetails";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  CheckCircle2,
  FileText,
  Plus,
  ArrowLeft,
  Building2,
  Download,
  Star,
  Copy,
  RefreshCw,
  AlertCircle,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { InlineAuthForm } from "@/components/auth/InlineAuthForm";
import { OrganizationDetailsForm } from "@/components/legal-details/OrganizationDetailsForm";
import { downloadDocumentBlob } from "@/utils/downloadDocumentBlob";
import {
  isDeliveryFinal,
  type DeliveryStatusResponse,
  type ChannelState,
} from "@/lib/invoiceDelivery";

export interface InvoiceCheckoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productName: string;
  tariffName?: string;
  offerId: string;
  addonOfferIds?: string[];
  amount: number;
  currency?: string;
}

type Step = "auth" | "payer" | "confirm" | "success";

interface InvoiceResult {
  invoice_number: string;
  document_number: string | null;
  document_issued_at: string | null;
  order_id: string;
  document_id: string | null;
  pdf_url: string | null;
  email_sent: boolean;
  telegram_sent: boolean;
}


/** Название плательщика для карточки/сводки (в стиле settings/legal-details) */
function getDisplayName(d: ClientLegalDetails): string {
  if (d.client_type === "entrepreneur") {
    return d.ent_name ? `ИП ${d.ent_name}` : "ИП";
  }
  if (d.client_type === "legal_entity") {
    if (d.leg_org_form && d.leg_name) return `${d.leg_org_form} «${d.leg_name}»`;
    return d.leg_name || "Юрлицо";
  }
  return "Плательщик";
}

/** DD.MM.YYYY из ISO строки, либо сегодня. */
function formatDate(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getFullYear()}`;
}

function getUnp(d: ClientLegalDetails): string | null {
  return d.client_type === "entrepreneur" ? d.ent_unp : d.leg_unp;
}

export function InvoiceCheckoutDialog({
  open,
  onOpenChange,
  productId,
  productName,
  tariffName,
  offerId,
  addonOfferIds = [],
  amount,
  currency = "BYN",
}: InvoiceCheckoutDialogProps) {
  const { user, loading: authLoading } = useAuth();
  const [step, setStep] = useState<Step>("auth");
  const [selectedPayerId, setSelectedPayerId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<InvoiceResult | null>(null);

  const {
    legalDetails,
    isLoading: isLoadingLegal,
    createDetails,
    isCreating,
  } = useLegalDetails();

  // Только ЮЛ/ИП — физлица счёт получить не могут.
  const payers = useMemo<ClientLegalDetails[]>(
    () =>
      (legalDetails ?? []).filter(
        (d) => d.client_type === "legal_entity" || d.client_type === "entrepreneur",
      ),
    [legalDetails],
  );

  // Инициализация шага в зависимости от auth.
  useEffect(() => {
    if (!open) return;
    if (authLoading) return;
    if (!user) {
      setStep("auth");
    } else if (step === "auth") {
      setStep("payer");
    }
  }, [open, authLoading, user, step]);

  // Автовыбор default/первого плательщика.
  useEffect(() => {
    if (!payers.length) {
      setSelectedPayerId(null);
      return;
    }
    if (selectedPayerId && payers.find((r) => r.id === selectedPayerId)) return;
    const def = payers.find((r) => r.is_default) ?? payers[0];
    setSelectedPayerId(def?.id ?? null);
  }, [payers, selectedPayerId]);

  const selectedPayer = useMemo(
    () => payers.find((r) => r.id === selectedPayerId) ?? null,
    [payers, selectedPayerId],
  );

  function handleClose(v: boolean) {
    if (submitting) return;
    onOpenChange(v);
    if (!v) {
      setTimeout(() => {
        setStep(user ? "payer" : "auth");
        setShowAddForm(false);
        setResult(null);
      }, 200);
    }
  }

  async function handleAddPayerSubmit(data: Partial<ClientLegalDetails>) {
    try {
      // OrganizationDetailsForm сама выставляет client_type (legal_entity/entrepreneur),
      // так что фильтр списка увидит новую запись сразу.
      const created = await createDetails(data);
      setShowAddForm(false);
      if (created?.id) setSelectedPayerId(created.id);
    } catch (e: any) {
      // toast уже показан в useLegalDetails; на всякий случай логируем
      console.error("[InvoiceCheckoutDialog] create legal details failed", e);
    }
  }

  async function handleIssueInvoice() {
    if (!selectedPayer) {
      toast.error("Выберите плательщика");
      return;
    }
    setSubmitting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        throw new Error(
          "Сессия не найдена. Войдите заново и повторите выпуск счёта.",
        );
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invoice-checkout-issue`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            product_id: productId,
            offer_id: offerId,
            addon_offer_ids: addonOfferIds,
            legal_details_id: selectedPayer.id,
          }),
        },
      );

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          data?.message ||
            data?.error ||
            `Не удалось сформировать счёт (${response.status})`,
        );
      }
      if (!data || (data as any).error) {
        throw new Error((data as any)?.error ?? "invoice_issue_failed");
      }
      setResult(data as InvoiceResult);
      setStep("success");
      toast.success("Счёт сформирован");
    } catch (e: any) {
      console.error("[InvoiceCheckoutDialog] issue failed", e);
      toast.error(e?.message ?? "Не удалось сформировать счёт");
    } finally {
      setSubmitting(false);
    }
  }





  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[720px] max-h-[92vh] max-h-[92dvh] p-0 flex flex-col gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-3 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Счёт на оплату — {productName}
            {tariffName ? ` · ${tariffName}` : ""}
          </DialogTitle>
          <DialogDescription>
            Оплата по банковскому реквизиту для юридического лица или ИП
          </DialogDescription>
        </DialogHeader>

        {step === "auth" && (
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <InlineAuthForm
              contextNote="Чтобы выписать счёт, войдите или зарегистрируйтесь"
              onAuthenticated={() => setStep("payer")}
            />
          </div>
        )}

        {step === "payer" && !showAddForm && (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {isLoadingLegal ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : payers.length === 0 ? (
                <Card className="p-6 text-center space-y-3">
                  <Building2 className="h-10 w-10 mx-auto text-muted-foreground opacity-60" />
                  <div className="text-sm">
                    У вас пока нет реквизитов для выставления счёта. Добавьте
                    организацию или ИП — данные подтянутся автоматически по УНП.
                  </div>
                  <Button onClick={() => setShowAddForm(true)} className="gap-2">
                    <Plus className="h-4 w-4" /> Добавить организацию или ИП
                  </Button>
                </Card>
              ) : (
                <RadioGroup
                  value={selectedPayerId ?? ""}
                  onValueChange={(v) => setSelectedPayerId(v)}
                  className="space-y-2"
                >
                  {payers.map((row) => {
                    const unp = getUnp(row);
                    return (
                      <Card key={row.id} className="p-3">
                        <label className="flex items-start gap-3 cursor-pointer">
                          <RadioGroupItem value={row.id} className="mt-1" />
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 font-medium">
                              <Building2 className="h-4 w-4 shrink-0" />
                              <span className="truncate">{getDisplayName(row)}</span>
                              {row.is_default && (
                                <Badge variant="secondary" className="gap-1">
                                  <Star className="h-3 w-3" /> Основной
                                </Badge>
                              )}
                              <Badge variant="outline">
                                {row.client_type === "entrepreneur" ? "ИП" : "Юрлицо"}
                              </Badge>
                            </div>
                            {unp && (
                              <div className="text-xs text-muted-foreground mt-1">
                                УНП {unp}
                              </div>
                            )}
                          </div>
                        </label>
                      </Card>
                    );
                  })}
                </RadioGroup>
              )}
            </div>
            {payers.length > 0 && (
              <div className="shrink-0 border-t bg-background px-6 py-3 flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setShowAddForm(true)}>
                  <Plus className="h-4 w-4 mr-1" /> Добавить организацию или ИП
                </Button>
                <Button
                  className="ml-auto"
                  disabled={!selectedPayerId}
                  onClick={() => setStep("confirm")}
                >
                  Далее
                </Button>
              </div>
            )}
          </>
        )}

        {step === "payer" && showAddForm && (
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAddForm(false)}
                disabled={isCreating}
              >
                <ArrowLeft className="h-4 w-4 mr-1" /> Назад к выбору
              </Button>
              <div className="text-sm text-muted-foreground">
                Добавить организацию или ИП
              </div>
            </div>
            <Card className="p-4">
              <OrganizationDetailsForm
                initialData={null}
                onSubmit={handleAddPayerSubmit}
                isSubmitting={isCreating}
                showDemoOnEmpty
              />
            </Card>
          </div>
        )}

        {step === "confirm" && selectedPayer && (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <Card className="p-4 space-y-3">
                <div className="text-sm">
                  <div className="text-muted-foreground">Продукт</div>
                  <div className="font-medium">
                    {productName}
                    {tariffName ? ` · ${tariffName}` : ""}
                  </div>
                </div>
                <div className="text-sm">
                  <div className="text-muted-foreground">Плательщик</div>
                  <div className="font-medium">{getDisplayName(selectedPayer)}</div>
                  {getUnp(selectedPayer) && (
                    <div className="text-xs text-muted-foreground">
                      УНП {getUnp(selectedPayer)}
                    </div>
                  )}
                </div>
                <div className="text-sm">
                  <div className="text-muted-foreground">К оплате</div>
                  <div className="font-medium text-lg">
                    {amount} {currency}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground pt-2 border-t">
                  После нажатия кнопки будет создан заказ, сформирован PDF-счёт
                  и отправлен на email плательщика (а также в Telegram, если он привязан).
                </div>
              </Card>
            </div>
            <div className="shrink-0 border-t bg-background px-6 py-3 flex gap-2">
              <Button
                variant="outline"
                onClick={() => setStep("payer")}
                disabled={submitting}
              >
                <ArrowLeft className="h-4 w-4 mr-1" /> Назад
              </Button>
              <Button
                className="ml-auto"
                onClick={handleIssueInvoice}
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Формируем счёт…
                  </>
                ) : (
                  "Сформировать счёт"
                )}
              </Button>
            </div>
          </>
        )}

        {step === "success" && result && (
          <InvoiceDeliverySuccess
            documentId={result.document_id}
            invoiceNumber={result.invoice_number}
            documentNumber={result.document_number}
            documentIssuedAt={result.document_issued_at}
            onClose={() => handleClose(false)}
          />
        )}

      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// InvoiceDeliverySuccess — success-экран визарда. Показывает раздельные
// статусы: PDF, email, Telegram. PDF-кнопка активна только когда бэкенд
// подтвердил pdf_ready. По каждому каналу видно queued / sent / error /
// not_linked / no_recipient. Retry-кнопка появляется только для error.
//
// Polling — invoice-delivery-status раз в 3 с, до 40 попыток (~2 мин). Как
// только оба канала перешли в финальное состояние и PDF готов — polling
// останавливается.
// ============================================================================

interface DeliverySuccessProps {
  documentId: string | null;
  invoiceNumber: string;
  documentNumber: string | null;
  documentIssuedAt: string | null;
  onClose: () => void;
}

function InvoiceDeliverySuccess({
  documentId,
  invoiceNumber,
  documentNumber,
  documentIssuedAt,
  onClose,
}: DeliverySuccessProps) {
  const displayNumber = documentNumber ?? invoiceNumber;
  const displayDate = formatDate(documentIssuedAt);
  const purposeText = `Оплата по счёту №${displayNumber} от ${displayDate}`;

  const [status, setStatus] = useState<DeliveryStatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [retrying, setRetrying] = useState<"email" | "telegram" | null>(null);

  const canPoll = !!documentId;

  const pollTick = async (): Promise<DeliveryStatusResponse | null> => {
    if (!documentId) return null;
    try {
      const { data, error } = await supabase.functions.invoke(
        "invoice-delivery-status",
        { body: { document_id: documentId } },
      );
      if (error) {
        setStatusError(error.message || "status_error");
        return null;
      }
      setStatusError(null);
      setStatus(data as DeliveryStatusResponse);
      return data as DeliveryStatusResponse;
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "status_error");
      return null;
    }
  };

  useEffect(() => {
    if (!canPoll) return;
    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 40; // ~2 минуты при 3 с интервале
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      if (cancelled) return;
      attempts += 1;
      const fresh = await pollTick();
      if (cancelled) return;
      if (fresh && isDeliveryFinal(fresh)) return;
      if (attempts >= MAX_ATTEMPTS) return;
      timer = setTimeout(loop, 3000);
    };
    loop();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);



  async function handleDownload() {
    if (!documentId || !status?.pdf_ready) return;
    setDownloading(true);
    try {
      const r = await downloadDocumentBlob(documentId, "pdf");
      if (r.ok === false) toast.error(r.message);
      else toast.success("Скачивание началось");
    } finally {
      setDownloading(false);
    }
  }

  async function handleRetry(channel: "email" | "telegram") {
    if (!documentId) return;
    setRetrying(channel);
    try {
      const { data, error } = await supabase.functions.invoke(
        "invoice-delivery-retry",
        { body: { document_id: documentId, channel } },
      );
      if (error) {
        toast.error(error.message || "Не удалось повторить отправку");
      } else if ((data as any)?.already_sent) {
        toast.success("Уже отправлено");
      } else if ((data as any)?.ok) {
        toast.success(
          channel === "email" ? "Email отправлен повторно" : "Отправлено в Telegram",
        );
      } else {
        toast.error(
          `Ошибка: ${(data as any)?.error || "неизвестно"}`,
        );
      }
      await pollTick();
    } finally {
      setRetrying(null);
    }
  }

  // Если бэкенд не вернул document_id — PDF не сформирован.
  if (!documentId) {
    return (
      <>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 text-center">
          <div className="flex justify-center">
            <AlertCircle className="h-12 w-12 text-amber-500" />
          </div>
          <div>
            <div className="text-lg font-semibold">
              Счёт № {displayNumber} создан, но PDF не удалось сформировать
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              Заказ в системе есть. Свяжитесь с поддержкой — мы вышлем PDF вручную.
            </div>
          </div>
        </div>
        <div className="shrink-0 border-t bg-background px-6 py-3 flex">
          <Button className="ml-auto" onClick={onClose}>Готово</Button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <CheckCircle2 className="h-12 w-12 text-green-600" />
          </div>
          <div className="text-lg font-semibold">
            Счёт № {displayNumber} сформирован
          </div>
          <div className="text-sm text-muted-foreground">
            PDF готовится и рассылается на email/в Telegram. Статусы обновляются автоматически.
          </div>
        </div>

        {/* Каналы доставки */}
        <div className="space-y-2">
          <DeliveryRow
            label="PDF-документ"
            state={
              !status
                ? { kind: "pending", text: "Готовим…" }
                : status.pdf_ready
                  ? { kind: "success", text: "Готов к скачиванию" }
                  : { kind: "pending", text: "Формируется…" }
            }
          />
          <DeliveryRow
            label="Email"
            state={renderRow("email", status?.delivery.email)}
            action={
              status?.delivery.email.status === "error"
                ? {
                    label: retrying === "email" ? "…" : "Повторить",
                    onClick: () => handleRetry("email"),
                    disabled: !!retrying,
                  }
                : null
            }
          />
          <DeliveryRow
            label="Telegram"
            state={renderRow("telegram", status?.delivery.telegram)}
            action={
              status?.delivery.telegram.status === "error"
                ? {
                    label: retrying === "telegram" ? "…" : "Повторить",
                    onClick: () => handleRetry("telegram"),
                    disabled: !!retrying,
                  }
                : null
            }
          />
        </div>

        {statusError && (
          <div className="text-xs text-amber-600 text-center">
            Не удалось получить статус: {statusError}. Повторим автоматически.
          </div>
        )}

        <Card className="p-3 text-left text-sm bg-muted/40">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <div className="text-muted-foreground text-xs uppercase tracking-wide mb-1">
                При оплате в назначении платежа укажите
              </div>
              <div className="font-medium break-words select-all">
                {purposeText}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(purposeText);
                  toast.success("Скопировано");
                } catch {
                  toast.error("Не удалось скопировать");
                }
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      </div>
      <div className="shrink-0 border-t bg-background px-6 py-3 flex flex-col sm:flex-row gap-2">
        <Button
          variant="outline"
          disabled={!status?.pdf_ready || downloading}
          onClick={handleDownload}
        >
          {downloading ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : status?.pdf_ready ? (
            <Download className="h-4 w-4 mr-1" />
          ) : (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          )}
          {status?.pdf_ready ? "Скачать PDF" : "PDF готовится…"}
        </Button>
        <Button className="sm:ml-auto" onClick={onClose}>Готово</Button>
      </div>
    </>
  );
}

type RowState =
  | { kind: "success"; text: string }
  | { kind: "pending"; text: string }
  | { kind: "error"; text: string; detail?: string | null }
  | { kind: "muted"; text: string };

function renderRow(
  channel: "email" | "telegram",
  state?: import("@/lib/invoiceDelivery").ChannelState,
): RowState {
  if (!state) return { kind: "pending", text: "Готовим…" };
  switch (state.status) {
    case "sent":
      return {
        kind: "success",
        text: channel === "email" ? "Отправлено на email" : "Отправлено в Telegram",
      };
    case "queued":
      return { kind: "pending", text: "В очереди…" };
    case "error":
      return {
        kind: "error",
        text: channel === "email" ? "Ошибка отправки email" : "Ошибка отправки в Telegram",
        detail: state.error,
      };
    case "not_linked":
      return { kind: "muted", text: "Telegram не привязан" };
    case "no_recipient":
      return { kind: "muted", text: "Нет email-адреса" };
    default:
      return { kind: "muted", text: "—" };
  }
}

function DeliveryRow({
  label,
  state,
  action,
}: {
  label: string;
  state: RowState;
  action?: { label: string; onClick: () => void; disabled?: boolean } | null;
}) {
  const iconCls = "h-4 w-4 shrink-0";
  const icon =
    state.kind === "success" ? (
      <CheckCircle2 className={`${iconCls} text-green-600`} />
    ) : state.kind === "pending" ? (
      <Loader2 className={`${iconCls} animate-spin text-muted-foreground`} />
    ) : state.kind === "error" ? (
      <XCircle className={`${iconCls} text-destructive`} />
    ) : (
      <AlertCircle className={`${iconCls} text-muted-foreground`} />
    );
  return (
    <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm">
      {icon}
      <div className="flex-1 min-w-0">
        <div className="font-medium">{label}</div>
        <div
          className={
            state.kind === "error"
              ? "text-destructive text-xs truncate"
              : "text-muted-foreground text-xs truncate"
          }
        >
          {state.text}
          {state.kind === "error" && state.detail ? ` · ${state.detail}` : ""}
        </div>
      </div>
      {action && (
        <Button
          size="sm"
          variant="outline"
          onClick={action.onClick}
          disabled={action.disabled}
        >
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> {action.label}
        </Button>
      )}
    </div>
  );
}

