import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BarChart3, AlertTriangle, CheckCircle2, Lightbulb, TrendingUp } from "lucide-react";
import { EisenhowerTask } from "@/hooks/useEisenhowerTasks";

interface MatrixAnalysisModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: EisenhowerTask[];
}

interface QuadrantStats {
  count: number;
  percentage: number;
  completed: number;
  active: number;
}

export function MatrixAnalysisModal({ open, onOpenChange, tasks }: MatrixAnalysisModalProps) {
  const matrixTasks = tasks.filter(t => t.quadrant !== "inbox");
  const totalTasks = matrixTasks.length;
  
  const getQuadrantStats = (quadrant: string): QuadrantStats => {
    const quadrantTasks = matrixTasks.filter(t => t.quadrant === quadrant);
    return {
      count: quadrantTasks.length,
      percentage: totalTasks > 0 ? Math.round((quadrantTasks.length / totalTasks) * 100) : 0,
      completed: quadrantTasks.filter(t => t.completed).length,
      active: quadrantTasks.filter(t => !t.completed).length,
    };
  };

  const q1 = getQuadrantStats("urgent-important");
  const q2 = getQuadrantStats("not-urgent-important");
  const q3 = getQuadrantStats("urgent-not-important");
  const q4 = getQuadrantStats("not-urgent-not-important");
  const plannedCount = tasks.filter(t => t.quadrant === "inbox").length;

  const getRecommendations = () => {
    const recommendations: { type: "warning" | "success" | "tip"; text: string }[] = [];

    // Too many urgent-important
    if (q1.active > 5) {
      recommendations.push({
        type: "warning",
        text: `Слишком много срочных и важных задач (${q1.active}). Это создаёт стресс. Попробуйте делегировать или перенести некоторые задачи.`
      });
    } else if (q1.percentage > 40) {
      recommendations.push({
        type: "warning",
        text: `${q1.percentage}% задач в Q1 (Срочно и Важно). Рекомендуется перевести часть в Q2 через лучшее планирование.`
      });
    }

    // Q2 is empty or low
    if (q2.count === 0 && totalTasks > 0) {
      recommendations.push({
        type: "warning",
        text: "Нет задач в Q2 (Важно, не Срочно). Это сектор развития — добавьте стратегические цели!"
      });
    } else if (q2.percentage < 20 && totalTasks > 5) {
      recommendations.push({
        type: "tip",
        text: "Мало задач в Q2. Идеальное распределение: 50-60% задач в секторе развития."
      });
    } else if (q2.percentage >= 40) {
      recommendations.push({
        type: "success",
        text: `Отлично! ${q2.percentage}% задач в Q2 — вы фокусируетесь на развитии.`
      });
    }

    // Too many Q3
    if (q3.percentage > 25) {
      recommendations.push({
        type: "warning",
        text: `${q3.percentage}% задач срочные, но не важные. Рассмотрите делегирование.`
      });
    }

    // Q4 tasks
    if (q4.active > 3) {
      recommendations.push({
        type: "tip",
        text: `${q4.active} активных задач в Q4. Возможно, стоит их исключить или отложить.`
      });
    }

    // Planned tasks
    if (plannedCount > 5) {
      recommendations.push({
        type: "tip",
        text: `${plannedCount} задач ожидают распределения. Определите их приоритет.`
      });
    }

    // Good balance
    if (recommendations.length === 0 && totalTasks > 0) {
      recommendations.push({
        type: "success",
        text: "Хороший баланс задач! Продолжайте в том же духе."
      });
    }

    return recommendations;
  };

  const recommendations = getRecommendations();

  const quadrants = [
    { key: "q1", label: "Q1: Срочно и Важно", stats: q1, color: "hsl(350 89% 60%)", bgColor: "bg-red-500/10" },
    { key: "q2", label: "Q2: Важно, не Срочно", stats: q2, color: "hsl(217 91% 60%)", bgColor: "bg-blue-500/10" },
    { key: "q3", label: "Q3: Срочно, не Важно", stats: q3, color: "hsl(38 92% 50%)", bgColor: "bg-amber-500/10" },
    { key: "q4", label: "Q4: Не Срочно, не Важно", stats: q4, color: "hsl(220 9% 46%)", bgColor: "bg-gray-500/10" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" />
            Анализ матрицы
          </DialogTitle>
          <DialogDescription>
            Распределение задач по квадрантам и рекомендации
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-3">
            {quadrants.map(q => (
              <div 
                key={q.key} 
                className={`p-4 rounded-xl ${q.bgColor} border border-border/50`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-muted-foreground">{q.label}</span>
                  <span 
                    className="text-lg font-bold"
                    style={{ color: q.color }}
                  >
                    {q.stats.count}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{q.stats.percentage}% от всех</span>
                  <span className="text-muted-foreground">
                    {q.stats.active} активных
                  </span>
                </div>
                {/* Progress bar */}
                <div className="mt-2 h-1.5 bg-background/50 rounded-full overflow-hidden">
                  <div 
                    className="h-full rounded-full transition-all"
                    style={{ 
                      width: `${q.stats.percentage}%`,
                      backgroundColor: q.color
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Summary */}
          <div className="flex justify-between text-sm p-3 bg-muted/50 rounded-lg">
            <span className="text-muted-foreground">Всего в матрице:</span>
            <span className="font-medium">{totalTasks} задач</span>
          </div>
          {plannedCount > 0 && (
            <div className="flex justify-between text-sm p-3 bg-primary/10 rounded-lg">
              <span className="text-muted-foreground">Ожидают распределения:</span>
              <span className="font-medium text-primary">{plannedCount} задач</span>
            </div>
          )}

          {/* Recommendations */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Рекомендации
            </h4>
            {recommendations.map((rec, idx) => (
              <div 
                key={idx}
                className={`flex items-start gap-2 p-3 rounded-lg text-sm ${
                  rec.type === "warning" 
                    ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" 
                    : rec.type === "success"
                    ? "bg-green-500/10 text-green-700 dark:text-green-400"
                    : "bg-blue-500/10 text-blue-700 dark:text-blue-400"
                }`}
              >
                {rec.type === "warning" ? (
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                ) : rec.type === "success" ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                ) : (
                  <Lightbulb className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <span>{rec.text}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end mt-4">
          <Button onClick={() => onOpenChange(false)}>Закрыть</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
