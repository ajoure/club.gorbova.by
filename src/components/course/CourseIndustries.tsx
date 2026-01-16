import { AnimatedSection } from "@/components/landing/AnimatedSection";
import { Badge } from "@/components/ui/badge";
import { Check, Clock, ShoppingCart, Truck, Factory, Building, Utensils, Code, Briefcase, User, Plane, Heart, GraduationCap } from "lucide-react";

interface Industry {
  name: string;
  icon: React.ElementType;
  included?: boolean;
  price?: number;
  comingSoon?: boolean;
}

const industries: Industry[] = [
  { name: "Оптовая торговля", icon: ShoppingCart, included: true },
  { name: "Розничная торговля", icon: ShoppingCart, price: 500 },
  { name: "Посредничество", icon: Briefcase, price: 500 },
  { name: "Маркетплейсы", icon: ShoppingCart, price: 800 },
  { name: "Общественное питание", icon: Utensils, price: 500 },
  { name: "ПВТ", icon: Code, price: 500 },
  { name: "Производство", icon: Factory, price: 700 },
  { name: "Строительство", icon: Building, price: 1000 },
  { name: "Перевозки", icon: Truck, price: 500 },
  { name: "Учет у ИП", icon: User, price: 800 },
  { name: "Оказание услуг", icon: Briefcase, included: true },
  { name: "Туризм", icon: Plane, comingSoon: true },
  { name: "Медицинские услуги", icon: Heart, comingSoon: true },
  { name: "Онлайн образование", icon: GraduationCap, comingSoon: true },
];

export function CourseIndustries() {
  return (
    <section className="py-20 md:py-28 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(222,47%,14%)] to-[hsl(222,47%,10%)]" />
      
      {/* Decorative elements */}
      <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-primary opacity-5 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-[hsl(43,50%,55%)] opacity-5 rounded-full blur-3xl" />
      
      <div className="container mx-auto px-4 relative z-10">
        <AnimatedSection>
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold mb-6 text-white">
              Бухгалтерия по видам деятельности
            </h2>
            <p className="text-lg text-white/60 max-w-3xl mx-auto">
              Дополнительные модули для углублённого изучения специфики разных отраслей. 
              Скидка 50% для тарифа «Бизнес-леди»
            </p>
          </div>
        </AnimatedSection>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 max-w-6xl mx-auto">
          {industries.map((industry, index) => (
            <AnimatedSection key={index} delay={index * 50}>
              <div className={`relative bg-white/5 backdrop-blur-xl rounded-xl p-5 border transition-all duration-300 h-full ${
                industry.included 
                  ? 'border-[hsl(43,50%,55%)/0.5] hover:border-[hsl(43,50%,55%)]' 
                  : industry.comingSoon 
                    ? 'border-white/10 opacity-60' 
                    : 'border-white/10 hover:border-white/20'
              }`}>
                {industry.included && (
                  <Badge className="absolute -top-2 -right-2 bg-[hsl(43,50%,55%)] text-[hsl(222,47%,11%)] text-xs">
                    В курсе
                  </Badge>
                )}
                {industry.comingSoon && (
                  <Badge variant="outline" className="absolute -top-2 -right-2 border-white/20 text-white/50 text-xs">
                    <Clock className="w-3 h-3 mr-1" />
                    Скоро
                  </Badge>
                )}
                
                <div className="flex flex-col items-center text-center">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${
                    industry.included 
                      ? 'bg-[hsl(43,50%,55%)/0.2]' 
                      : 'bg-white/10'
                  }`}>
                    <industry.icon className={`w-6 h-6 ${
                      industry.included ? 'text-[hsl(43,50%,55%)]' : 'text-white/70'
                    }`} />
                  </div>
                  
                  <h3 className="text-sm font-medium text-white mb-2">{industry.name}</h3>
                  
                  {industry.included && (
                    <div className="flex items-center gap-1 text-[hsl(43,50%,55%)] text-xs">
                      <Check className="w-3 h-3" />
                      <span>Включено</span>
                    </div>
                  )}
                  
                  {industry.price && (
                    <div className="text-white/50 text-sm">
                      <span className="text-white font-semibold">{industry.price}</span> BYN
                    </div>
                  )}
                </div>
              </div>
            </AnimatedSection>
          ))}
        </div>
      </div>
    </section>
  );
}
