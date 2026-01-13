import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, User, Building, Building2, CreditCard, Mail, ArrowLeft, Check } from "lucide-react";

interface ConsultationPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tariffCode: string;
  tariffName: string;
  price: number;
}

type PayerType = "individual" | "entrepreneur" | "legal_entity";
type Step = "payer_type" | "payment" | "invoice_form" | "success";

export function ConsultationPaymentDialog({
  open,
  onOpenChange,
  tariffCode,
  tariffName,
  price,
}: ConsultationPaymentDialogProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("payer_type");
  const [payerType, setPayerType] = useState<PayerType>("individual");
  const [invoiceEmail, setInvoiceEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(false);

  const handlePayerTypeSelect = () => {
    if (payerType === "individual") {
      setStep("payment");
    } else {
      setStep("invoice_form");
    }
  };

  const handleCardPayment = async () => {
    if (!user) {
      toast.error("Для оплаты необходимо авторизоваться");
      navigate("/auth");
      return;
    }

    setLoading(true);
    try {
      // Fetch tariff to get proper IDs
      const { data: tariff, error: tariffError } = await supabase
        .from("tariffs")
        .select("id, product_id")
        .eq("code", tariffCode)
        .single();

      if (tariffError || !tariff) {
        throw new Error("Тариф не найден");
      }

      // Initialize payment via bePaid - it creates order internally
      // isOneTime: true - consultations are one-time payments, not subscriptions
      const { data, error } = await supabase.functions.invoke("bepaid-create-token", {
        body: {
          productId: tariff.product_id,
          customerEmail: user.email,
          tariffCode: tariffCode,
          description: tariffName,
          isOneTime: true,
        },
      });

      if (error) throw error;

      if (data?.alreadyUsedTrial) {
        toast.warning("Пробный период для этого продукта уже использован", { duration: 8000 });
        return;
      }

      const redirectUrl = data?.redirectUrl || data?.checkout?.redirect_url;
      if (redirectUrl) {
        window.location.href = redirectUrl;
      } else if (data?.error) {
        throw new Error(data.error);
      } else {
        throw new Error("Не удалось получить ссылку на оплату");
      }
    } catch (error: any) {
      console.error("Payment error:", error);
      toast.error(error.message || "Ошибка при создании платежа");
    } finally {
      setLoading(false);
    }
  };

  const handleInvoiceRequest = async () => {
    if (!invoiceEmail) {
      toast.error("Укажите email для отправки счёта");
      return;
    }

    setLoading(true);
    try {
      // Fetch tariff
      const { data: tariff, error: tariffError } = await supabase
        .from("tariffs")
        .select("id, product_id")
        .eq("code", tariffCode)
        .maybeSingle();

      if (tariffError) throw tariffError;

      // Create order with pending_invoice status
      const { data: order, error: orderError } = await supabase
        .from("orders_v2")
        .insert({
          user_id: user?.id || null,
          tariff_id: tariff?.id || null,
          product_id: tariff?.product_id || null,
          order_number: `ORD-${Date.now()}`,
          base_price: price * 100,
          final_price: price * 100,
          status: "pending",
          payer_type: payerType,
          customer_email: invoiceEmail,
          invoice_email: invoiceEmail,
          meta: {
            company_name: companyName || null,
            invoice_requested: true,
          },
        })
        .select()
        .single();

      if (orderError) throw orderError;

      // Send invoice via edge function
      const { error: invoiceError } = await supabase.functions.invoke("send-invoice", {
        body: {
          orderId: order.id,
          email: invoiceEmail,
          tariffName,
          price,
          payerType,
          companyName: companyName || undefined,
        },
      });

      if (invoiceError) {
        console.error("Invoice send error:", invoiceError);
        // Still show success - order created, invoice can be resent
      }

      // Update order with invoice_sent_at
      await supabase
        .from("orders_v2")
        .update({ invoice_sent_at: new Date().toISOString() })
        .eq("id", order.id);

      setStep("success");
    } catch (error: any) {
      console.error("Invoice request error:", error);
      toast.error(error.message || "Ошибка при создании заявки");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setStep("payer_type");
    setPayerType("individual");
    setInvoiceEmail("");
    setCompanyName("");
    onOpenChange(false);
  };

  const getPayerTypeLabel = (type: PayerType) => {
    switch (type) {
      case "individual":
        return "Физическое лицо";
      case "entrepreneur":
        return "Индивидуальный предприниматель";
      case "legal_entity":
        return "Юридическое лицо";
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tariffName}</DialogTitle>
          <DialogDescription>
            {step === "payer_type" && "Выберите тип плательщика"}
            {step === "payment" && "Оплата банковской картой"}
            {step === "invoice_form" && "Данные для выставления счёта"}
            {step === "success" && "Заявка отправлена"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Price display */}
          {step !== "success" && (
            <div className="text-center py-4 rounded-xl bg-muted">
              <div className="text-3xl font-bold text-foreground">{price} BYN</div>
              <div className="text-sm text-muted-foreground">{tariffName}</div>
            </div>
          )}

          {/* Step: Payer Type Selection */}
          {step === "payer_type" && (
            <>
              <RadioGroup value={payerType} onValueChange={(v) => setPayerType(v as PayerType)}>
                <div className="space-y-3">
                  <Label
                    htmlFor="individual"
                    className="flex items-center gap-3 p-4 rounded-xl border border-border cursor-pointer hover:border-primary/50 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                  >
                    <RadioGroupItem value="individual" id="individual" />
                    <User className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <div className="font-medium">Физическое лицо</div>
                      <div className="text-sm text-muted-foreground">Онлайн-оплата картой</div>
                    </div>
                  </Label>

                  <Label
                    htmlFor="entrepreneur"
                    className="flex items-center gap-3 p-4 rounded-xl border border-border cursor-pointer hover:border-primary/50 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                  >
                    <RadioGroupItem value="entrepreneur" id="entrepreneur" />
                    <Building className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <div className="font-medium">Индивидуальный предприниматель</div>
                      <div className="text-sm text-muted-foreground">Выставление счёта на email</div>
                    </div>
                  </Label>

                  <Label
                    htmlFor="legal_entity"
                    className="flex items-center gap-3 p-4 rounded-xl border border-border cursor-pointer hover:border-primary/50 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                  >
                    <RadioGroupItem value="legal_entity" id="legal_entity" />
                    <Building2 className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <div className="font-medium">Юридическое лицо</div>
                      <div className="text-sm text-muted-foreground">Выставление счёта на email</div>
                    </div>
                  </Label>
                </div>
              </RadioGroup>

              <Button onClick={handlePayerTypeSelect} className="w-full" size="lg">
                Продолжить
              </Button>
            </>
          )}

          {/* Step: Card Payment */}
          {step === "payment" && (
            <>
              <div className="text-center space-y-2">
                <CreditCard className="h-12 w-12 mx-auto text-primary" />
                <p className="text-sm text-muted-foreground">
                  Вы будете перенаправлены на безопасную страницу оплаты bePaid
                </p>
              </div>

              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep("payer_type")} className="flex-1">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Назад
                </Button>
                <Button onClick={handleCardPayment} disabled={loading} className="flex-1">
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      Оплатить
                      <CreditCard className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </>
          )}

          {/* Step: Invoice Form */}
          {step === "invoice_form" && (
            <>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email для счёта *</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="your@email.com"
                    value={invoiceEmail}
                    onChange={(e) => setInvoiceEmail(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="company">Наименование организации</Label>
                  <Input
                    id="company"
                    placeholder={payerType === "entrepreneur" ? "ИП Иванов И.И." : "ООО «Компания»"}
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep("payer_type")} className="flex-1">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Назад
                </Button>
                <Button onClick={handleInvoiceRequest} disabled={loading || !invoiceEmail} className="flex-1">
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      Выставить счёт
                      <Mail className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </>
          )}

          {/* Step: Success */}
          {step === "success" && (
            <div className="text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                <Check className="h-8 w-8 text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-2">Заявка отправлена!</h3>
                <p className="text-sm text-muted-foreground">
                  Счёт на оплату отправлен на адрес <strong>{invoiceEmail}</strong>. После оплаты с вами свяжется менеджер для назначения времени консультации.
                </p>
              </div>
              <Button onClick={handleClose} className="w-full">
                Закрыть
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
