import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AnimatedSection } from "./AnimatedSection";
import { TariffCard } from "./TariffCard";
import { PaymentDialog } from "@/components/payment/PaymentDialog";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { TariffCarouselGrid } from "./TariffCarouselGrid";
import { AlertTriangle } from "lucide-react";
import type { PublicProduct, PublicTariff, TariffOffer } from "@/hooks/usePublicProduct";

interface UniversalPricingSectionProps {
  product: PublicProduct;
  tariffs: PublicTariff[];
  pricingStage?: { id: string; name: string; stage_type: string } | null;
  sectionTitle?: string;
  sectionSubtitle?: string;
  disclaimer?: string;
  isReentryPricing?: boolean;
  reentryMessage?: string;
  /** User ID for auth redirect flow */
  userId?: string | null;
  /** Base path for auth redirect (defaults to current pathname) */
  redirectBasePath?: string;
}

export function UniversalPricingSection({
  product,
  tariffs,
  sectionTitle,
  sectionSubtitle,
  disclaimer,
  isReentryPricing,
  reentryMessage,
  redirectBasePath,
}: UniversalPricingSectionProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [selectedOffer, setSelectedOffer] = useState<{
    offer: TariffOffer;
    tariff: PublicTariff;
    productId: string;
  } | null>(null);

  const config = product.landing_config || {};
  const priceSuffix = config.price_suffix || "BYN";

  // Restore offer selection from URL after auth redirect
  useEffect(() => {
    const offerId = searchParams.get("offer");
    if (offerId && user && tariffs) {
      for (const tariff of tariffs) {
        const offer = tariff.offers?.find(o => o.id === offerId);
        if (offer) {
          setSelectedOffer({ offer, tariff, productId: product.id });
          setPaymentOpen(true);
          setSearchParams(prev => {
            const p = new URLSearchParams(prev);
            p.delete("offer");
            return p;
          }, { replace: true });
          break;
        }
      }
    }
  }, [searchParams, user, tariffs, product.id, setSearchParams]);

  const handleSelectOffer = (offer: TariffOffer, tariff: PublicTariff) => {
    if (!user) {
      const basePath = redirectBasePath || window.location.pathname;
      const sp = new URLSearchParams(window.location.search);
      sp.set("offer", offer.id);
      const returnUrl = `${basePath}?${sp.toString()}`;
      navigate(`/auth?redirectTo=${encodeURIComponent(returnUrl)}`);
      return;
    }
    setSelectedOffer({ offer, tariff, productId: product.id });
    setPaymentOpen(true);
  };

  if (!tariffs || tariffs.length === 0) return null;

  const title = sectionTitle || config.tariffs_title || product.public_title || "Тарифы";
  const subtitle = sectionSubtitle || config.tariffs_subtitle || product.public_subtitle || "Выберите подходящий вариант";
  const disclaimerText = disclaimer || product.payment_disclaimer_text ||
    "Безопасная оплата через bePaid. Принимаем Visa, Mastercard, Белкарт, ЕРИП.";

  return (
    <>
      <section id="tariffs" className="py-20">
        <div className="container mx-auto px-4">
          <AnimatedSection animation="fade-up">
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
                {title}
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                {subtitle}
              </p>
            </div>
          </AnimatedSection>

          {/* Reentry pricing alert */}
          {isReentryPricing && reentryMessage && (
            <AnimatedSection className="max-w-2xl mx-auto mb-8">
              <Alert variant="destructive" className="border-amber-500 bg-amber-50 dark:bg-amber-950/20">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-amber-800 dark:text-amber-200">
                  {reentryMessage}
                </AlertDescription>
              </Alert>
            </AnimatedSection>
          )}

          <TariffCarouselGrid count={tariffs.length}>
            {tariffs.map((tariff, index) => (
              <AnimatedSection key={tariff.id} animation="fade-up" delay={index * 100} className="h-full">
                <TariffCard
                  tariff={tariff}
                  onSelectOffer={handleSelectOffer}
                  showBadges={config.show_badges !== false}
                  priceSuffix={priceSuffix}
                />
              </AnimatedSection>
            ))}
          </TariffCarouselGrid>

          {disclaimerText && (
            <AnimatedSection animation="fade-up" delay={400}>
              <p className="text-center text-sm text-muted-foreground mt-8 max-w-2xl mx-auto">
                {disclaimerText}
              </p>
            </AnimatedSection>
          )}
        </div>
      </section>

      {/* Payment Dialog */}
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
          isClubProduct={!!product.telegram_club_id}
          isSubscription={selectedOffer.offer.requires_card_tokenization}
        />
      )}
    </>
  );
}

/** Loading skeleton for pricing section */
export function UniversalPricingSkeleton() {
  return (
    <section id="tariffs" className="py-20">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12">
          <Skeleton className="h-10 w-64 mx-auto mb-4" />
          <Skeleton className="h-6 w-96 mx-auto" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
          <Skeleton className="h-80 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      </div>
    </section>
  );
}
