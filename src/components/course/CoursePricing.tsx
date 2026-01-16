import { AnimatedSection } from "@/components/landing/AnimatedSection";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Sparkles, Crown } from "lucide-react";

interface TariffData {
  id: string;
  name: string;
  subtitle: string;
  price: number;
  originalPrice?: number;
  monthly?: number;
  accessMonths: number;
  conferences: number;
  features: string[];
  isPopular?: boolean;
  badge?: string;
}

const tariffs: TariffData[] = [
  {
    id: "buh",
    name: "Бухгалтер",
    subtitle: "Для тех, кто хочет полюбить бухгалтерию",
    price: 1490,
    originalPrice: 1690,
    monthly: 136,
    accessMonths: 6,
    conferences: 5,
    features: [
      "Предобучение",
      "18 основных модулей",
      "Задания с подробными разборами",
      "Материалы, тетрадь, майндкарты",
      "Доступ к клубу «Буква закона»",
      "Итоговый конспект",
      "Сертификат о прохождении",
      "VIP модули: Делегирование, Найм, Таймлайн"
    ]
  },
  {
    id: "gl-buh",
    name: "Главный бухгалтер",
    subtitle: "Полная программа с глубоким погружением",
    price: 2490,
    originalPrice: 2690,
    monthly: 227,
    accessMonths: 8,
    conferences: 6,
    isPopular: true,
    badge: "Популярный",
    features: [
      "Всё из тарифа «Бухгалтер»",
      "Доступ к Клубу тариф Full на 4 недели",
      "Grand модуль: Налоговое законодательство",
      "Grand модуль: Система в бухгалтерии",
      "Письменная характеристика",
      "Личная рекомендация от Катерины"
    ]
  },
  {
    id: "biz-lady",
    name: "Бизнес-леди",
    subtitle: "Максимальный результат после курса",
    price: 2490,
    originalPrice: 2690,
    monthly: 163,
    accessMonths: 10,
    conferences: 6,
    badge: "VIP",
    features: [
      "Всё из тарифа «Главный бухгалтер»",
      "Business модуль: Экспресс-аудит",
      "Business модуль: Восстановление учета",
      "Скидка 50% на модули по отраслям",
      "Дополнительная живая встреча"
    ]
  }
];

interface CoursePricingProps {
  onPreregister?: (tariff: TariffData) => void;
  onPurchase?: (tariff: TariffData) => void;
}

export function CoursePricing({ onPreregister, onPurchase }: CoursePricingProps) {
  return (
    <section id="tariffs" className="py-20 md:py-28 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-background via-muted/20 to-background" />
      
      <div className="container mx-auto px-4 relative z-10">
        <AnimatedSection>
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold mb-6">Выберите тариф</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Рассрочка до 12 месяцев без переплат
            </p>
          </div>
        </AnimatedSection>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {tariffs.map((tariff, index) => (
            <AnimatedSection key={tariff.id} delay={index * 100}>
              <div className={`relative bg-card/80 backdrop-blur-xl rounded-3xl p-6 md:p-8 border h-full flex flex-col transition-all duration-300 hover:shadow-xl ${
                tariff.isPopular 
                  ? 'border-primary shadow-lg shadow-primary/10 scale-[1.02]' 
                  : 'border-border/50 hover:border-primary/30'
              }`}>
                {tariff.badge && (
                  <Badge className={`absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 ${
                    tariff.isPopular 
                      ? 'bg-primary text-primary-foreground' 
                      : 'bg-gradient-to-r from-purple-500 to-pink-500 text-white border-0'
                  }`}>
                    {tariff.isPopular ? <Sparkles className="w-3 h-3 mr-1" /> : <Crown className="w-3 h-3 mr-1" />}
                    {tariff.badge}
                  </Badge>
                )}
                
                <div className="text-center mb-6 pt-2">
                  <h3 className="text-xl font-bold mb-2">{tariff.name}</h3>
                  <p className="text-sm text-muted-foreground mb-4">{tariff.subtitle}</p>
                  
                  <div className="flex items-baseline justify-center gap-2">
                    <span className="text-4xl font-bold">{tariff.price}</span>
                    <span className="text-muted-foreground">BYN</span>
                  </div>
                  {tariff.originalPrice && (
                    <div className="text-sm text-muted-foreground line-through">
                      {tariff.originalPrice} BYN
                    </div>
                  )}
                  {tariff.monthly && (
                    <div className="text-sm text-primary mt-1">
                      или от {tariff.monthly} BYN/мес
                    </div>
                  )}
                  
                  <div className="flex justify-center gap-4 mt-4 text-xs text-muted-foreground">
                    <span>Доступ: {tariff.accessMonths} мес</span>
                    <span>•</span>
                    <span>{tariff.conferences} конференций</span>
                  </div>
                </div>
                
                <ul className="space-y-3 mb-6 flex-1">
                  {tariff.features.map((feature, featureIndex) => (
                    <li key={featureIndex} className="flex items-start gap-2 text-sm">
                      <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                
                <div className="space-y-2">
                  <Button 
                    className={`w-full ${tariff.isPopular ? '' : 'bg-primary/90 hover:bg-primary'}`}
                    size="lg"
                    onClick={() => onPurchase?.(tariff)}
                  >
                    Оплатить {tariff.price} BYN
                  </Button>
                  <Button 
                    className="w-full" 
                    variant="outline"
                    onClick={() => onPreregister?.(tariff)}
                  >
                    Рассрочка от {tariff.monthly} BYN/мес
                  </Button>
                </div>
              </div>
            </AnimatedSection>
          ))}
        </div>
      </div>
    </section>
  );
}
