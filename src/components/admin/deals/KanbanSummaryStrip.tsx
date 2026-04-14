import { TrendingUp, Trophy, XCircle, BarChart3 } from "lucide-react";

interface Props {
  totalActive: number;
  wonCount: number;
  wonSum: number;
  lostCount: number;
  totalDeals: number;
}

const fmt = (v: number) =>
  new Intl.NumberFormat("ru-BY", {
    style: "currency",
    currency: "BYN",
    maximumFractionDigits: 0,
  }).format(v);

export function KanbanSummaryStrip({ totalActive, wonCount, wonSum, lostCount, totalDeals }: Props) {
  return (
    <div className="flex items-center gap-4 flex-wrap px-1 py-2 text-xs text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <BarChart3 className="h-3.5 w-3.5" />
        <span>
          <strong className="text-foreground">{totalDeals}</strong> сделок
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <TrendingUp className="h-3.5 w-3.5 text-primary" />
        <span>
          Активная воронка: <strong className="text-foreground">{fmt(totalActive)}</strong>
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <Trophy className="h-3.5 w-3.5 text-green-500" />
        <span>
          Успешно: <strong className="text-green-600">{wonCount}</strong>
          {wonSum > 0 && <> ({fmt(wonSum)})</>}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <XCircle className="h-3.5 w-3.5 text-red-400" />
        <span>
          Отказ: <strong className="text-red-500">{lostCount}</strong>
        </span>
      </div>
    </div>
  );
}
