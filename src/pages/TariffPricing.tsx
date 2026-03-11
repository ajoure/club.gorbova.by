import { useState } from "react";
import { useParams } from "react-router-dom";
import { usePublicTariffByPublicId } from "@/hooks/usePublicTariff";
import { TariffCard } from "@/components/landing/TariffCard";
import { PaymentDialog } from "@/components/payment/PaymentDialog";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, ExternalLink } from "lucide-react";

export default function TariffPricing() {
  const { tariffPublicId } = useParams<{ tariffPublicId: string }>();
  const { user } = useAuth();
  const { data, isLoading, error } = usePublicTariffByPublicId(
    tariffPublicId || null,
    user?.id
  );

  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [selectedOffer, setSelectedOffer] = useState<any>(null);

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
            Проверьте ссылку или обратитесь к администратору.
          </p>
        </div>
      </div>
    );
  }

  const primaryDomain = data.product.primary_domain;
  const tariff = data.tariff;

  // Find primary pay_now offer for PaymentDialog
  const payNowOffers = (tariff.offers || []).filter(
    (o: any) => o.offer_type === "pay_now" && o.is_active !== false
  );
  const primaryOffer = payNowOffers.find((o: any) => o.is_primary) || payNowOffers[0];

  const handleSelectOffer = (offer: any) => {
    setSelectedOffer(offer);
    setPaymentDialogOpen(true);
  };

  const activeOffer = selectedOffer || primaryOffer;

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

      {activeOffer && (
        <PaymentDialog
          open={paymentDialogOpen}
          onOpenChange={setPaymentDialogOpen}
          productId={data.product.id}
          productName={data.product.public_title || data.product.name}
          price={String(activeOffer.amount || 0)}
          tariffCode={tariff.code}
          offerId={activeOffer.id}
          isTrial={activeOffer.offer_type === "trial"}
          trialDays={activeOffer.trial_days}
        />
      )}
    </div>
  );
}
