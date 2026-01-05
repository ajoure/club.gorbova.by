import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Check, Star, CreditCard, Gift, Zap } from "lucide-react";
import { AnimatedSection } from "./AnimatedSection";
import { PaymentDialog } from "@/components/payment/PaymentDialog";
import { isFeatureVisible, type TariffFeature } from "@/hooks/useTariffFeatures";

interface TariffOffer {
  id: string;
  tariff_id: string;
  offer_type: "pay_now" | "trial";
  button_label: string;
  amount: number;
  trial_days: number | null;
  auto_charge_after_trial: boolean;
  auto_charge_amount: number | null;
  requires_card_tokenization: boolean;
  sort_order: number;
}

interface Tariff {
  id: string;
  code: string;
  name: string;
  subtitle: string | null;
  description: string | null;
  period_label: string | null;
  is_popular: boolean | null;
  badge: string | null;
  is_active: boolean;
  display_order: number | null;
  product_id: string;
  original_price: number | null;
  current_price?: number | null;
  features: TariffFeature[];
  offers: TariffOffer[];
}

interface Product {
  id: string;
  name: string;
  code: string;
  public_title: string | null;
  public_subtitle: string | null;
  payment_disclaimer_text: string | null;
  currency: string;
}

// Fallback plans in case DB is empty
const fallbackPlans = [
  {
    name: "CHAT",
    price: "100",
    period: "BYN/мес",
    description: "Для быстрого старта",
    features: [
      "Доступ к сообществу",
      "Канал с дайджестами",
      "Еженедельные эфиры",
      "Чат с коллегами",
    ],
    popular: false,
  },
  {
    name: "FULL",
    price: "150",
    period: "BYN/мес",
    description: "Самый популярный",
    features: [
      "Всё из тарифа CHAT",
      "База знаний: 600+ видео",
      "Личные видеоответы на вопросы",
      "Архив всех эфиров",
    ],
    popular: true,
  },
  {
    name: "BUSINESS",
    price: "250",
    period: "BYN/мес",
    description: "Для бизнеса и роста",
    features: [
      "Всё из тарифа FULL",
      "«Библиотека решений»",
      "База по бизнесу и саморазвитию",
      "4-часовые глубокие вебинары",
      "Приоритетная поддержка",
    ],
    popular: false,
  },
];

