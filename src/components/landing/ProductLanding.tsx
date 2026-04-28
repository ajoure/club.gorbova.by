import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AnimatedSection } from "./AnimatedSection";
import { TariffCard } from "./TariffCard";
import { PaymentDialog } from "@/components/payment/PaymentDialog";
import { ChevronRight, Shield } from "lucide-react";
import type { PublicProductData, PublicTariff, TariffOffer } from "@/hooks/usePublicProduct";

interface ProductLandingProps {
  data: PublicProductData;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  customSections?: React.ReactNode;
}

export function ProductLanding({ data, header, footer, customSections }: ProductLandingProps) {
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [selectedOffer, setSelectedOffer] = useState<{
    offer: TariffOffer;
    tariff: PublicTariff;
    productId: string;
  } | null>(null);

  const { product, tariffs } = data;
  const config = product.landing_config || {};

  const handleSelectOffer = (offer: TariffOffer, tariff: PublicTariff) => {
    setSelectedOffer({ offer, tariff, productId: product.id });
    setPaymentOpen(true);
  };

  const sectionTitle = config.tariffs_title || product.public_title || "Тарифы";
  const sectionSubtitle = config.tariffs_subtitle || product.public_subtitle || "Выберите подходящий вариант";
  const disclaimer = product.payment_disclaimer_text || 
    "Безопасная оплата через bePaid. Принимаем Visa, Mastercard, Белкарт, ЕРИП.";

  return (
    <div className="min-h-screen bg-background">
      {header}

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        <div
          className="absolute inset-0 -z-10"
          style={{ background: "var(--gradient-background)" }}
        />
        <div className="absolute top-1/4 right-0 w-96 h-96 rounded-full bg-primary/10 blur-3xl -z-10" />
        <div className="absolute bottom-1/4 left-0 w-80 h-80 rounded-full bg-accent/10 blur-3xl -z-10" />

        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto text-center">
            <AnimatedSection animation="fade-up">
              <Badge variant="secondary" className="mb-6 bg-primary/10 text-primary border-0">
                <Shield size={14} className="mr-1" />
                {product.name}
              </Badge>
            </AnimatedSection>

            <AnimatedSection animation="fade-up" delay={100}>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground leading-tight mb-6">
                {config.hero_title || product.public_title || product.name}
              </h1>
            </AnimatedSection>

            {(config.hero_subtitle || product.public_subtitle) && (
              <AnimatedSection animation="fade-up" delay={200}>
                <p className="text-xl text-muted-foreground mb-8">
                  {config.hero_subtitle || product.public_subtitle}
                </p>
              </AnimatedSection>
            )}

            <AnimatedSection animation="fade-up" delay={300}>
              <Button 
                size="lg" 
                onClick={() => document.getElementById("tariffs")?.scrollIntoView({ behavior: "smooth" })}
                className="text-lg px-8 py-6"
              >
                Выбрать тариф
                <ChevronRight className="ml-2" />
              </Button>
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* Custom Sections */}
      {customSections}

      {/* Tariffs Section */}
      {tariffs && tariffs.length > 0 && (
        <section id="tariffs" className="py-20">
          <div className="container mx-auto px-4">
            <AnimatedSection animation="fade-up">
              <div className="text-center mb-12">
                <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
                  {sectionTitle}
                </h2>
                <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                  {sectionSubtitle}
                </p>
              </div>
            </AnimatedSection>

            <div className={`grid grid-cols-1 gap-6 max-w-5xl mx-auto items-stretch ${
              tariffs.length === 1 ? 'md:grid-cols-1 max-w-md' :
              tariffs.length === 2 ? 'md:grid-cols-2 max-w-3xl' :
              'md:grid-cols-3'
            }`}>
              {tariffs.map((tariff, index) => (
                <AnimatedSection key={tariff.id} animation="fade-up" delay={index * 100}>
                  <TariffCard
                    tariff={tariff}
                    onSelectOffer={handleSelectOffer}
                    showBadges={config.show_badges !== false}
                    priceSuffix={config.price_suffix || "BYN"}
                  />
                </AnimatedSection>
              ))}
            </div>

            {disclaimer && (
              <AnimatedSection animation="fade-up" delay={400}>
                <p className="text-center text-sm text-muted-foreground mt-8 max-w-2xl mx-auto">
                  {disclaimer}
                </p>
              </AnimatedSection>
            )}
          </div>
        </section>
      )}

      {footer}

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
          isSubscription={
            !!selectedOffer.offer.requires_card_tokenization &&
            selectedOffer.offer.payment_method !== "internal_installment"
          }
          paymentMethod={selectedOffer.offer.payment_method}
          installmentCount={selectedOffer.offer.installment_count ?? null}
        />
      )}
    </div>
  );
}
