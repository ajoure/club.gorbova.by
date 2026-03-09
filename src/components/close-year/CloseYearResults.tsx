import { AnimatedSection } from "@/components/landing/AnimatedSection";
import { Star } from "lucide-react";

const results = [
  "Технологию закрытия года",
  "Нейросети для рутинных процессов",
  "Баланс vs ОСВ — от чернового анализа до финальной сверки",
  "Кредиты и лизинги — правильный учёт и отражение",
  "Ревизор — как подготовиться и пройти проверку",
  "Учётную политику на следующий год",
  "Шаблоны + промпты — готовый арсенал для работы",
];

export function CloseYearResults() {
  return (
    <section id="results" className="py-20 md:py-28 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-background via-muted/10 to-background" />

      <div className="container mx-auto px-4 relative z-10">
        <AnimatedSection>
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold mb-4">Что вы получите</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              После обучения у вас будет чёткая система закрытия года
            </p>
          </div>
        </AnimatedSection>

        <div className="max-w-3xl mx-auto">
          <div className="space-y-4">
            {results.map((result, index) => (
              <AnimatedSection key={index} delay={index * 80}>
                <div
                  className="flex items-start gap-4 p-5 rounded-2xl border transition-all duration-300 hover:scale-[1.01]"
                  style={{
                    background: "linear-gradient(135deg, hsl(var(--card) / 0.5), hsl(var(--card) / 0.2))",
                    backdropFilter: "blur(20px)",
                    borderColor: "hsl(43, 50%, 55% / 0.15)",
                  }}
                >
                  <div
                    className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{
                      background: "linear-gradient(135deg, hsl(43, 50%, 55% / 0.2), hsl(43, 50%, 55% / 0.05))",
                    }}
                  >
                    <Star className="w-4 h-4" style={{ color: "hsl(43, 50%, 55%)" }} />
                  </div>
                  <span className="text-base md:text-lg leading-relaxed pt-1">{result}</span>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
