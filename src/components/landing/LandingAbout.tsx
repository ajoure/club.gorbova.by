import { Award, Users, BookOpen, Building2 } from "lucide-react";
import { AnimatedSection } from "./AnimatedSection";
const stats = [{
  icon: Award,
  value: "400+",
  label: "аудитов проведено"
}, {
  icon: Users,
  value: "1000+",
  label: "учеников обучено"
}, {
  icon: BookOpen,
  value: "600+",
  label: "видео в базе знаний"
}, {
  icon: Building2,
  value: "15+",
  label: "лет опыта"
}];
export function LandingAbout() {
  return <section className="py-20">
      <div className="container mx-auto px-4">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            {/* Text content */}
            <AnimatedSection animation="fade-right">
              <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-6">
                Катерина Горбова
              </h2>
              <div className="space-y-4 text-muted-foreground">
                <p>Основатель компаний под брендом AJOURE и Академии бухгалтера. Провела более 400 аудитов, обучила тысячи бухгалтеров.</p>
                <p>
                  За годы практики разобрала сотни сложных ситуаций: от исправления ошибок 
                  до защиты бизнеса в проверках ДФР и КГК.
                </p>
                <p>
                  Миссия — сделать законодательство понятным и помочь бухгалтерам 
                  чувствовать себя уверенно в любой ситуации.
                </p>
              </div>
            </AnimatedSection>

            {/* Stats */}
            <AnimatedSection animation="fade-left">
              <div className="grid grid-cols-2 gap-4">
                {stats.map((stat, index) => <div key={index} className="p-6 rounded-2xl border border-border/50 text-center" style={{
                background: "linear-gradient(135deg, hsl(var(--card) / 0.9), hsl(var(--card) / 0.7))",
                backdropFilter: "blur(20px)"
              }}>
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3 mx-auto">
                      <stat.icon className="text-primary" size={20} />
                    </div>
                    <div className="text-2xl font-bold text-foreground">{stat.value}</div>
                    <div className="text-sm text-muted-foreground">{stat.label}</div>
                  </div>)}
              </div>
            </AnimatedSection>
          </div>
        </div>
      </div>
    </section>;
}