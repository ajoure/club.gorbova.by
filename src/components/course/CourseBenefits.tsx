import { AnimatedSection } from "@/components/landing/AnimatedSection";
import { TrendingUp, Shield, Target, Award, Clock, BookOpen } from "lucide-react";

const benefits = [
  {
    icon: TrendingUp,
    value: "+40 000",
    label: "BYN/год",
    description: "Средний рост дохода выпускников"
  },
  {
    icon: Shield,
    value: "100%",
    label: "уверенность",
    description: "При любых проверках"
  },
  {
    icon: Target,
    value: "98%",
    label: "доходимость",
    description: "Благодаря методике"
  },
  {
    icon: Award,
    value: "Сертификат",
    label: "о прохождении",
    description: "Официальное подтверждение"
  },
  {
    icon: Clock,
    value: "7",
    label: "недель",
    description: "До первых результатов"
  },
  {
    icon: BookOpen,
    value: "25",
    label: "модулей",
    description: "Полная программа обучения"
  }
];

export function CourseBenefits() {
  return (
    <section id="benefits" className="py-20 md:py-28 relative overflow-hidden bg-muted/30">
      <div className="container mx-auto px-4 relative z-10">
        <AnimatedSection>
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold mb-6">Что вы получите</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Конкретные результаты после прохождения курса
            </p>
          </div>
        </AnimatedSection>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 md:gap-6 max-w-6xl mx-auto">
          {benefits.map((benefit, index) => (
            <AnimatedSection key={index} delay={index * 80}>
              <div className="group bg-card rounded-2xl p-6 border border-border/50 text-center h-full hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 hover:-translate-y-1">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300">
                  <benefit.icon className="w-7 h-7 text-primary" />
                </div>
                <div className="text-2xl md:text-3xl font-bold text-primary mb-1">{benefit.value}</div>
                <div className="text-sm font-medium text-foreground mb-2">{benefit.label}</div>
                <p className="text-xs text-muted-foreground leading-relaxed">{benefit.description}</p>
              </div>
            </AnimatedSection>
          ))}
        </div>
      </div>
    </section>
  );
}
