import { CheckCircle2, AlertOctagon, AlertTriangle, Loader2, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type OwnerStatus = "ok" | "problems" | "manual_review" | "loading";

interface Props {
  status: OwnerStatus;
  problemsCount: number;
  manualReviewCount: number;
  lastCheckAt?: string | null;
  onRunCheck: () => void;
  onRefresh: () => void;
  isRunning: boolean;
}

const STATUS_CONFIG: Record<Exclude<OwnerStatus, "loading">, {
  title: string;
  subtitle: (n: number) => string;
  Icon: typeof CheckCircle2;
  bg: string;
  fg: string;
}> = {
  ok: {
    title: "Всё в порядке",
    subtitle: () => "Система работает без проблем, требующих вашего внимания.",
    Icon: CheckCircle2,
    bg: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900",
    fg: "text-emerald-700 dark:text-emerald-300",
  },
  problems: {
    title: "Есть проблемы",
    subtitle: (n) => `Найдено ${n} ${pluralize(n, ["проблема", "проблемы", "проблем"])}, которые нужно исправить.`,
    Icon: AlertOctagon,
    bg: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900",
    fg: "text-red-700 dark:text-red-300",
  },
  manual_review: {
    title: "Требует ручной проверки",
    subtitle: (n) => `${n} ${pluralize(n, ["кейс требует", "кейса требуют", "кейсов требуют"])} вашего решения.`,
    Icon: AlertTriangle,
    bg: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900",
    fg: "text-amber-700 dark:text-amber-300",
  },
};

function pluralize(n: number, forms: [string, string, string]) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

export function OwnerStatusHero({
  status,
  problemsCount,
  manualReviewCount,
  lastCheckAt,
  onRunCheck,
  onRefresh,
  isRunning,
}: Props) {
  if (status === "loading") {
    return (
      <div className="rounded-xl border bg-muted/30 p-8 flex items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <div className="text-muted-foreground">Загружаем последнюю проверку…</div>
      </div>
    );
  }

  const cfg = STATUS_CONFIG[status];
  const n = status === "manual_review" ? manualReviewCount : problemsCount;
  const Icon = cfg.Icon;

  return (
    <div className={cn("rounded-xl border p-6 sm:p-8", cfg.bg)}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-6">
        <div className={cn("flex-shrink-0 rounded-full p-4 bg-background/60", cfg.fg)}>
          <Icon className="h-12 w-12" strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className={cn("text-3xl sm:text-4xl font-bold tracking-tight", cfg.fg)}>
            {cfg.title}
          </h1>
          <p className="mt-2 text-base sm:text-lg text-foreground/80">{cfg.subtitle(n)}</p>
          {lastCheckAt && (
            <p className="mt-2 text-sm text-muted-foreground">
              Последняя проверка: {new Date(lastCheckAt).toLocaleString("ru-RU")}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2 flex-shrink-0">
          <Button onClick={onRunCheck} disabled={isRunning} size="lg">
            {isRunning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            Запустить проверку
          </Button>
          <Button onClick={onRefresh} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Обновить
          </Button>
        </div>
      </div>
    </div>
  );
}
