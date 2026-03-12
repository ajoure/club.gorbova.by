import { Shield, BookOpen, Lightbulb, TrendingUp, Users } from "lucide-react";
import { AnimatedSection } from "./AnimatedSection";

const benefits = [
  {
    icon: Shield,
    title: "Уверенность в знаниях",
    description: "Перестанете бояться проверок — будете знать свои права и уметь их защищать",
  },
  {
    icon: BookOpen,
    title: "Понятный язык законов",
    description: "Научитесь читать законодательство и применять его без страха ошибиться",
  },
  {
    icon: Lightbulb,
    title: "Готовые алгоритмы действий",
    description: "Получите пошаговые инструкции для любых ситуаций: от запроса налоговой до исправления ошибок",
  },
  {
    icon: TrendingUp,
    title: "Рост дохода",
    description: "Со знаниями вы сможете брать больше клиентов и поднимать чек за услуги",
  },
  {
    icon: Users,
    title: "Поддержка сообщества",
    description: "Всегда есть у кого спросить совета — коллеги и эксперты рядом",
  },
];

export function LandingBenefits() {
  return (
    <section id="benefits" className="py-20 relative">
      {/* Background */}
      <div className="absolute inset-0 bg-primary/5 -z-10" />
      
      <div className="container mx-auto px-4">
        <AnimatedSection className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            Почему вступают в Клуб
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Вот что получают участники от членства
          </p>
        </AnimatedSection>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {benefits.map((benefit, index) => (
            <AnimatedSection key={index} animation="scale" delay={index * 100}>
              <div
                className="p-6 rounded-2xl border border-border/50 transition-all duration-300 hover:shadow-lg hover:-translate-y-1 h-full"
                style={{
                  background: "linear-gradient(135deg, hsl(var(--card) / 0.9), hsl(var(--card) / 0.7))",
                  backdropFilter: "blur(20px)",
                }}
              >
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                  <benefit.icon className="text-primary" size={24} />
                </div>
                <h3 className="font-semibold text-foreground mb-2">{benefit.title}</h3>
                <p className="text-muted-foreground text-sm">{benefit.description}</p>
              </div>
            </AnimatedSection>
          ))}
        </div>
      </div>
    </section>
  );
}
