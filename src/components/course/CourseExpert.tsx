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
          background: "linear-gradient(135deg, hsl(300, 60%, 75%) 0%, hsl(320, 70%, 70%) 50%, hsl(340, 65%, 75%) 100%)"
        }}
      />
      
      <div className="container mx-auto px-4 relative z-10">
        <div className="flex flex-col lg:flex-row items-stretch min-h-[600px]">
          {/* Left side - Photo */}
          <div className="lg:w-1/2 relative flex items-end justify-center lg:justify-start">
            <AnimatedSection delay={100}>
              <img 
                src={katerinaImage}
                alt="Катерина Горбова"
                className="max-h-[600px] w-auto object-contain object-bottom"
              />
            </AnimatedSection>
          </div>

          {/* Right side - Content */}
          <div className="lg:w-1/2 flex flex-col justify-center py-16 lg:py-24 lg:pl-8">
            <AnimatedSection>
              <p className="text-white/80 uppercase tracking-widest text-sm mb-2">
                АВТОР И ОСНОВАТЕЛЬ АКАДЕМИИ БУХГАЛТЕРА
              </p>
              <h2 className="text-4xl md:text-6xl font-bold mb-8 text-white">
                КАТЕРИНА ГОРБОВА
              </h2>
            </AnimatedSection>

            <AnimatedSection delay={200}>
              <ul className="space-y-5">
                {achievements.map((item, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <Sparkles className="w-5 h-5 text-white/90 mt-0.5 flex-shrink-0" />
                    <span className="text-white/90 text-base leading-relaxed">
                      {item.text}{" "}
                      <span className="font-bold text-[hsl(43,80%,60%)]">{item.highlight}</span>
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
