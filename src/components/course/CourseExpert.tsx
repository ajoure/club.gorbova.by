import { AnimatedSection } from "@/components/landing/AnimatedSection";
import { Sparkles } from "lucide-react";
import katerinaImage from "@/assets/katerina-gorbova.png";

const achievements = [
  { text: "Эксперт в бухгалтерии с опытом", highlight: "12+ лет" },
  { text: "Основала одно из крупнейших бухгалтерских агентств в Беларуси —", highlight: "AJOURE: 2.500+ клиентов" },
  { text: "Гигантский опыт работы с проверяющими органами: прошла", highlight: "400+ проверок" },
  { text: "Выиграла суд клиенту на", highlight: "2.7 млн $", suffix: "за счет отстройки дела с помощью бухучета" },
  { text: "Создала", highlight: "уникальную методологию обучения бухучету", suffix: ", аналогов которой нет на рынке" },
];

export function CourseExpert() {
  return (
    <section id="expert" className="relative overflow-hidden">
      {/* Pink/Purple gradient background like the reference */}
      <div 
        className="absolute inset-0"
        style={{
          background: "linear-gradient(135deg, hsl(300, 70%, 75%) 0%, hsl(310, 65%, 70%) 50%, hsl(320, 60%, 75%) 100%)"
        }}
      />
      
      <div className="container mx-auto px-4 relative z-10">
        <div className="flex flex-col lg:flex-row items-stretch min-h-[650px]">
          {/* Left side - Photo */}
          <div className="lg:w-[45%] relative flex items-end justify-center lg:justify-start pt-8 lg:pt-0">
            <AnimatedSection delay={100}>
              <img 
                src={katerinaImage}
                alt="Катерина Горбова"
                className="max-h-[650px] w-auto object-contain object-bottom drop-shadow-2xl"
              />
            </AnimatedSection>
          </div>

          {/* Right side - Content */}
          <div className="lg:w-[55%] flex flex-col justify-center py-12 lg:py-20 lg:pl-12">
            <AnimatedSection>
              <p className="text-white/90 uppercase tracking-[0.2em] text-sm font-medium mb-4">
                АВТОР И ОСНОВАТЕЛЬ АКАДЕМИИ БУХГАЛТЕРА
              </p>
              <h2 className="text-5xl md:text-7xl font-bold mb-10 text-white leading-tight">
                КАТЕРИНА<br />ГОРБОВА
              </h2>
            </AnimatedSection>

            <AnimatedSection delay={200}>
              <ul className="space-y-6">
                {achievements.map((item, index) => (
                  <li key={index} className="flex items-start gap-4">
                    <Sparkles className="w-6 h-6 text-white mt-0.5 flex-shrink-0" />
                    <span className="text-white text-lg leading-relaxed">
                      {item.text}{" "}
                      <span className="font-bold text-[hsl(48,100%,55%)]">{item.highlight}</span>
                      {item.suffix && <span> {item.suffix}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </AnimatedSection>
          </div>
        </div>
      </div>
    </section>
  );
}
