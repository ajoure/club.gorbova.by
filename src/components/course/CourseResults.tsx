import { AnimatedSection } from "@/components/landing/AnimatedSection";
import { TrendingUp, Shield, Award, Clock, Target, BookOpen } from "lucide-react";

const results = [
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

export function CourseResults() {
  return (
    <section className="py-20 md:py-28 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-muted/30 to-background" />
      
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
          {results.map((result, index) => (
            <AnimatedSection key={index} delay={index * 80}>
              <div className="group bg-card/50 backdrop-blur-xl rounded-2xl p-5 border border-border/50 text-center h-full hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 hover:-translate-y-1">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300">
                  <result.icon className="w-6 h-6 text-primary" />
                </div>
                <div className="text-2xl md:text-3xl font-bold text-primary mb-1">{result.value}</div>
                <div className="text-sm font-medium mb-2">{result.label}</div>
                <p className="text-xs text-muted-foreground leading-relaxed">{result.description}</p>
              </div>
            </AnimatedSection>
          ))}
        </div>
      </div>
    </section>
  );
}
