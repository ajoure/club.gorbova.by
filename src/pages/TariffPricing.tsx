import { useState } from "react";
import { useParams } from "react-router-dom";
import { usePublicTariffByPublicId } from "@/hooks/usePublicTariff";
import { TariffCard } from "@/components/landing/TariffCard";
import { PaymentDialog } from "@/components/payment/PaymentDialog";
import { LeadRequestDialog } from "@/components/lead/LeadRequestDialog";
import { InvoiceCheckoutDialog } from "@/components/payment/InvoiceCheckoutDialog";
import { detectInvoiceOnlyOffer } from "@/lib/invoiceCheckout";
import { readBankInstallmentMeta } from "@/lib/bankInstallment";
import { Loader2, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

export default function TariffPricing() {
  const { tariffPublicId } = useParams<{ tariffPublicId: string }>();
  const { data, isLoading, error, refetch } = usePublicTariffByPublicId(
    tariffPublicId || null
  );

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [selectedOffer, setSelectedOffer] = useState<{
    offer: any;
    tariff: any;
    productId: string;
  } | null>(null);

  const handleSelectOffer = (offer: any) => {
    if (!data?.tariff?.code) {
      toast({
        title: "Ошибка",
        description: "Тариф настроен некорректно (нет internal code)",
        variant: "destructive",
      });
      return;
    }

    setSelectedOffer({
      offer,
      tariff: data.tariff,
      productId: data.product.id,
    });
    setPaymentOpen(true);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-foreground">Тариф не найден</h1>
          <p className="text-muted-foreground">
            Либо тариф неактивен, либо функция ещё не задеплоена.
          </p>
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Повторить
          </Button>
        </div>
      </div>
    );
  }

  const primaryDomain = data.product.primary_domain;
  const tariff = data.tariff;

  return (
    <div className="min-h-screen bg-background">
      {primaryDomain && (
        <div className="bg-primary/10 border-b border-primary/20 py-2 px-4 text-center">
          <a
            href={`https://${primaryDomain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline inline-flex items-center gap-1"
          >
            Полная версия сайта: {primaryDomain}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      <div className="max-w-lg mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground">
            {data.product.public_title || data.product.name}
          </h1>
          {data.product.public_subtitle && (
            <p className="text-muted-foreground mt-1">{data.product.public_subtitle}</p>
          )}
        </div>

        <TariffCard
          tariff={tariff}
          onSelectOffer={(offer) => handleSelectOffer(offer)}
        />

        {data.product.payment_disclaimer_text && (
          <p className="text-xs text-muted-foreground text-center mt-4">
            {data.product.payment_disclaimer_text}
          </p>
        )}
      </div>

      {selectedOffer && (selectedOffer.offer.offer_type === "lead" || selectedOffer.offer.offer_type === "bank_installment") ? (
        <LeadRequestDialog
          open={paymentOpen}
          onOpenChange={setPaymentOpen}
          offerId={selectedOffer.offer.id}
          offerLabel={selectedOffer.offer.button_label}
          productName={data.product.public_title || data.product.name}
          tariffName={selectedOffer.tariff.name}
          commentPlaceholder={(selectedOffer.offer.meta as any)?.lead_form?.comment_placeholder}
          successMessage={(selectedOffer.offer.meta as any)?.lead_form?.success_message}
          {...(selectedOffer.offer.offer_type === "bank_installment"
            ? readBankInstallmentMeta(selectedOffer.offer)
            : {})}
        />
      ) : selectedOffer && detectInvoiceOnlyOffer(selectedOffer.offer).isInvoiceOnly ? (
        <InvoiceCheckoutDialog
          open={paymentOpen}
          onOpenChange={setPaymentOpen}
          productId={selectedOffer.productId}
          productName={data.product.public_title || data.product.name}
          tariffName={selectedOffer.tariff.name}
          offerId={selectedOffer.offer.id}
          amount={selectedOffer.offer.amount}
          currency={data.product.currency || "BYN"}
        />
      ) : selectedOffer ? (
        <PaymentDialog
          open={paymentOpen}
          onOpenChange={setPaymentOpen}
          productId={selectedOffer.productId}
          productName={selectedOffer.tariff.name}
          price={String(selectedOffer.offer.amount)}
          tariffCode={selectedOffer.tariff.code}
          offerId={selectedOffer.offer.id}
          isTrial={selectedOffer.offer.offer_type === "trial"}
          trialDays={selectedOffer.offer.trial_days ?? undefined}
          isClubProduct={!!data.product.telegram_club_id}
          isSubscription={selectedOffer.offer.requires_card_tokenization}
        />
      ) : null}
    </div>
  );
}
