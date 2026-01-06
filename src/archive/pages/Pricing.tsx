import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Sparkles, Zap, Crown, Video } from "lucide-react";
import { useSubscription } from "@/hooks/useSubscription";

const tiers = [
  {
    id: "free",
    name: "Free",
    description: "Базовый доступ к платформе",
    price: "0",
    period: "навсегда",
    icon: Zap,
    color: "hsl(220 9% 46%)",
    features: [
      "Доступ к бесплатным материалам",
      "Колесо баланса (просмотр)",
      "Матрица продуктивности (5 задач)",
      "Базовые инструменты",
    ],
    limitations: [
      "Ограниченный контент",
      "Без поддержки",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    description: "Для активных профессионалов",
    price: "49",
    period: "в месяц",
    icon: Sparkles,
    color: "hsl(217 91% 60%)",
    popular: true,
    features: [
      "Всё из Free",
      "Полный доступ к разделам",
      "Безлимитные задачи",
      "Сохранение данных",
      "Q&A с экспертами",
      "Приоритетная поддержка",
    ],
    limitations: [],
  },
  {
    id: "premium",
    name: "Premium",
    description: "Максимальные возможности",
    price: "99",
    period: "в месяц",
    icon: Crown,
    color: "hsl(38 92% 50%)",
    features: [
      "Всё из Pro",
      "Эксклюзивные вебинары",
      "Личные консультации",
      "Ранний доступ к материалам",
      "Закрытое сообщество",
      "Персональный менеджер",
    ],
    limitations: [],
  },
];

const webinarTier = {
  id: "webinar",
  name: "Разовый вебинар",
  description: "Доступ к одному вебинару",
  price: "19",
  period: "разово",
  icon: Video,
  color: "hsl(258 90% 66%)",
  features: [
    "Доступ к выбранному вебинару",
    "Запись на 30 дней",
    "Материалы вебинара",
    "Сертификат участия",
  ],
};

export default function Pricing() {
  const { tier: currentTier, loading } = useSubscription();

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-foreground mb-3">Тарифы</h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Выберите план, который соответствует вашим целям. 
            Все тарифы включают доступ к сообществу профессионалов.
          </p>
        </div>

        {/* Main tiers */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {tiers.map((tier) => {
            const Icon = tier.icon;
            const isCurrent = currentTier === tier.id;
            
            return (
              <GlassCard 
                key={tier.id}
                className={`relative ${tier.popular ? 'ring-2 ring-primary' : ''}`}
              >
                {tier.popular && (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">
                    Популярный
                  </Badge>
                )}
                
                <div className="text-center mb-6">
                  <div 
                    className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                    style={{ backgroundColor: `${tier.color}20`, color: tier.color }}
                  >
                    <Icon className="w-7 h-7" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground">{tier.name}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{tier.description}</p>
                </div>

                <div className="text-center mb-6">
                  <div className="flex items-baseline justify-center gap-1">
                    <span className="text-4xl font-bold text-foreground">${tier.price}</span>
                    <span className="text-muted-foreground">/ {tier.period}</span>
                  </div>
                </div>

                <ul className="space-y-3 mb-6">
                  {tier.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <span className="text-foreground">{feature}</span>
                    </li>
                  ))}
                  {tier.limitations.map((limitation, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="w-4 h-4 shrink-0 text-center">—</span>
                      <span>{limitation}</span>
                    </li>
                  ))}
                </ul>

                <Button 
                  className="w-full" 
                  variant={isCurrent ? "outline" : tier.popular ? "default" : "secondary"}
                  disabled={isCurrent || loading}
                >
                  {isCurrent ? "Текущий план" : "Выбрать план"}
                </Button>
              </GlassCard>
            );
          })}
        </div>

        {/* Webinar tier */}
        <GlassCard className="mt-8">
          <div className="flex flex-col md:flex-row items-center gap-6">
            <div 
              className="w-16 h-16 rounded-2xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: `${webinarTier.color}20`, color: webinarTier.color }}
            >
              <webinarTier.icon className="w-8 h-8" />
            </div>
            
            <div className="flex-1 text-center md:text-left">
              <h3 className="text-xl font-bold text-foreground">{webinarTier.name}</h3>
              <p className="text-muted-foreground">{webinarTier.description}</p>
              <div className="flex flex-wrap gap-4 mt-3 justify-center md:justify-start">
                {webinarTier.features.map((feature, i) => (
                  <span key={i} className="flex items-center gap-1 text-sm text-foreground">
                    <Check className="w-4 h-4 text-primary" />
                    {feature}
                  </span>
                ))}
              </div>
            </div>
            
            <div className="text-center shrink-0">
              <div className="text-3xl font-bold text-foreground mb-2">
                ${webinarTier.price}
                <span className="text-base font-normal text-muted-foreground"> / {webinarTier.period}</span>
              </div>
              <Button variant="outline">
                Смотреть вебинары
              </Button>
            </div>
          </div>
        </GlassCard>

        {/* FAQ hint */}
        <div className="text-center text-sm text-muted-foreground">
          <p>Есть вопросы? Свяжитесь с нашей поддержкой или посмотрите FAQ.</p>
        </div>
      </div>
    </DashboardLayout>
  );
}
