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
} from "lucide-react";
import { toast } from "sonner";
import { InlineAuthForm } from "@/components/auth/InlineAuthForm";
import { OrganizationDetailsForm } from "@/components/legal-details/OrganizationDetailsForm";
import { downloadDocumentBlob } from "@/utils/downloadDocumentBlob";

export interface InvoiceCheckoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productName: string;
  tariffName?: string;
  offerId: string;
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

  /** DD.MM.YYYY из ISO строки, либо сегодня. */
  function formatDate(iso?: string | null): string {
    const d = iso ? new Date(iso) : new Date();
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}.${mm}.${d.getFullYear()}`;
  }


  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[720px] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
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
          <div className="pt-2">
            <InlineAuthForm
              contextNote="Чтобы выписать счёт, войдите или зарегистрируйтесь"
              onAuthenticated={() => setStep("payer")}
            />
          </div>
        )}

        {step === "payer" && !showAddForm && (
          <div className="space-y-4 pt-2">
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
              <>
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

                <div className="flex flex-wrap gap-2 pt-2">
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
              </>
            )}
          </div>
        )}

        {step === "payer" && showAddForm && (
          <div className="space-y-4 pt-2">
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
          <div className="space-y-4 pt-2">
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

            <div className="flex gap-2">
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
          </div>
        )}

        {step === "success" && result && (
          <div className="space-y-4 pt-2 text-center">
            <div className="flex justify-center">
              <CheckCircle2 className="h-12 w-12 text-green-600" />
            </div>
            <div>
              <div className="text-lg font-semibold">
                Счёт № {result.invoice_number} сформирован
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                Отправка на email и в Telegram запущена и придёт в течение
                нескольких минут. Также PDF можно скачать сразу.
              </div>
            </div>
            <Card className="p-3 text-left text-sm bg-muted/40">
              <div className="text-muted-foreground text-xs uppercase tracking-wide mb-1">
                При оплате в назначении платежа укажите
              </div>
              <div className="font-medium break-words">
                «Оплата по счёту №{result.invoice_number} от {formatToday()}»
              </div>
            </Card>
            {result.document_id && (
              <Button
                variant="outline"
                onClick={async () => {
                  const r = await downloadDocumentBlob(result.document_id!, "pdf");
                  if (r.ok === false) {
                    toast.error(r.message);
                  } else {
                    toast.success("Скачивание началось");
                  }
                }}
              >
                <Download className="h-4 w-4 mr-1" /> Скачать PDF
              </Button>
            )}
            <Button className="w-full" onClick={() => handleClose(false)}>
              Готово
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
