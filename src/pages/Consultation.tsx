import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/GlassCard";
import { ConsultationHeader } from "@/components/consultation/ConsultationHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { AnimatedSection } from "@/components/landing/AnimatedSection";
import { ConsultationPaymentDialog } from "@/components/payment/ConsultationPaymentDialog";
import { 
  Check, 
  Clock, 
  Zap,
  Shield, 
  Scale, 
  Building2,
  Coins,
  FileText,
  Users,
  TrendingUp,
  Award,
  ChevronRight
} from "lucide-react";

const targetAudience = [
  {
    icon: Building2,
    text: "Вы работаете через несколько юрлиц или ИП, со знакомыми или семьёй и не хотите столкнуться с обвинением в дроблении бизнеса",
  },
  {
    icon: TrendingUp,
    text: "Вы работаете в высокомаржинальной нише, и ваш доход может представлять интерес для государства",
  },
  {
    icon: Coins,
    text: "Вы зарабатываете на криптовалюте или оказываете финансовые услуги (р2р, арбитраж, оплаты за третьих лиц, зарубежные переводы и т.д.)",
  },
  {
    icon: Scale,
    text: "Ваши расходы превышают доходы, но вы не хотите платить 26% налога",
  },
  {
    icon: FileText,
    text: "Вы не понимаете, какая форма работы выгоднее именно вам (самозанятость, ИП, юрлицо, выбор системы налогообложения, лицензии, сертификаты, профобразование, предмет договора)",
  },
  {
    icon: Shield,
    text: "Вы знаете, что формально требуется лицензия или профобразование, но хотите продолжить зарабатывать законно",
  },
  {
    icon: Users,
    text: "У вас есть сложный вопрос, на который вы не получаете внятного ответа",
  },
];

const achievements = [
  { number: "500+", label: "ИП сохранили УСН в 2022 году" },
  { number: "150+", label: "управляющих-ИП сохранили УСН" },
  { number: "$100k+", label: "сэкономлено на подоходном налоге" },
  { number: "$2.7M", label: "ущерба избежали клиенты" },
];

const results = [
  "Многим самозанятым и ИП избежать обвинений в незаконной предпринимательской деятельности",
  "Тренерам продолжить зарабатывать в 2024 году без профильного образования",
  "Более чем 500 ИП сохранить УСН в 2022 году, когда это считалось невозможным",
  "Более чем 150 управляющим-ИП сохранить УСН, когда все говорили, что это запрещено",
  "Не заплатить беларусам в сумме более 100 000 долларов подоходного налога с донатов только за 2020 год",
  "Выигрывать суды по делам о незаконной предпринимательской деятельности и уклонении от уплаты налогов",
];

interface TariffProps {
  title: string;
  price: number;
  description: string;
  waitTime: string;
  isPopular?: boolean;
  onSelect: () => void;
}

function TariffCard({ title, price, description, waitTime, isPopular, onSelect }: TariffProps) {
  return (
    <GlassCard 
      className={`p-8 relative ${isPopular ? 'border-primary/50 ring-2 ring-primary/20' : ''}`}
    >
      {isPopular && (
        <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">
          Популярный
        </Badge>
      )}
      
      <div className="text-center mb-6">
        <div className={`w-14 h-14 rounded-xl mx-auto mb-4 flex items-center justify-center ${isPopular ? 'bg-primary/20' : 'bg-muted'}`}>
          {isPopular ? <Zap className="text-primary" size={28} /> : <Clock className="text-muted-foreground" size={28} />}
        </div>
        <h3 className="text-xl font-bold text-foreground mb-2">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      
      <div className="text-center mb-6">
        <div className="text-4xl font-bold text-foreground mb-1">{price} BYN</div>
        <div className="text-sm text-muted-foreground flex items-center justify-center gap-2">
          <Clock size={14} />
          {waitTime}
        </div>
      </div>
      
      <Button 
        onClick={onSelect}
        className="w-full"
        variant={isPopular ? "default" : "outline"}
        size="lg"
      >
        Записаться
        <ChevronRight className="ml-2 h-4 w-4" />
      </Button>
    </GlassCard>
  );
}

