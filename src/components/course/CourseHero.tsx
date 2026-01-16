import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, Monitor, Users, Sparkles, ChevronDown } from "lucide-react";
import { AnimatedSection } from "@/components/landing/AnimatedSection";

const courseInfo = [
  { icon: Calendar, label: "Старт", value: "21 июня 2025" },
  { icon: Clock, label: "Длительность", value: "7 недель" },
  { icon: Monitor, label: "Формат", value: "Онлайн" },
  { icon: Users, label: "Конференции", value: "5-6 живых встреч" },
];

interface CourseHeroProps {
  onScrollToTariffs?: () => void;
}

export function CourseHero({ onScrollToTariffs }: CourseHeroProps) {
  const handleScrollToTariffs = () => {
    if (onScrollToTariffs) {
      onScrollToTariffs();
    } else {
      const element = document.getElementById('tariffs');
      element?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleScrollToProgram = () => {
    const element = document.getElementById('program');
    element?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section className="relative min-h-screen flex items-center justify-center py-20 overflow-hidden">
      {/* Premium gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(222,47%,15%)] to-[hsl(222,47%,8%)]" />
      
      {/* Gold accent glow */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[hsl(43,50%,55%)] opacity-10 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-primary opacity-15 rounded-full blur-3xl" />
      
      {/* Subtle pattern overlay */}
      <div className="absolute inset-0 opacity-5" style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
      }} />
      
      <div className="container mx-auto px-4 relative z-10">
        <div className="max-w-5xl mx-auto text-center">
          <AnimatedSection>
            <Badge className="mb-8 text-sm px-6 py-2 bg-[hsl(43,50%,55%)/0.15] border-[hsl(43,50%,55%)/0.3] text-[hsl(43,50%,70%)] backdrop-blur-sm">
              <Sparkles className="w-4 h-4 mr-2" />
              ЦЕННЫЙ БУХГАЛТЕР 2.0
            </Badge>
          </AnimatedSection>

          <AnimatedSection delay={100}>
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold mb-6 text-white leading-tight">
              Освойте методологию
              <span className="block bg-gradient-to-r from-[hsl(43,50%,55%)] to-[hsl(43,60%,70%)] bg-clip-text text-transparent">
                бухгалтерского учета
              </span>
            </h1>
          </AnimatedSection>

          <AnimatedSection delay={200}>
            <p className="text-lg md:text-xl text-white/70 mb-8 max-w-3xl mx-auto leading-relaxed">
              Станьте правой рукой собственника и увеличьте свой доход минимум в 2 раза. 
              25 модулей практических знаний от аудитора с 12-летним опытом. 
              98% доходимость благодаря уникальной методике обучения.
            </p>
          </AnimatedSection>

          <AnimatedSection delay={300}>
            <div className="flex flex-wrap justify-center gap-3 md:gap-4 mb-12">
              {courseInfo.map((item, index) => (
                <div 
                  key={index}
                  className="flex items-center gap-2 bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl px-4 py-3 hover:bg-white/10 transition-all duration-300"
                >
                  <div className="w-8 h-8 rounded-lg bg-[hsl(43,50%,55%)/0.2] flex items-center justify-center">
                    <item.icon className="w-4 h-4 text-[hsl(43,50%,65%)]" />
                  </div>
                  <div className="text-left">
                    <div className="text-xs text-white/50">{item.label}</div>
                    <div className="text-sm font-medium text-white">{item.value}</div>
                  </div>
                </div>
              ))}
            </div>
          </AnimatedSection>

          <AnimatedSection delay={400}>
            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
              <Button 
                size="lg" 
                onClick={handleScrollToTariffs} 
                className="text-lg px-8 py-6 bg-gradient-to-r from-[hsl(43,50%,50%)] to-[hsl(43,60%,55%)] hover:from-[hsl(43,50%,55%)] hover:to-[hsl(43,60%,60%)] text-[hsl(222,47%,11%)] font-semibold shadow-lg shadow-[hsl(43,50%,50%)/0.3] border-0"
              >
                Выбрать тариф
              </Button>
              <Button 
                size="lg" 
                variant="outline" 
                onClick={handleScrollToProgram}
                className="text-lg px-8 py-6 bg-white/5 border-white/20 text-white hover:bg-white/10 hover:border-white/30 backdrop-blur-sm"
              >
                Смотреть программу
              </Button>
            </div>
          </AnimatedSection>

          <AnimatedSection delay={500}>
            <div className="flex justify-center">
              <button 
                onClick={handleScrollToProgram}
                className="flex flex-col items-center gap-2 text-white/50 hover:text-white/70 transition-colors animate-bounce"
              >
                <span className="text-sm">Узнать больше</span>
                <ChevronDown className="w-5 h-5" />
              </button>
            </div>
          </AnimatedSection>
        </div>
      </div>
    </section>
  );
}
