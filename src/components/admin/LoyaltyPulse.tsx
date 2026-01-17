import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface LoyaltyPulseProps {
  score: number;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
}

const getScoreData = (score: number) => {
  if (score <= 2) {
    return {
      color: "from-red-500 to-red-600",
      glow: "shadow-red-500/50",
      label: "Хейтер",
      emoji: "😠",
      ringColor: "ring-red-500",
    };
  }
  if (score <= 4) {
    return {
      color: "from-orange-500 to-orange-600",
      glow: "shadow-orange-500/50",
      label: "Недоволен",
      emoji: "😕",
      ringColor: "ring-orange-500",
    };
  }
  if (score <= 6) {
    return {
      color: "from-yellow-400 to-yellow-500",
      glow: "shadow-yellow-500/50",
      label: "Нейтрально",
      emoji: "😐",
      ringColor: "ring-yellow-500",
    };
  }
  if (score <= 8) {
    return {
      color: "from-green-400 to-green-500",
      glow: "shadow-green-500/50",
      label: "Лояльный",
      emoji: "😊",
      ringColor: "ring-green-500",
    };
  }
  return {
    color: "from-emerald-400 to-cyan-400",
    glow: "shadow-emerald-500/60",
    label: "Адепт/Фанат",
    emoji: "🤩",
    ringColor: "ring-emerald-400",
  };
};

export function LoyaltyPulse({ score, size = "md", showLabel = false, className }: LoyaltyPulseProps) {
  const data = getScoreData(score);
  
  const sizeClasses = {
    sm: { ring: "w-8 h-8", text: "text-xs", glow: "shadow-md" },
    md: { ring: "w-12 h-12", text: "text-sm", glow: "shadow-lg" },
    lg: { ring: "w-16 h-16", text: "text-lg", glow: "shadow-xl" },
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn("flex items-center gap-2", className)}>
            {/* Glowing ring with score */}
            <div
              className={cn(
                "relative flex items-center justify-center rounded-full",
                "bg-gradient-to-br",
                data.color,
                sizeClasses[size].ring,
                sizeClasses[size].glow,
                data.glow,
                "animate-pulse"
              )}
              style={{
                boxShadow: `0 0 20px 4px currentColor`,
              }}
            >
              {/* Inner circle */}
              <div className={cn(
                "absolute inset-1 rounded-full bg-background/90 flex items-center justify-center",
                "font-bold",
                sizeClasses[size].text
              )}>
                {score}
              </div>
              {/* Outer glow ring effect */}
              <div
                className={cn(
                  "absolute inset-0 rounded-full ring-2 opacity-60",
                  data.ringColor,
                  "animate-ping"
                )}
                style={{ animationDuration: "2s" }}
              />
            </div>
            
            {showLabel && (
              <div className="flex flex-col">
                <span className="text-sm font-medium">{data.label}</span>
                <span className="text-xs text-muted-foreground">{data.emoji} Пульс лояльности</span>
              </div>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-center">
            <p className="font-semibold">{data.emoji} {data.label}</p>
            <p className="text-xs text-muted-foreground">Оценка: {score}/10</p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Compact version for tables
export function LoyaltyBadge({ score, className }: { score: number; className?: string }) {
  const data = getScoreData(score);
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold",
              "bg-gradient-to-br text-white",
              data.color,
              className
            )}
          >
            {score}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>{data.emoji} {data.label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
