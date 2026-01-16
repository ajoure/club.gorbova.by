import { AnimatedSection } from "@/components/landing/AnimatedSection";
import { Video, Smartphone, Gamepad2, FileText, TrendingUp } from "lucide-react";

const steps = [
  { 
    icon: Video, 
    title: "Живые конференции", 
    description: "Общаетесь с Катериной онлайн. Можно посмотреть в записи",
    number: "01"
  },
  { 
    icon: Smartphone, 
    title: "Уроки на платформе", 
    description: "Смотрите в записи на Chatium в удобное время",
    number: "02"
  },
  { 
    icon: Gamepad2, 
    title: "Интерактивные задания", 
    description: "Игровые механики помогают усвоить материал",
    number: "03"
  },
  { 
    icon: FileText, 
    title: "Перечень НПА", 
    description: "К каждому доводу из занятий — ссылка на законодательство",
    number: "04"
  },
  { 
    icon: TrendingUp, 
    title: "98% доходимость", 
    description: "Благодаря особому подходу и поддержке кураторов",
    number: "05"
  }
];

export function CourseLearningProcess() {
  return (
    <section className="py-20 md:py-28 bg-muted/30 relative overflow-hidden">
      <div className="container mx-auto px-4 relative z-10">
        <AnimatedSection>
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold mb-6">Как проходит обучение</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Уникальная методика, которая обеспечивает 98% доходимость
            </p>
          </div>
        </AnimatedSection>

        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {steps.map((step, index) => (
              <AnimatedSection key={index} delay={index * 100}>
                <div className="group relative bg-card/50 backdrop-blur-xl rounded-2xl p-6 border border-border/50 hover:border-primary/30 transition-all duration-300 h-full hover:shadow-lg hover:shadow-primary/5">
                  {/* Number badge */}
                  <div className="absolute -top-3 -left-3 w-8 h-8 rounded-lg bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center shadow-lg">
                    {step.number}
                  </div>
                  
                  {/* Glass shine effect */}
                  <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  
                  <div className="relative z-10 pt-2">
                    <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-300">
                      <step.icon className="w-7 h-7 text-primary" />
                    </div>
                    <h3 className="text-lg font-semibold mb-3 group-hover:text-primary transition-colors">{step.title}</h3>
                    <p className="text-muted-foreground text-sm leading-relaxed">{step.description}</p>
                  </div>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
