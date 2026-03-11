import { useState, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { usePublicTariffByPublicId } from "@/hooks/usePublicTariff";
import { TariffCard } from "@/components/landing/TariffCard";
import { PaymentDialog } from "@/components/payment/PaymentDialog";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

export default function TariffPricing() {
  const { tariffPublicId } = useParams<{ tariffPublicId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { data, isLoading, error, refetch } = usePublicTariffByPublicId(
    tariffPublicId || null,
    user?.id
  );

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [selectedOffer, setSelectedOffer] = useState<{
    offer: any;
    tariff: any;
    productId: string;
  } | null>(null);

  // Restore offer selection from URL after auth redirect (same pattern as ProductLanding)
  useEffect(() => {
    const offerId = searchParams.get("offer");
    if (offerId && user && data?.tariff) {
      const offer = (data.tariff.offers || []).find(
        (o: any) => o.id === offerId && o.is_active !== false
      );
      if (offer) {
        // Validate tariff has internal code for payment
        if (!data.tariff.code) {
          toast({
            title: "Ошибка",
            description: "Тариф настроен некорректно (нет internal code)",
            variant: "destructive",
          });
        } else {
          setSelectedOffer({
            offer,
            tariff: data.tariff,
            productId: data.product.id,
          });
          setPaymentOpen(true);
        }
      }
      // Clear offer param from URL to prevent re-open on refresh/back
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, user, data, setSearchParams]);

  const handleSelectOffer = (offer: any) => {
    if (!user) {
      // Auth redirect — exactly as ProductLanding
      const returnUrl = `${window.location.pathname}?offer=${offer.id}`;
      navigate(`/auth?redirectTo=${encodeURIComponent(returnUrl)}`);
      return;
    }

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

      {/* PaymentDialog — props 1:1 with ProductLanding */}
      {selectedOffer && (
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
      )}
    </div>
  );
}
