import { TrendingUp, Trophy, XCircle, BarChart3, Inbox, Layers } from "lucide-react";

interface Props {
  totalDeals: number;
  totalSum: number;
  unassignedCount: number;
  assignedCount: number;
  wonCount: number;
  wonSum: number;
  lostCount: number;
}

const fmt = (v: number) =>
  new Intl.NumberFormat("ru-BY", {
    style: "currency",
    currency: "BYN",
    maximumFractionDigits: 0,
  }).format(v);

export function KanbanSummaryStrip({ totalDeals, totalSum, unassignedCount, assignedCount, wonCount, wonSum, lostCount }: Props) {
  return (
    <div className="flex items-center gap-4 flex-wrap px-1 py-2 text-xs text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <BarChart3 className="h-3.5 w-3.5" />
        <span>
          Всего: <strong className="text-foreground">{totalDeals}</strong>
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <TrendingUp className="h-3.5 w-3.5 text-primary" />
        <span>
          Сумма: <strong className="text-foreground">{fmt(totalSum)}</strong>
        </span>
      </div>
      {unassignedCount > 0 && (
        <div className="flex items-center gap-1.5">
          <Inbox className="h-3.5 w-3.5 text-muted-foreground" />
          <span>
            Без стадии: <strong className="text-foreground">{unassignedCount}</strong>
          </span>
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <Layers className="h-3.5 w-3.5 text-blue-500" />
        <span>
          В стадиях: <strong className="text-foreground">{assignedCount}</strong>
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
