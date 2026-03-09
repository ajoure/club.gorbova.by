import { AnimatedSection } from "@/components/landing/AnimatedSection";
import { Button } from "@/components/ui/button";
import { Check, Shield, Clock, Sparkles } from "lucide-react";

const PRODUCT_ID = "73c29914-63a3-4f4f-ac42-9f5287e58696";

const features = [
  "5 модулей: от инвентаризации до учётной политики",
  "Готовые шаблоны и промпты для нейросетей",
  "Разборы реальных кейсов",
  "Наставничество от Катерины Горбовой",
  "Доступ 90 дней",
];

interface CloseYearPricingProps {
  onPurchase: () => void;
  onPreregister: () => void;
}

export function CloseYearPricing({ onPurchase, onPreregister }: CloseYearPricingProps) {
  return (
    <section id="pricing" className="py-20 md:py-28 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-background via-muted/10 to-background" />

      <div className="container mx-auto px-4 relative z-10">
        <AnimatedSection>
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold mb-4">Стоимость</h2>
            <p className="text-lg text-muted-foreground">Один тариф — максимум пользы</p>
          </div>
        </AnimatedSection>

        <AnimatedSection delay={100}>
          <div className="max-w-lg mx-auto">
            <div
              className="relative p-8 md:p-10 rounded-3xl border transition-all duration-300"
              style={{
                background: "linear-gradient(135deg, hsl(var(--card) / 0.5), hsl(var(--card) / 0.2))",
                backdropFilter: "blur(24px)",
                borderColor: "hsl(43, 50%, 55% / 0.3)",
                boxShadow: "0 0 60px hsl(43, 50%, 55% / 0.08)",
              }}
            >
              {/* Badge */}
              <div className="flex justify-center mb-6">
                <div
                  className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium"
                  style={{
                    background: "linear-gradient(135deg, hsl(43, 50%, 55% / 0.2), hsl(43, 50%, 55% / 0.05))",
                    border: "1px solid hsl(43, 50%, 55% / 0.3)",
                    color: "hsl(43, 50%, 65%)",
                  }}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Стандартный
                </div>
              </div>

              {/* Price */}
              <div className="text-center mb-8">
                <div className="text-5xl md:text-6xl font-bold mb-2" style={{ color: "hsl(43, 50%, 55%)" }}>
                  900
                </div>
                <span className="text-lg text-muted-foreground">BYN</span>
              </div>

              {/* Features */}
              <ul className="space-y-3 mb-8">
                {features.map((feature, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <Check className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "hsl(43, 50%, 55%)" }} />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              {/* Info badges */}
              <div className="flex justify-center gap-4 mb-8 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  Доступ: 90 дней
                </span>
                <span className="flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5" />
                  Безопасная оплата
                </span>
              </div>

              {/* Buttons — uses existing canonical flow */}
              <div className="space-y-3">
                <Button
                  size="lg"
                  className="w-full text-lg py-6 rounded-2xl font-semibold"
                  style={{
                    background: "linear-gradient(135deg, hsl(43, 50%, 55%), hsl(43, 40%, 45%))",
                    color: "hsl(220, 20%, 10%)",
                    border: "none",
                  }}
                  onClick={onPurchase}
                >
                  Оплатить 900 BYN
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  className="w-full rounded-2xl"
                  onClick={onPreregister}
                >
                  Записаться на курс
                </Button>
              </div>
            </div>
          </div>
        </AnimatedSection>
      </div>
    </section>
  );
}

export { PRODUCT_ID as CLOSE_YEAR_PRODUCT_ID };
