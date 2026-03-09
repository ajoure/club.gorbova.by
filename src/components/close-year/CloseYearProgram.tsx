import { AnimatedSection } from "@/components/landing/AnimatedSection";
import { BookOpen } from "lucide-react";

interface Module {
  number: number;
  title: string;
  description: string;
}

const modules: Module[] = [
  {
    number: 1,
    title: "Инвентаризация",
    description: "Пошаговая методология проведения инвентаризации активов и обязательств перед закрытием года",
  },
  {
    number: 2,
    title: "Исправляем ошибки",
    description: "Выявление и корректировка ошибок в учёте, сверка данных и подготовка исправительных проводок",
  },
  {
    number: 3,
    title: "Делаем баланс",
    description: "Формирование бухгалтерского баланса: от оборотно-сальдовой ведомости до финальной отчётности",
  },
  {
    number: 4,
    title: "Годовое собрание",
    description: "Подготовка документов для годового собрания участников, утверждение отчётности",
  },
  {
    number: 5,
    title: "Учётная политика",
    description: "Анализ и обновление учётной политики на следующий год с учётом изменений законодательства",
  },
];

export function CloseYearProgram() {
  return (
    <section id="program" className="py-20 md:py-28 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-background via-muted/10 to-background" />

      <div className="container mx-auto px-4 relative z-10">
        <AnimatedSection>
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold mb-4">Программа</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              5 модулей — от инвентаризации до учётной политики
            </p>
          </div>
        </AnimatedSection>

        <div className="max-w-4xl mx-auto grid gap-5">
          {modules.map((mod, index) => (
            <AnimatedSection key={mod.number} delay={index * 100}>
              <div
                className="group relative p-6 md:p-8 rounded-3xl border transition-all duration-300 hover:scale-[1.01]"
                style={{
                  background: "linear-gradient(135deg, hsl(var(--card) / 0.4), hsl(var(--card) / 0.15))",
                  backdropFilter: "blur(24px)",
                  borderColor: "hsl(var(--border) / 0.3)",
                }}
              >
                {/* Gold accent line */}
                <div
                  className="absolute left-0 top-6 bottom-6 w-1 rounded-full opacity-60 group-hover:opacity-100 transition-opacity"
                  style={{ background: "linear-gradient(180deg, hsl(43, 50%, 55%), hsl(43, 40%, 40%))" }}
                />

                <div className="flex items-start gap-5 pl-4">
                  <div
                    className="flex-shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-bold"
                    style={{
                      background: "linear-gradient(135deg, hsl(43, 50%, 55% / 0.15), hsl(43, 50%, 55% / 0.05))",
                      color: "hsl(43, 50%, 55%)",
                    }}
                  >
                    {mod.number}
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <BookOpen className="w-4 h-4 text-muted-foreground" />
                      <span className="text-xs uppercase tracking-wider text-muted-foreground">
                        Модуль {mod.number}
                      </span>
                    </div>
                    <h3 className="text-xl font-semibold mb-2">{mod.title}</h3>
                    <p className="text-muted-foreground leading-relaxed">{mod.description}</p>
                  </div>
                </div>
              </div>
            </AnimatedSection>
          ))}
        </div>
      </div>
    </section>
  );
}