export default function Consultation() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [selectedTariff, setSelectedTariff] = useState<{
    code: string;
    name: string;
    price: number;
  } | null>(null);

  // Restore tariff selection from URL after auth redirect
  useEffect(() => {
    const tariffParam = searchParams.get("tariff");
    if (tariffParam === "CONSULTATION_STANDARD") {
      setSelectedTariff({ code: "CONSULTATION_STANDARD", name: "Несрочная консультация", price: 500 });
      setPaymentOpen(true);
      searchParams.delete("tariff");
      setSearchParams(searchParams, { replace: true });
    } else if (tariffParam === "CONSULTATION_URGENT") {
      setSelectedTariff({ code: "CONSULTATION_URGENT", name: "Срочная консультация", price: 800 });
      setPaymentOpen(true);
      searchParams.delete("tariff");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const handleSelectTariff = (code: string, name: string, price: number) => {
    setSelectedTariff({ code, name, price });
    setSearchParams({ tariff: code });
    setPaymentOpen(true);
  };

  return (
    <div className="min-h-screen bg-background">
      <ConsultationHeader />
      
      {/* Hero Section */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        <div
          className="absolute inset-0 -z-10"
          style={{
            background: "var(--gradient-background)",
          }}
        />
        <div className="absolute top-1/4 right-0 w-96 h-96 rounded-full bg-primary/10 blur-3xl -z-10" />
        <div className="absolute bottom-1/4 left-0 w-80 h-80 rounded-full bg-accent/10 blur-3xl -z-10" />

        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto text-center">
            <AnimatedSection animation="fade-up">
              <Badge variant="secondary" className="mb-6 bg-primary/10 text-primary border-0">
                <Shield size={14} className="mr-1" />
                Индивидуальный подход
              </Badge>
            </AnimatedSection>

            <AnimatedSection animation="fade-up" delay={100}>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground leading-tight mb-6">
                Платная консультация{" "}
                <span className="text-primary">Катерины Горбова</span>
              </h1>
            </AnimatedSection>

            <AnimatedSection animation="fade-up" delay={200}>
              <p className="text-xl text-muted-foreground mb-4">
                Хотите работать законно, платить минимально возможные налоги, находить легальные решения в законодательстве и иметь грамотную стратегию защиты бизнеса?
              </p>
            </AnimatedSection>

            <AnimatedSection animation="fade-up" delay={300}>
              <p className="text-lg text-muted-foreground mb-10">
                Меня зовут Катерина Горбова. Я бухгалтер. Моя экспертность в защите бизнеса от государства значительно превышает ценность стандартных адвокатских услуг.
              </p>
            </AnimatedSection>

            <AnimatedSection animation="fade-up" delay={400}>
              <Button 
                size="lg" 
                onClick={() => document.getElementById("tariffs")?.scrollIntoView({ behavior: "smooth" })}
                className="text-lg px-8 py-6"
              >
                Записаться на консультацию
                <ChevronRight className="ml-2" />
              </Button>
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* Target Audience Section */}
      <section id="audience" className="py-20">
        <div className="container mx-auto px-4">
          <AnimatedSection animation="fade-up">
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
                Кому подходит консультация
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Вам стоит попасть ко мне на консультацию, если:
              </p>
            </div>
          </AnimatedSection>

          <div className="max-w-4xl mx-auto">
            <GlassCard className="p-8">
              <ul className="space-y-5">
                {targetAudience.map((item, index) => (
                  <AnimatedSection key={index} animation="fade-up" delay={index * 50}>
                    <li className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <item.icon className="text-primary" size={20} />
                      </div>
                      <span className="text-foreground">{item.text}</span>
                    </li>
                  </AnimatedSection>
                ))}
              </ul>
            </GlassCard>
          </div>
        </div>
      </section>

      {/* Achievements Section */}
      <section id="results" className="py-20 relative overflow-hidden">
        <div className="absolute inset-0 bg-muted/50 -z-10" />
        <div className="container mx-auto px-4">
          <AnimatedSection animation="fade-up">
            <div className="text-center mb-12">
              <Badge variant="secondary" className="mb-4 bg-primary/10 text-primary border-0">
                <Award size={14} className="mr-1" />
                Результаты
              </Badge>
              <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
                Экспертность и результаты
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Мой нестандартный подход позволил:
              </p>
            </div>
          </AnimatedSection>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-12">
            {achievements.map((stat, index) => (
              <AnimatedSection key={index} animation="fade-up" delay={index * 100}>
                <GlassCard className="p-6 text-center">
                  <div className="text-3xl font-bold text-primary mb-2">{stat.number}</div>
                  <div className="text-sm text-muted-foreground">{stat.label}</div>
                </GlassCard>
              </AnimatedSection>
            ))}
          </div>

          {/* Results List */}
          <div className="max-w-3xl mx-auto">
            <GlassCard className="p-8">
              <ul className="space-y-4">
                {results.map((result, index) => (
                  <AnimatedSection key={index} animation="fade-up" delay={index * 50}>
                    <li className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Check className="text-primary" size={14} />
                      </div>
                      <span className="text-foreground">{result}</span>
                    </li>
                  </AnimatedSection>
                ))}
              </ul>
            </GlassCard>
          </div>
        </div>
      </section>

      {/* Tariffs Section */}
      <section id="tariffs" className="py-20">
        <div className="container mx-auto px-4">
          <AnimatedSection animation="fade-up">
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
                Тарифы консультации
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Выберите подходящий вариант в зависимости от срочности вашего вопроса
              </p>
            </div>
          </AnimatedSection>

          <div className="max-w-3xl mx-auto grid md:grid-cols-2 gap-8">
            <AnimatedSection animation="fade-right">
              <TariffCard
                title="Несрочная консультация"
                price={500}
                description="Подходит для вопросов, не требующих срочного решения"
                waitTime="Срок ожидания — до 2 месяцев"
                onSelect={() => handleSelectTariff("CONSULTATION_STANDARD", "Несрочная консультация", 500)}
              />
            </AnimatedSection>

            <AnimatedSection animation="fade-left">
              <TariffCard
                title="Срочная консультация"
                price={800}
                description="Подходит для срочных и чувствительных ситуаций"
                waitTime="Срок ожидания — 2-3 рабочих дня"
                isPopular
                onSelect={() => handleSelectTariff("CONSULTATION_URGENT", "Срочная консультация", 800)}
              />
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* After Payment Section */}
      <section id="after-payment" className="py-20 relative overflow-hidden">
        <div className="absolute inset-0 bg-muted/50 -z-10" />
        <div className="container mx-auto px-4">
          <AnimatedSection animation="fade-up">
            <div className="max-w-3xl mx-auto">
              <GlassCard className="p-8 md:p-12">
                <div className="text-center mb-8">
                  <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-4">
                    После оплаты
                  </h2>
                </div>
                
                <div className="space-y-6">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-primary font-bold">1</span>
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground mb-1">Связь с менеджером</h3>
                      <p className="text-muted-foreground">
                        После оплаты с вами связывается менеджер и назначает время консультации
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-primary font-bold">2</span>
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground mb-1">Подготовка материалов</h3>
                      <p className="text-muted-foreground">
                        Для экономии времени консультации вы можете заранее направить вопросы и материалы
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-primary font-bold">3</span>
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground mb-1">Глубокий анализ</h3>
                      <p className="text-muted-foreground">
                        Я ознакомлюсь с ними заранее и на консультации дам не только ответы, но и правовой фундамент для более глубокого понимания ситуации
                      </p>
                    </div>
                  </div>
                </div>
              </GlassCard>
            </div>
          </AnimatedSection>
        </div>
      </section>

      <LandingFooter />

      {/* Payment Dialog */}
      {selectedTariff && (
        <ConsultationPaymentDialog
          open={paymentOpen}
          onOpenChange={setPaymentOpen}
          tariffCode={selectedTariff.code}
          tariffName={selectedTariff.name}
          price={selectedTariff.price}
        />
      )}
    </div>
  );
}
