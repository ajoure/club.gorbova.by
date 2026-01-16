import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/GlassCard";
import { Sparkles } from "lucide-react";

const affirmations = [
  "Я управляю своим вниманием, а значит — своей реальностью.",
  "Каждое мое действие сегодня формирует мое успешное завтра.",
  "Я осознанно выбираю реакции, которые ведут меня к росту.",
  "Мои решения точны, своевременны и ведут к процветанию.",
  "Деньги и возможности приходят ко мне легко, потому что я вижу их.",
];

export function DailyAffirmation() {
  const [currentIndex, setCurrentIndex] = useState(() => 
    Math.floor(Math.random() * affirmations.length)
  );

  const shuffleAffirmation = useCallback(() => {
    let newIndex;
    do {
      newIndex = Math.floor(Math.random() * affirmations.length);
    } while (newIndex === currentIndex && affirmations.length > 1);
    setCurrentIndex(newIndex);
  }, [currentIndex]);

  return (
    <GlassCard className="p-4 md:p-6">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <p className="text-sm md:text-base text-foreground/90 italic leading-relaxed">
            "{affirmations[currentIndex]}"
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={shuffleAffirmation}
          className="shrink-0 h-8 w-8 hover:bg-primary/10"
          title="Новая аффирмация"
        >
          <Sparkles className="h-4 w-4 text-primary" />
        </Button>
      </div>
    </GlassCard>
  );
}
