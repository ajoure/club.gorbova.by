import { Link } from "react-router-dom";
import { GlassCard } from "@/components/ui/GlassCard";
import { ArrowRight, Timer, Compass, Brain } from "lucide-react";

const navCards = [
  {
    title: "Тайм-менеджмент",
    description: "Управляй временем с помощью матрицы продуктивности",
    icon: Timer,
    url: "/tools/eisenhower",
    gradient: "from-blue-500/20 to-cyan-500/20",
    iconColor: "text-blue-500",
  },
  {
    title: "Инструменты лидера",
    description: "Достигай цели, внедряя привычки, управляй жизнью, влияй на реальность и получай удовольствие от пути",
    icon: Compass,
    url: "/self-development",
    gradient: "from-purple-500/20 to-pink-500/20",
    iconColor: "text-purple-500",
  },
  {
    title: "Нейроассистент",
    description: "Цифровой двойник: помогает думать, принимать решения и действовать быстрее, точнее и осознанно — в бизнесе, деньгах и жизни",
    icon: Brain,
    url: "/ai",
    gradient: "from-amber-500/20 to-orange-500/20",
    iconColor: "text-amber-500",
  },
];

export function NavigationCards() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {navCards.map((card) => (
        <Link key={card.url} to={card.url}>
          <GlassCard 
            className={`h-full p-5 hover:shadow-xl transition-all duration-300 hover:-translate-y-1 cursor-pointer group bg-gradient-to-br ${card.gradient}`}
          >
            <div className="flex flex-col h-full">
              <div className="flex items-start justify-between mb-3">
                <div className={`p-2.5 rounded-xl bg-background/50 ${card.iconColor}`}>
                  <card.icon className="h-5 w-5" />
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">{card.title}</h3>
              <p className="text-sm text-muted-foreground line-clamp-3 flex-1">
                {card.description}
              </p>
            </div>
          </GlassCard>
        </Link>
      ))}
    </div>
  );
}
