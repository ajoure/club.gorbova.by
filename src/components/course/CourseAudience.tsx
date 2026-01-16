import { GraduationCap, Briefcase, Users, BookOpen, Scale, Building2 } from "lucide-react";
import { AnimatedSection } from "@/components/landing/AnimatedSection";

const audienceCards = [
  {
    icon: GraduationCap,
    emoji: "👤",
    title: "Новичкам в бухгалтерии",
    description: "Быстрый старт в профессии с нуля. Получите системные знания и уверенность"
  },
  {
    icon: Briefcase,
    emoji: "🌸",
    title: "Бухгалтерам с опытом",
    description: "Вырасти до главного бухгалтера, повысить ценность на рынке и доход"
  },
  {
    icon: Users,
    emoji: "⭐",
    title: "Главным бухгалтерам",
    description: "Консультации от 250$/30мин. Уверенно проходить любые проверки"
  },
  {
    icon: BookOpen,
    emoji: "📚",
    title: "Студентам бухгалтерии",
    description: "Понять методологию простым языком параллельно с теорией в ВУЗе"
  },
  {
    icon: Scale,
    emoji: "⚖️",
    title: "Юристам",
    description: "Выигрывать суды без привлечения бухгалтера, комплексный консалтинг"
  },
  {
    icon: Building2,
    emoji: "🏢",
    title: "Предпринимателям",
    description: "Контролировать бизнес, различать ошибки бухгалтера и защитить активы"
  }
];

export function CourseAudience() {
  return (
    <section id="audience" className="py-20 md:py-28 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-background to-muted/30" />
      
      <div className="container mx-auto px-4 relative z-10">
        <AnimatedSection>
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold mb-6">Для кого этот курс?</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Курс подойдет специалистам с разным уровнем подготовки
            </p>
          </div>
        </AnimatedSection>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {audienceCards.map((card, index) => (
            <AnimatedSection key={index} delay={index * 80}>
              <div className="group relative bg-card/50 backdrop-blur-xl rounded-2xl p-6 border border-border/50 hover:border-primary/30 transition-all duration-500 h-full hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-1">
                {/* Glass shine effect */}
                <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                
                <div className="relative z-10">
                  <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-300">
                    <span className="text-2xl">{card.emoji}</span>
                  </div>
                  <h3 className="text-lg font-semibold mb-3 group-hover:text-primary transition-colors">{card.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{card.description}</p>
                </div>
              </div>
            </AnimatedSection>
          ))}
        </div>
      </div>
    </section>
  );
}
