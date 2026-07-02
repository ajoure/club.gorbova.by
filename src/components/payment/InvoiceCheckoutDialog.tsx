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
 * Никаких новых полей в настройках оффера не создаём — визард поднимается,
 * когда SitePageBySlug детектит invoice-only оффер (см. src/lib/invoiceCheckout.ts).
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRequisitesV2, LegalEntityRequisitesRow } from "@/hooks/useRequisitesV2";
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
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, FileText, Plus, ArrowLeft, Building2, Download } from "lucide-react";
import { toast } from "sonner";
import { InlineAuthForm } from "@/components/auth/InlineAuthForm";
import { LegalEntityRequisitesForm } from "@/components/requisites-v2/LegalEntityRequisitesForm";

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
  order_id: string;
  pdf_url: string | null;
  email_sent: boolean;
  telegram_sent: boolean;
}

function payerLabel(row: LegalEntityRequisitesRow): string {
  const d = (row.data ?? {}) as Record<string, string | undefined>;
  const name = d.short_name || d.name || "Без названия";
  const unp = d.unp ? ` · УНП ${d.unp}` : "";
  const kind = row.subject_type === "entrepreneur" ? "ИП" : "ЮЛ";
  return `${kind}: ${name}${unp}`;
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

  const requisites = useRequisitesV2({ scope: "user_requisites" });
  const legalRows = (requisites.legalEntities ?? []) as LegalEntityRequisitesRow[];
  const isLoadingRequisites = requisites.isLoading;

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
    if (!legalRows.length) return;
    if (selectedPayerId && legalRows.find((r) => r.id === selectedPayerId)) return;
    const def = legalRows.find((r) => r.is_default) ?? legalRows[0];
    setSelectedPayerId(def?.id ?? null);
  }, [legalRows, selectedPayerId]);

  const selectedPayer = useMemo(
    () => legalRows.find((r) => r.id === selectedPayerId) ?? null,
    [legalRows, selectedPayerId],
  );

  function handleClose(v: boolean) {
    if (submitting) return;
    onOpenChange(v);
    if (!v) {
      // сброс состояния
      setTimeout(() => {
        setStep(user ? "payer" : "auth");
        setShowAddForm(false);
        setResult(null);
      }, 200);
    }
  }

  async function handleAddPayerSubmit(values: { data: Record<string, unknown>; is_default: boolean }) {
    try {
      const created = await requisites.createLegalEntity.mutateAsync({
        subject_type: "legal_entity",
        data: values.data,
        is_default: values.is_default,
      });
      setShowAddForm(false);
      if (created?.id) setSelectedPayerId(created.id);
    } catch (e: any) {
      toast.error(e?.message ?? "Не удалось сохранить реквизиты");
    }
  }

  async function handleIssueInvoice() {
    if (!selectedPayer) {
      toast.error("Выберите плательщика");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("invoice-checkout-issue", {
        body: {
          product_id: productId,
          offer_id: offerId,
          requisites_id: selectedPayer.id,
        },
      });
      if (error) throw error;
      if (!data || (data as any).error) {
        throw new Error((data as any)?.error ?? "invoice_issue_failed");
      }
      setResult(data as InvoiceResult);
      setStep("success");
      toast.success("Счёт выписан");
    } catch (e: any) {
      console.error("[InvoiceCheckoutDialog] issue failed", e);
      toast.error(e?.message ?? "Не удалось выписать счёт");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Счёт на оплату — {productName}
            {tariffName ? ` · ${tariffName}` : ""}
          </DialogTitle>
          <DialogDescription>
            Оплата по банковскому реквизиту для юридического лица
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
            {requisites.legalEntities.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : legalRows.length === 0 ? (
              <Card className="p-4 text-sm text-muted-foreground">
                У вас пока нет сохранённых реквизитов юрлица. Добавьте их, чтобы
                выписать счёт.
              </Card>
            ) : (
              <RadioGroup
                value={selectedPayerId ?? ""}
                onValueChange={(v) => setSelectedPayerId(v)}
                className="space-y-2"
              >
                {legalRows.map((row) => (
                  <Card key={row.id} className="p-3">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <RadioGroupItem value={row.id} className="mt-1" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 font-medium">
                          <Building2 className="h-4 w-4" />
                          {payerLabel(row)}
                        </div>
                        {row.is_default && (
                          <div className="text-xs text-muted-foreground mt-1">по умолчанию</div>
                        )}
                      </div>
                    </label>
                  </Card>
                ))}
              </RadioGroup>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowAddForm(true)}>
                <Plus className="h-4 w-4 mr-1" /> Добавить реквизиты
              </Button>
              <Button
                className="ml-auto"
                disabled={!selectedPayerId}
                onClick={() => setStep("confirm")}
              >
                Далее
              </Button>
            </div>
          </div>
        )}

        {step === "payer" && showAddForm && (
          <div className="space-y-4 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setShowAddForm(false)}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Назад к выбору
            </Button>
            <LegalEntityRequisitesForm
              scope="user_requisites"
              subjectType="legal_entity"
              onSubmit={handleAddPayerSubmit}
              onCancel={() => setShowAddForm(false)}
              isSubmitting={requisites.createLegalEntity.isPending}
            />
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
                <div className="font-medium">{payerLabel(selectedPayer)}</div>
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
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Выписываем счёт…
                  </>
                ) : (
                  "Выписать счёт"
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
              <div className="text-lg font-semibold">Счёт № {result.invoice_number} выписан</div>
              <div className="text-sm text-muted-foreground mt-1">
                {result.email_sent ? "Копия отправлена на email." : "Email не отправлен — проверьте адрес."}{" "}
                {result.telegram_sent ? "Также ушла в Telegram." : ""}
              </div>
            </div>
            {result.pdf_url && (
              <Button asChild variant="outline">
                <a href={result.pdf_url} target="_blank" rel="noreferrer">
                  <Download className="h-4 w-4 mr-1" /> Скачать PDF
                </a>
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
