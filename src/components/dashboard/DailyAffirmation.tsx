import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/GlassCard";
import { Sparkles, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const fallbackAffirmations = [
  "Я управляю своим вниманием, а значит — своей реальностью.",
  "Каждое мое действие сегодня формирует мое успешное завтра.",
  "Я осознанно выбираю реакции, которые ведут меня к росту.",
  "Мои решения точны, своевременны и ведут к процветанию.",
  "Деньги и возможности приходят ко мне легко, потому что я вижу их.",
];

export function DailyAffirmation() {
  const [currentAffirmation, setCurrentAffirmation] = useState(() => 
    fallbackAffirmations[Math.floor(Math.random() * fallbackAffirmations.length)]
  );
  const [isLoading, setIsLoading] = useState(false);

  const generateAffirmation = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-affirmation');
      
      if (error) {
        throw error;
      }
      
      if (data?.success && data?.affirmation) {
        setCurrentAffirmation(data.affirmation);
      } else {
        throw new Error(data?.error || 'Не удалось сгенерировать');
      }
    } catch (error) {
      console.error('Error generating affirmation:', error);
      // Fallback to local affirmations
      let newIndex;
      const currentIndex = fallbackAffirmations.indexOf(currentAffirmation);
      do {
        newIndex = Math.floor(Math.random() * fallbackAffirmations.length);
      } while (newIndex === currentIndex && fallbackAffirmations.length > 1);
      setCurrentAffirmation(fallbackAffirmations[newIndex]);
      
      // Show toast only for rate limit errors
      if ((error as any)?.status === 429 || (error as any)?.status === 402) {
        toast.error('Слишком много запросов. Попробуйте позже.');
      }
    } finally {
      setIsLoading(false);
    }
  }, [currentAffirmation]);

  return (
    <GlassCard className="p-4 md:p-6">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <p className="text-sm md:text-base text-foreground/90 italic leading-relaxed">
            "{currentAffirmation}"
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={generateAffirmation}
          disabled={isLoading}
          className="shrink-0 h-8 w-8 hover:bg-primary/10"
          title="Новая аффирмация"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : (
            <Sparkles className="h-4 w-4 text-primary" />
          )}
        </Button>
      </div>
    </GlassCard>
  );
}
