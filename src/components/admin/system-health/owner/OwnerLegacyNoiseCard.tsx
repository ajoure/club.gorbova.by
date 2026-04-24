import { Card, CardContent } from "@/components/ui/card";
import { Archive } from "lucide-react";
import type { LegacyNoiseBreakdown } from "@/lib/system-health/legacy-noise-config";

interface Props {
  breakdown: LegacyNoiseBreakdown;
}

export function OwnerLegacyNoiseCard({ breakdown }: Props) {
  if (breakdown.total === 0) return null;
  return (
    <Card className="bg-muted/30 border-dashed">
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className="rounded-lg p-2 bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex-shrink-0">
            <Archive className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold">Исторический шум — исключён из проблем</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {breakdown.total} {plural(breakdown.total, ["запись разобрана", "записи разобраны", "записей разобрано"])} вручную и
              отмечены как «исключить». Это уже не активные проблемы — здесь только для истории.
            </p>
          </div>
        </div>
        {breakdown.bySourceInvariant.length > 0 && (
          <div className="ml-11 space-y-1 text-sm">
            {breakdown.bySourceInvariant.map((row) => (
              <div key={row.code} className="flex justify-between border-b border-border/40 last:border-0 py-1">
                <span className="text-muted-foreground">{row.code}</span>
                <span className="font-medium">{row.count} {plural(row.count, ["исключение", "исключения", "исключений"])}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function plural(n: number, forms: [string, string, string]) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return forms[1];
  return forms[2];
}
