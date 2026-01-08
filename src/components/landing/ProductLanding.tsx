import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/GlassCard";
import { AnimatedSection } from "./AnimatedSection";
import { PaymentDialog } from "@/components/payment/PaymentDialog";
import { useAuth } from "@/contexts/AuthContext";
import { Check, Zap, Clock, ChevronRight, Shield } from "lucide-react";
import type { PublicProductData, PublicTariff, TariffOffer } from "@/hooks/usePublicProduct";

interface ProductLandingProps {
  data: PublicProductData;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  customSections?: React.ReactNode;
}

function TariffCard({ 
  tariff, 
  onSelectOffer,
  showBadges = true,
}: { 
  tariff: PublicTariff;
  onSelectOffer: (offer: TariffOffer, tariff: PublicTariff) => void;
  showBadges?: boolean;
}) {
  const primaryOffer = tariff.offers?.find(o => o.offer_type === "pay_now");
  const trialOffer = tariff.offers?.find(o => o.offer_type === "trial");
  const displayPrice = tariff.current_price ?? tariff.base_price ?? primaryOffer?.amount ?? 0;
  
  const visibleFeatures = tariff.features?.filter(f => {
    if (f.visibility_mode === "always") return true;
    const now = new Date();
    if (f.visibility_mode === "until_date" && f.active_to) {
      return now <= new Date(f.active_to);
    }
    if (f.visibility_mode === "date_range") {
      const from = f.active_from ? new Date(f.active_from) : null;
      const to = f.active_to ? new Date(f.active_to) : null;
      if (from && now < from) return false;
      if (to && now > to) return false;
      return true;
    }
    return true;
  }) || [];

  return (
    <GlassCard 
      className={`p-6 relative flex flex-col h-full ${tariff.is_popular ? 'border-primary/50 ring-2 ring-primary/20' : ''}`}
    >
      {showBadges && tariff.is_popular && (
        <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">
          Популярный
        </Badge>
      )}
      
      {showBadges && tariff.badge && !tariff.is_popular && (
        <Badge variant="secondary" className="absolute -top-3 left-1/2 -translate-x-1/2">
          {tariff.badge}
        </Badge>
      )}

      <div className="text-center mb-4">
        <div className={`w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center ${tariff.is_popular ? 'bg-primary/20' : 'bg-muted'}`}>
          {tariff.is_popular ? <Zap className="text-primary" size={24} /> : <Clock className="text-muted-foreground" size={24} />}
        </div>
        <h3 className="text-xl font-bold text-foreground">{tariff.name}</h3>
        {tariff.subtitle && (
          <p className="text-sm text-muted-foreground mt-1">{tariff.subtitle}</p>
        )}
      </div>

      <div className="text-center mb-4">
        {tariff.discount_percent && tariff.base_price && (
          <div className="text-sm text-muted-foreground line-through">
            {tariff.base_price} BYN
          </div>
        )}
        <div className="text-3xl font-bold text-foreground">
          {displayPrice} <span className="text-base font-normal text-muted-foreground">{tariff.period_label || "BYN"}</span>
        </div>
        {tariff.discount_percent && (
          <Badge variant="destructive" className="mt-1">
            -{tariff.discount_percent}%
          </Badge>
        )}
      </div>

      {visibleFeatures.length > 0 && (
        <ul className="space-y-2 mb-6 flex-1">
          {visibleFeatures.map((feature) => (
            <li key={feature.id} className={`flex items-start gap-2 text-sm ${feature.is_highlighted ? 'text-primary font-medium' : 'text-foreground'}`}>
              <Check size={16} className={`mt-0.5 flex-shrink-0 ${feature.is_highlighted ? 'text-primary' : 'text-primary/70'}`} />
              <span>
                {feature.text}
                {feature.is_bonus && (
                  <Badge variant="secondary" className="ml-2 text-xs">Бонус</Badge>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2 mt-auto">
        {trialOffer && (
          <Button 
            onClick={() => onSelectOffer(trialOffer, tariff)}
            variant="outline"
            className="w-full"
          >
            {trialOffer.button_label || `Пробный период ${trialOffer.trial_days} дней`}
          </Button>
        )}
        {primaryOffer && (
          <Button 
            onClick={() => onSelectOffer(primaryOffer, tariff)}
            variant={tariff.is_popular ? "default" : "outline"}
            className="w-full"
          >
            {primaryOffer.button_label || "Оплатить"}
            <ChevronRight className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>
    </GlassCard>
  );
}

export function ProductLanding({ data, header, footer, customSections }: ProductLandingProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [selectedOffer, setSelectedOffer] = useState<{
    offer: TariffOffer;
    tariff: PublicTariff;
    productId: string;
  } | null>(null);

  const { product, tariffs } = data;
  const config = product.landing_config || {};

  const handleSelectOffer = (offer: TariffOffer, tariff: PublicTariff) => {
    if (!user) {
      navigate("/auth");
      return;
    }
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

            <div className={`grid gap-6 max-w-5xl mx-auto items-stretch ${
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
          isTrial={selectedOffer.offer.offer_type === "trial"}
          trialDays={selectedOffer.offer.trial_days ?? undefined}
        />
      )}
    </div>
  );
}
