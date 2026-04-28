/**
 * LessonActionDock — frosted-glass sticky dock внизу экрана урока.
 * Стиль соответствует sonner/toast: bg-background/40 backdrop-blur-xl border-border/30.
 *
 * Содержит три зоны:
 *  • слева  — «Назад» (предыдущий урок, если есть)
 *  • центр — toggle «Отметить как пройденный / непройденный»
 *  • справа — «Далее» (следующий урок) или «Завершить» (на последнем уроке)
 */
import { ArrowLeft, ArrowRight, CheckCheck, CheckCircle2, Flag, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NeighborLesson {
  title: string;
}

interface LessonActionDockProps {
  isCompleted: boolean;
  onToggleComplete: () => void;
  prevLesson?: NeighborLesson | null;
  nextLesson?: NeighborLesson | null;
  onNavigatePrev?: () => void;
  onNavigateNext?: () => void;
  onFinish?: () => void;
}

export function LessonActionDock({
  isCompleted,
  onToggleComplete,
  prevLesson,
  nextLesson,
  onNavigatePrev,
  onNavigateNext,
  onFinish,
}: LessonActionDockProps) {
  const hasPrev = !!prevLesson && !!onNavigatePrev;
  const hasNext = !!nextLesson && !!onNavigateNext;
  const showFinish = !nextLesson && !!onFinish;

  return (
    <div
      className={cn(
        "fixed z-40 animate-in slide-in-from-bottom-4 fade-in duration-300",
        // По центру на десктопе, на всю ширину с отступами на мобильных
        "left-1/2 -translate-x-1/2 bottom-4",
        "max-sm:left-3 max-sm:right-3 max-sm:translate-x-0 max-sm:bottom-3",
        "w-auto max-sm:w-auto",
      )}
      role="toolbar"
      aria-label="Действия с уроком"
    >
      <div
        className={cn(
          "flex items-center gap-1 sm:gap-2 px-2 py-2 rounded-2xl",
          "bg-background/60 dark:bg-background/40 backdrop-blur-xl",
          "border border-border/40 shadow-lg shadow-foreground/5",
          "ring-1 ring-foreground/[0.03]",
        )}
      >
        {/* LEFT: Назад */}
        {hasPrev ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onNavigatePrev}
            title={prevLesson!.title}
            className="rounded-xl text-muted-foreground hover:text-foreground hover:bg-foreground/5 px-3"
          >
            <ArrowLeft className="h-4 w-4 sm:mr-1.5" />
            <span className="hidden sm:inline max-w-[120px] truncate">Назад</span>
          </Button>
        ) : (
          <div className="w-9 sm:w-[88px]" aria-hidden />
        )}

        <div className="w-px h-6 bg-border/40 mx-0.5 sm:mx-1" aria-hidden />

        {/* CENTER: toggle complete */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleComplete}
          className={cn(
            "rounded-xl border backdrop-blur-md font-medium px-3 sm:px-4",
            isCompleted
              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25 hover:bg-emerald-500/25 hover:text-emerald-700 dark:hover:text-emerald-300"
              : "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 hover:text-primary",
          )}
        >
          {isCompleted ? (
            <RotateCcw className="h-4 w-4 sm:mr-2" />
          ) : (
            <CheckCircle2 className="h-4 w-4 sm:mr-2" />
          )}
          <span className="hidden sm:inline">
            {isCompleted ? "Отметить как непройденный" : "Отметить как пройденный"}
          </span>
        </Button>

        <div className="w-px h-6 bg-border/40 mx-0.5 sm:mx-1" aria-hidden />

        {/* RIGHT: Далее / Завершить */}
        {hasNext ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onNavigateNext}
            title={nextLesson!.title}
            className="rounded-xl text-muted-foreground hover:text-foreground hover:bg-foreground/5 px-3"
          >
            <span className="hidden sm:inline max-w-[120px] truncate">Далее</span>
            <ArrowRight className="h-4 w-4 sm:ml-1.5" />
          </Button>
        ) : showFinish ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onFinish}
            className={cn(
              "rounded-xl border backdrop-blur-md font-medium px-3 sm:px-4",
              "bg-primary/15 text-primary border-primary/25 hover:bg-primary/25 hover:text-primary",
            )}
          >
            <Flag className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Завершить</span>
          </Button>
        ) : (
          <div className="w-9 sm:w-[88px]" aria-hidden />
        )}
      </div>
    </div>
  );
}
