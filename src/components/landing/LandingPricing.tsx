import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Check, Star, CreditCard } from "lucide-react";
import { AnimatedSection } from "./AnimatedSection";
import { PaymentDialog } from "@/components/payment/PaymentDialog";

interface Product {
  id: string;
  name: string;
  price_byn: number;
  currency: string;
}

const plans = [
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
  } | null>(null);

  // Fetch products to get their IDs
  const { data: products } = useQuery({
    queryKey: ["products-for-pricing"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, price_byn, currency")
        .eq("is_active", true)
        .eq("product_type", "subscription");
      
      if (error) throw error;
      return data as Product[];
    },
  });

  const getProductForPlan = (planName: string): Product | undefined => {
    return products?.find((p) => p.name.toUpperCase().includes(planName.toUpperCase()));
  };

  const handleSelectPlan = (planName: string, planPrice: string) => {
    console.log(`[Analytics] click_pricing_plan_${planName.toLowerCase()}`);
    
    const product = getProductForPlan(planName);
    // Map plan name to tariff code for GetCourse
    const tariffCodeMap: Record<string, string> = {
      'CHAT': 'chat',
      'FULL': 'full',
      'BUSINESS': 'business',
    };
    const tariffCode = tariffCodeMap[planName.toUpperCase()] || planName.toLowerCase();
    
    if (product) {
      // Open payment dialog
      setSelectedPlan({
        productId: product.id,
        name: `${planName} — Месячная подписка`,
        price: `${planPrice} BYN`,
        tariffCode,
      });
    } else {
      // No product found, redirect to signup
      navigate("/auth?mode=signup");
    }
  };

  return (
    <section id="pricing" className="py-20 relative">
      {/* Background */}
      <div className="absolute inset-0 bg-primary/5 -z-10" />

      <div className="container mx-auto px-4">
        <AnimatedSection className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            Тарифы Клуба
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Выберите подходящий формат участия
          </p>
        </AnimatedSection>

        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {plans.map((plan, index) => {
            const product = getProductForPlan(plan.name);
            const hasProduct = !!product;

            return (
              <AnimatedSection key={index} animation="fade-up" delay={index * 150}>
                <div
                  className={`relative p-6 rounded-2xl border transition-all duration-300 hover:shadow-xl h-full flex flex-col ${
                    plan.popular
                      ? "border-primary shadow-lg scale-105"
                      : "border-border/50"
                  }`}
                  style={{
                    background: "linear-gradient(135deg, hsl(var(--card) / 0.95), hsl(var(--card) / 0.85))",
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
                    onClick={() => handleSelectPlan(plan.name, plan.price)}
                    className="w-full gap-2"
                    variant={plan.popular ? "default" : "outline"}
                  >
                    {hasProduct && <CreditCard size={16} />}
                    {hasProduct ? "Оплатить" : "Выбрать тариф"}
                  </Button>
                </div>
              </AnimatedSection>
            );
          })}
        </div>

        {/* Payment info */}
        <AnimatedSection animation="fade-up" delay={500}>
          <div className="mt-12 text-center">
            <p className="text-sm text-muted-foreground">
              Безопасная оплата через bePaid. Принимаем Visa, Mastercard, Белкарт, ЕРИП.
            </p>
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
        />
      )}
    </section>
  );
}