import { Card } from "@/components/ui/card";
import { AlertOctagon, AlertTriangle, Archive } from "lucide-react";

interface Props {
  problemsCount: number;
  manualReviewCount: number;
  legacyNoiseCount: number;
}

export function OwnerSummaryStrip({ problemsCount, manualReviewCount, legacyNoiseCount }: Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Card className="p-4 flex items-center gap-3 border-red-200 dark:border-red-900">
        <div className="rounded-lg p-2 bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300">
          <AlertOctagon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-2xl font-bold">{problemsCount}</div>
          <div className="text-xs text-muted-foreground">Проблем сейчас</div>
        </div>
      </Card>

      <Card className="p-4 flex items-center gap-3 border-amber-200 dark:border-amber-900">
        <div className="rounded-lg p-2 bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div>
          <div className="text-2xl font-bold">{manualReviewCount}</div>
          <div className="text-xs text-muted-foreground">Ручная проверка</div>
        </div>
      </Card>

      {/* Отдельный спокойный блок: исторический шум */}
      <Card className="p-4 flex items-center gap-3 bg-muted/40">
        <div className="rounded-lg p-2 bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
          <Archive className="h-5 w-5" />
        </div>
        <div>
          <div className="text-2xl font-bold text-muted-foreground">{legacyNoiseCount}</div>
          <div className="text-xs text-muted-foreground">Исторический шум исключён</div>
        </div>
      </Card>
    </div>
  );
}