export function LandingPricing() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [selectedPlan, setSelectedPlan] = useState<{
    productId: string;
    name: string;
    price: string;
    tariffCode: string;
    isTrial?: boolean;
    trialDays?: number;
  } | null>(null);

  // Fetch product with tariffs, features and offers from DB
  const { data: productData, isLoading } = useQuery({
    queryKey: ["landing-pricing"],
    queryFn: async () => {
      // Get the main product (Gorbova Club or first active product)
      const { data: products, error: productsError } = await supabase
        .from("products_v2")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1);

      if (productsError) throw productsError;
      if (!products?.length) return null;

      const product = products[0] as Product;

      // Get tariffs for this product
      const { data: tariffs, error: tariffsError } = await supabase
        .from("tariffs")
        .select("*")
        .eq("product_id", product.id)
        .eq("is_active", true)
        .order("display_order", { ascending: true });

      if (tariffsError) throw tariffsError;
      if (!tariffs?.length) return { product, tariffs: [] };

      // Get features for all tariffs
      const tariffIds = tariffs.map((t) => t.id);
      const { data: features, error: featuresError } = await supabase
        .from("tariff_features" as any)
        .select("*")
        .in("tariff_id", tariffIds)
        .order("sort_order", { ascending: true });

      if (featuresError) throw featuresError;

      // Get offers for all tariffs
      const { data: offers, error: offersError } = await supabase
        .from("tariff_offers")
        .select("*")
        .in("tariff_id", tariffIds)
        .eq("is_active", true)
        .order("sort_order", { ascending: true });

      if (offersError) throw offersError;

      // Get prices from tariff_prices (current pricing stage)
      const { data: pricingStages } = await supabase
        .from("pricing_stages")
        .select("*")
        .eq("product_id", product.id)
        .eq("is_active", true)
        .lte("start_date", new Date().toISOString())
        .or(`end_date.is.null,end_date.gte.${new Date().toISOString()}`)
        .order("display_order", { ascending: true })
        .limit(1);

      const currentStage = pricingStages?.[0];
      
      let pricesMap: Record<string, number> = {};
      if (currentStage) {
        const { data: prices } = await supabase
          .from("tariff_prices")
          .select("*")
          .eq("pricing_stage_id", currentStage.id)
          .eq("is_active", true);
        
        if (prices) {
          pricesMap = Object.fromEntries(
            prices.map((p) => [p.tariff_id, p.final_price || p.price])
          );
        }
      }

      // Merge features and offers into tariffs
      const featuresArray = ((features || []) as unknown) as TariffFeature[];
      const offersArray = ((offers || []) as unknown) as TariffOffer[];
      const tariffsWithData: Tariff[] = tariffs.map((tariff) => ({
        ...tariff,
        features: featuresArray.filter((f) => f.tariff_id === tariff.id),
        offers: offersArray.filter((o) => o.tariff_id === tariff.id),
        current_price: pricesMap[tariff.id] || tariff.original_price,
      }));

      return { product, tariffs: tariffsWithData };
    },
    staleTime: 5 * 60 * 1000, // 5 minutes cache
  });

  // Also fetch legacy products for payment flow compatibility
  const { data: legacyProducts } = useQuery({
    queryKey: ["products-for-pricing"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, price_byn, currency")
        .eq("is_active", true)
        .eq("product_type", "subscription");

      if (error) throw error;
      return data;
    },
  });

  const handleSelectPlan = (
    planName: string,
    planPrice: string,
    tariffCode: string,
    productId?: string,
    isTrial?: boolean,
    trialDays?: number
  ) => {
    console.log(`[Analytics] click_pricing_plan_${planName.toLowerCase()}${isTrial ? '_trial' : ''}`);

    // Try to find legacy product for payment compatibility
    const legacyProduct = legacyProducts?.find((p) =>
      p.name.toUpperCase().includes(planName.toUpperCase())
    );

    const finalProductId = productId || legacyProduct?.id;

    if (finalProductId) {
      setSelectedPlan({
        productId: finalProductId,
        name: isTrial 
          ? `${planName} — Trial ${trialDays || 5} дней`
          : `${planName} — Месячная подписка`,
        price: `${planPrice} BYN`,
        tariffCode,
        isTrial,
        trialDays,
      });
    } else {
      navigate("/auth?mode=signup");
    }
  };

  // Determine what to render
  const hasDynamicTariffs = productData?.tariffs && productData.tariffs.length > 0;
  const product = productData?.product;
  const tariffs = productData?.tariffs || [];

  // Section title and subtitle
  const sectionTitle = product?.public_title || "Тарифы Клуба";
  const sectionSubtitle = product?.public_subtitle || "Выберите подходящий формат участия";
  const disclaimer = product?.payment_disclaimer_text || 
    "Безопасная оплата через bePaid. Принимаем Visa, Mastercard, Белкарт, ЕРИП.";

  return (
    <section id="pricing" className="py-20 relative">
      {/* Background */}
      <div className="absolute inset-0 bg-primary/5 -z-10" />

      <div className="container mx-auto px-4">
        <AnimatedSection className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            {sectionTitle}
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            {sectionSubtitle}
          </p>
        </AnimatedSection>

        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {hasDynamicTariffs
            ? // Dynamic tariffs from DB
              tariffs.map((tariff, index) => {
                const visibleFeatures = tariff.features.filter(isFeatureVisible);
                const price = tariff.current_price || tariff.original_price || 0;
                const payOffer = tariff.offers?.find((o) => o.offer_type === "pay_now");
                const trialOffer = tariff.offers?.find((o) => o.offer_type === "trial");

                return (
                  <AnimatedSection key={tariff.id} animation="fade-up" delay={index * 150}>
                    <div
                      className={`relative p-6 rounded-2xl border transition-all duration-300 hover:shadow-xl h-full flex flex-col ${
                        tariff.is_popular
                          ? "border-primary shadow-lg scale-105"
                          : "border-border/50"
                      }`}
                      style={{
                        background:
                          "linear-gradient(135deg, hsl(var(--card) / 0.95), hsl(var(--card) / 0.85))",
                        backdropFilter: "blur(20px)",
                      }}
                    >
                      {tariff.badge && (
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1">
                          <Star size={14} />
                          {tariff.badge}
                        </div>
                      )}

                      <div className="text-center mb-6">
                        <h3 className="text-xl font-bold text-foreground mb-2">
                          {tariff.name}
                        </h3>
                        {tariff.subtitle && (
                          <p className="text-sm text-muted-foreground mb-4">
                            {tariff.subtitle}
                          </p>
                        )}
                        <div className="flex items-baseline justify-center gap-1">
                          <span className="text-4xl font-bold text-foreground">{price}</span>
                          <span className="text-muted-foreground">
                            {tariff.period_label || "BYN/мес"}
                          </span>
                        </div>
                      </div>

                      <ul className="space-y-3 mb-6 flex-1">
                        {visibleFeatures.map((feature) => (
                          <li
                            key={feature.id}
                            className={`flex items-start gap-2 ${
                              feature.link_url ? "cursor-pointer hover:text-primary" : ""
                            }`}
                            onClick={() => feature.link_url && window.open(feature.link_url, "_blank")}
                          >
                            <div
                              className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                                feature.is_bonus
                                  ? "bg-amber-500/20"
                                  : "bg-primary/10"
                              }`}
                            >
                              {feature.is_bonus ? (
                                <Gift className="text-amber-500" size={12} />
                              ) : (
                                <Check className="text-primary" size={12} />
                              )}
                            </div>
                            <span
                              className={`text-sm ${
                                feature.is_bonus
                                  ? "text-foreground font-medium"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {feature.text}
                              {feature.label && (
                                <span className="ml-1 text-xs text-amber-600">
                                  {feature.label}
                                </span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>

                      {/* Buttons from tariff_offers */}
                      <div className="space-y-2">
                        {payOffer && (
                          <Button
                            onClick={() =>
                              handleSelectPlan(
                                tariff.name,
                                String(payOffer.amount),
                                tariff.code,
                                productData?.product?.id
                              )
                            }
                            className="w-full gap-2"
                            variant={tariff.is_popular ? "default" : "outline"}
                          >
                            <CreditCard size={16} />
                            {payOffer.button_label}
                          </Button>
                        )}
                        {trialOffer && (
                          <Button
                            onClick={() =>
                              handleSelectPlan(
                                tariff.name,
                                String(trialOffer.amount),
                                tariff.code,
                                productData?.product?.id,
                                true,
                                trialOffer.trial_days || 5
                              )
                            }
                            className="w-full gap-2"
                            variant="secondary"
                          >
                            <Zap size={16} />
                            {trialOffer.button_label}
                          </Button>
                        )}
                        {!payOffer && !trialOffer && (
                          <Button
                            onClick={() =>
                              handleSelectPlan(
                                tariff.name,
                                String(price),
                                tariff.code,
                                productData?.product?.id
                              )
                            }
                            className="w-full gap-2"
                            variant={tariff.is_popular ? "default" : "outline"}
                          >
                            <CreditCard size={16} />
                            Оплатить
                          </Button>
                        )}
                      </div>
                    </div>
                  </AnimatedSection>
                );
              })
            : // Fallback static plans
              fallbackPlans.map((plan, index) => (
                <AnimatedSection key={index} animation="fade-up" delay={index * 150}>
                  <div
                    className={`relative p-6 rounded-2xl border transition-all duration-300 hover:shadow-xl h-full flex flex-col ${
                      plan.popular
                        ? "border-primary shadow-lg scale-105"
                        : "border-border/50"
                    }`}
                    style={{
                      background:
                        "linear-gradient(135deg, hsl(var(--card) / 0.95), hsl(var(--card) / 0.85))",
                      backdropFilter: "blur(20px)",
                    }}
                  >
                    {plan.popular && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1">
                        <Star size={14} />
                        Популярный
                      </div>
                    )}

                    <div className="text-center mb-6">
                      <h3 className="text-xl font-bold text-foreground mb-2">{plan.name}</h3>
                      <p className="text-sm text-muted-foreground mb-4">{plan.description}</p>
                      <div className="flex items-baseline justify-center gap-1">
                        <span className="text-4xl font-bold text-foreground">{plan.price}</span>
                        <span className="text-muted-foreground">{plan.period}</span>
                      </div>
                    </div>

                    <ul className="space-y-3 mb-6 flex-1">
                      {plan.features.map((feature, featureIndex) => (
                        <li key={featureIndex} className="flex items-start gap-2">
                          <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <Check className="text-primary" size={12} />
                          </div>
                          <span className="text-sm text-muted-foreground">{feature}</span>
                        </li>
                      ))}
                    </ul>

                    <Button
                      onClick={() =>
                        handleSelectPlan(plan.name, plan.price, plan.name.toLowerCase())
                      }
                      className="w-full gap-2"
                      variant={plan.popular ? "default" : "outline"}
                    >
                      <CreditCard size={16} />
                      Оплатить
                    </Button>
                  </div>
                </AnimatedSection>
              ))}
        </div>

        {/* Payment info */}
        <AnimatedSection animation="fade-up" delay={500}>
          <div className="mt-12 text-center">
            <p className="text-sm text-muted-foreground">{disclaimer}</p>
          </div>
        </AnimatedSection>
      </div>

      {/* Payment Dialog */}
      {selectedPlan && (
        <PaymentDialog
          open={!!selectedPlan}
          onOpenChange={(open) => !open && setSelectedPlan(null)}
          productId={selectedPlan.productId}
          productName={selectedPlan.name}
          price={selectedPlan.price}
          tariffCode={selectedPlan.tariffCode}
          isTrial={selectedPlan.isTrial}
          trialDays={selectedPlan.trialDays}
        />
      )}
    </section>
  );
}
