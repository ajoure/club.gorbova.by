import { AnimatedSection } from "@/components/landing/AnimatedSection";
import { CheckCircle2, Award, Users, FileCheck, Scale, Trophy } from "lucide-react";

const stats = [
  { icon: Award, value: "12+", label: "лет опыта" },
  { icon: Users, value: "2500+", label: "клиентов AJOURE" },
  { icon: FileCheck, value: "400+", label: "пройденных проверок" },
  { icon: Scale, value: "$2.7 млн", label: "выигранный суд" },
];

const achievements = [
  "Эксперт в бухгалтерии с опытом 12+ лет",
  "Основала агентство AJOURE: 2500+ клиентов",
  "Выиграла суд клиенту на 2.7 млн $",
  "Аттестованный аудитор Республики Беларусь",
  "Автор уникальной методологии обучения",
  "Гигантский опыт работы с проверяющими органами",
  "Создатель клуба «Буква Закона» для бухгалтеров",
];

export function CourseExpert() {
  return (
    <section id="expert" className="py-20 md:py-28 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(222,47%,14%)] to-[hsl(222,47%,10%)]" />
      
      {/* Decorative elements */}
      <div className="absolute top-1/3 right-0 w-80 h-80 bg-[hsl(43,50%,55%)] opacity-5 rounded-full blur-3xl" />
      <div className="absolute bottom-1/3 left-0 w-64 h-64 bg-primary opacity-10 rounded-full blur-3xl" />
      
      <div className="container mx-auto px-4 relative z-10">
        <AnimatedSection>
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold mb-4 text-white">Ваш эксперт</h2>
          </div>
        </AnimatedSection>

        <div className="max-w-5xl mx-auto">
          <AnimatedSection delay={100}>
            <div className="bg-white/5 backdrop-blur-xl rounded-3xl p-8 md:p-12 border border-white/10 shadow-2xl">
              <div className="flex flex-col lg:flex-row gap-10 items-center">
                {/* Photo placeholder */}
                <div className="relative flex-shrink-0">
                  <div className="w-56 h-56 md:w-64 md:h-64 rounded-full bg-gradient-to-br from-[hsl(43,50%,55%)] to-[hsl(43,60%,45%)] flex items-center justify-center shadow-xl shadow-[hsl(43,50%,50%)/0.2]">
                    <span className="text-7xl md:text-8xl font-bold text-[hsl(222,47%,11%)]">КГ</span>
                  </div>
                  {/* Badge */}
                  <div className="absolute -bottom-2 -right-2 bg-[hsl(43,50%,55%)] text-[hsl(222,47%,11%)] px-4 py-2 rounded-full text-sm font-semibold flex items-center gap-1 shadow-lg">
                    <Trophy className="w-4 h-4" />
                    ТОП эксперт
                  </div>
                </div>
                
                <div className="flex-1 text-center lg:text-left">
                  <h3 className="text-3xl md:text-4xl font-bold mb-2 text-white">Катерина Горбова</h3>
                  <p className="text-[hsl(43,50%,65%)] font-medium mb-6 text-lg">
                    Аудитор, налоговый консультант, эксперт по методологии бухучета
                  </p>
                  
                  {/* Stats */}
                  <div className="flex flex-wrap justify-center lg:justify-start gap-6 mb-8">
                    {stats.map((stat, index) => (
                      <div key={index} className="text-center">
                        <div className="flex items-center justify-center gap-1 mb-1">
                          <stat.icon className="w-4 h-4 text-[hsl(43,50%,55%)]" />
                          <span className="font-bold text-xl text-white">{stat.value}</span>
                        </div>
                        <span className="text-white/50 text-xs">{stat.label}</span>
                      </div>
                    ))}
                  </div>
                  
                  {/* Achievements */}
                  <ul className="space-y-3">
                    {achievements.map((item, index) => (
                      <li key={index} className="flex items-start gap-3 text-sm text-white/80">
                        <CheckCircle2 className="w-4 h-4 text-[hsl(43,50%,55%)] mt-0.5 flex-shrink-0" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </AnimatedSection>
        </div>
      </div>
    </section>
  );
}
