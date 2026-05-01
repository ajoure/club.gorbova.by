import { useNavigate } from "react-router-dom";
import { GlassCard } from "@/components/ui/GlassCard";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Play, BookOpen, Lock, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { TrainingModule } from "@/hooks/useTrainingModules";
import { formatLockedMonth } from "@/hooks/useModuleMonthGate";

interface ModuleCardProps {
  module: TrainingModule & {
    month_locked?: boolean;
    locked_month?: string | null;
  };
  variant?: "default" | "compact";
}

export function ModuleCard({ module, variant = "default" }: ModuleCardProps) {
  const navigate = useNavigate();

  const lessonCount = module.lesson_count || 0;
  const completedCount = module.completed_count || 0;
  const progress = lessonCount > 0 ? Math.round((completedCount / lessonCount) * 100) : 0;
  const hasAccess = module.has_access !== false;
  const isMonthLocked = !!module.month_locked;
  const lockedMonthLabel = module.locked_month ? formatLockedMonth(module.locked_month) : null;

  const handleClick = () => {
    // Всегда позволяем переход — внутри страницы покажем заглушку, если month-locked
    navigate(`/library/${module.slug}`);
  };

  return (
    <GlassCard
      className={cn(
        "overflow-hidden group relative bg-background/60 backdrop-blur-xl border border-border/30 transition-all duration-300",
        "hover:border-primary/40 hover:shadow-xl cursor-pointer",
        !hasAccess && "opacity-80",
        isMonthLocked && "saturate-[0.4] hover:saturate-100"
      )}
      onClick={handleClick}
    >
      {/* Subtle inner glow */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 via-transparent to-black/5 pointer-events-none rounded-2xl" />

      {/* Color gradient bar */}
      {module.color_gradient && (
        <div className={cn("h-1.5 bg-gradient-to-r", module.color_gradient)} />
      )}

      {/* Cover image */}
      {module.cover_image && (
        <div className="relative h-36 overflow-hidden">
          <img
            src={module.cover_image}
            alt={module.title}
            className={cn(
              "w-full h-full object-cover transition-all duration-300",
              isMonthLocked
                ? "saturate-[0.3] brightness-[0.85] sepia-[0.35] group-hover:saturate-100 group-hover:sepia-0"
                : "saturate-[0.85] brightness-[0.95] group-hover:saturate-100 group-hover:brightness-100 group-hover:scale-105"
            )}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/30 to-transparent" />

          {/* Access badge */}
          {!hasAccess && (
            <div className="absolute top-3 right-3">
              <Badge variant="secondary" className="gap-1 bg-background/80 backdrop-blur-sm">
                <Lock className="h-3 w-3" />
                {module.slug === "buhgalteriya-kak-biznes" ? "Для участников клуба" : "Нет доступа"}
              </Badge>
            </div>
          )}

          {/* Month-locked badge (has_access=true but month mismatch) */}
          {hasAccess && isMonthLocked && (
            <div className="absolute top-3 right-3">
              <Badge
                variant="secondary"
                className="gap-1 bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 backdrop-blur-sm"
              >
                <Lock className="h-3 w-3" />
                Нет доступа
              </Badge>
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div className="relative p-4">
        <h3 className="text-base font-semibold text-foreground leading-tight mb-2 group-hover:text-primary transition-colors line-clamp-2">
          {module.title}
        </h3>

        {module.description && (
          <p className="text-sm text-muted-foreground leading-relaxed mb-3 line-clamp-2">
            {module.description}
          </p>
        )}

        {/* Meta info */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
          {lessonCount > 0 && (
            <span className="flex items-center gap-1">
              <BookOpen className="h-3.5 w-3.5" />
              {lessonCount} уроков
            </span>
          )}
        </div>

        {/* Progress (only if real access without month-lock) */}
        {hasAccess && !isMonthLocked && lessonCount > 0 && (
          <div className="mb-3">
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Прогресс</span>
              <span className="font-medium">{completedCount} из {lessonCount}</span>
            </div>
            <Progress value={progress} className="h-1.5" />
          </div>
        )}

        {/* Action button */}
        {hasAccess && !isMonthLocked && (
          <Button
            size="sm"
            className="w-full"
            onClick={(e) => {
              e.stopPropagation();
              handleClick();
            }}
          >
            <Play className="h-4 w-4 mr-1.5" />
            {progress > 0 ? "Продолжить" : "Начать"}
          </Button>
        )}

        {hasAccess && isMonthLocked && (
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={(e) => {
              e.stopPropagation();
              handleClick();
            }}
          >
            <Info className="h-4 w-4 mr-1.5" />
            Подробнее
          </Button>
        )}
      </div>
    </GlassCard>
  );
}
