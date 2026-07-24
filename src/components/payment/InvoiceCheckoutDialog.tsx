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
  FileText,
  Plus,
  ArrowLeft,
  Building2,
  Star,
} from "lucide-react";
import { toast } from "sonner";

import { InlineAuthForm } from "@/components/auth/InlineAuthForm";
import { OrganizationDetailsForm } from "@/components/legal-details/OrganizationDetailsForm";
import { OrderSummary, type OrderSummaryLine } from "@/components/checkout/OrderSummary";
import { InvoiceDeliverySuccess } from "@/components/payment/InvoiceDeliverySuccess";

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
  const [quoteItems, setQuoteItems] = useState<OrderSummaryLine[]>([]);
  const [quoteCurrency, setQuoteCurrency] = useState<string>(currency);
  const [quoteTotal, setQuoteTotal] = useState<number | null>(null);

  // Immutable snapshot состава заказа — читается один раз при открытии диалога
  // и переживает переключение шагов Back/Forward.
  useEffect(() => {
    if (!open || !offerId) return;
    let active = true;
    void supabase.functions.invoke("composable-checkout-quote", {
      body: { parent_offer_id: offerId, addon_offer_ids: addonOfferIds },
    }).then(({ data, error }) => {
      if (!active || error || !data || (data as any).error) return;
      const q = data as any;
      const items: OrderSummaryLine[] = (q.items ?? []).map((it: any) => ({
        role: it.role,
        product_name: it.product_name,
        tariff_name: it.tariff_name ?? null,
        list_amount: Number(it.list_amount ?? 0),
        final_amount: Number(it.final_amount ?? 0),
        discount_amount: Number(it.discount_amount ?? 0),
        discount_percent: it.discount_percent ?? null,
        pricing_mode: it.pricing_mode,
      }));
      setQuoteItems(items);
      setQuoteCurrency(String(q.currency ?? currency));
      setQuoteTotal(Number(q.total ?? amount));
    });
    return () => { active = false; };
  }, [open, offerId, JSON.stringify(addonOfferIds), amount, currency]);

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
        <DialogHeader className="px-4 sm:px-6 pt-5 sm:pt-6 pb-3 border-b shrink-0">
          <DialogTitle className="flex items-start gap-2 pr-8 text-base sm:text-lg break-words [overflow-wrap:anywhere]">
            <FileText className="h-5 w-5 shrink-0 mt-0.5" />
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">
              Счёт на оплату — {productName}
              {tariffName ? ` · ${tariffName}` : ""}
            </span>
          </DialogTitle>
          <DialogDescription className="break-words">
            Оплата по банковскому реквизиту для юридического лица или ИП
          </DialogDescription>
        </DialogHeader>

        {step === "auth" && (
          <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 sm:px-6 py-4">
            <InlineAuthForm
              contextNote="Чтобы выписать счёт, войдите или зарегистрируйтесь"
              onAuthenticated={() => setStep("payer")}
            />
          </div>
        )}

        {step === "payer" && !showAddForm && (
          <>
            <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 sm:px-6 py-4 space-y-4">
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
                  <Button onClick={() => setShowAddForm(true)} className="gap-2 w-full sm:w-auto">
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
                      <Card key={row.id} className="p-3 w-full max-w-full overflow-hidden">
                        <label className="flex items-start gap-3 cursor-pointer">
                          <RadioGroupItem value={row.id} className="mt-1 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 font-medium min-w-0">
                              <Building2 className="h-4 w-4 shrink-0" />
                              <span className="min-w-0 break-words [overflow-wrap:anywhere] font-medium">
                                {getDisplayName(row)}
                              </span>
                              {row.is_default && (
                                <Badge variant="secondary" className="gap-1 shrink-0">
                                  <Star className="h-3 w-3" /> Основной
                                </Badge>
                              )}
                              <Badge variant="outline" className="shrink-0">
                                {row.client_type === "entrepreneur" ? "ИП" : "Юрлицо"}
                              </Badge>
                            </div>
                            {unp && (
                              <div className="text-xs text-muted-foreground mt-1 break-words">
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
              <div className="shrink-0 border-t bg-background px-4 sm:px-6 py-3 flex flex-col-reverse sm:flex-row gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowAddForm(true)}
                  className="w-full sm:w-auto"
                >
                  <Plus className="h-4 w-4 mr-1" /> Добавить организацию или ИП
                </Button>
                <Button
                  className="w-full sm:w-auto sm:ml-auto"
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
              <OrderSummary
                items={
                  quoteItems.length > 0
                    ? quoteItems
                    : [{
                        role: "primary",
                        product_name: productName,
                        tariff_name: tariffName ?? null,
                        list_amount: amount,
                        final_amount: amount,
                      }]
                }
                currency={quoteCurrency || currency}
                total={quoteTotal ?? amount}
                payerLabel={
                  `${getDisplayName(selectedPayer)}${
                    getUnp(selectedPayer) ? ` · УНП ${getUnp(selectedPayer)}` : ""
                  }`
                }
                paymentMethodLabel="Счёт на юрлицо / ИП"
              />
              <Card className="p-3 text-xs text-muted-foreground">
                После нажатия кнопки будет создан заказ и сформирован PDF-счёт.
                Копии на email и в Telegram уходят автоматически после готовности PDF;
                статусы доставки вы увидите на следующем экране.
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
            orderId={result.order_id}
            onDocumentReady={(r) =>
              setResult((prev) =>
                prev
                  ? {
                      ...prev,
                      document_id: r.document_id,
                      document_number: r.document_number ?? prev.document_number,
                      document_issued_at:
                        r.document_issued_at ?? prev.document_issued_at,
                    }
                  : prev,
              )
            }
            onClose={() => handleClose(false)}
          />

        )}

      </DialogContent>
    </Dialog>
  );
}

