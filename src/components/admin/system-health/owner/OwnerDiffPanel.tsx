import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { DiffEntry } from "@/lib/system-health/diff-engine";
import { humanizeInvariant } from "@/lib/system-health/invariant-humanize";

interface Props {
  diff: DiffEntry[];
}

const STATUS_LABEL: Record<DiffEntry["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  new: { label: "Новая", variant: "destructive" },
  disappeared: { label: "Исчезла", variant: "default" },
  count_changed: { label: "Изменилось значение", variant: "secondary" },
  unchanged: { label: "Без изменений", variant: "outline" },
};

export function OwnerDiffPanel({ diff }: Props) {
  const meaningful = diff.filter((d) => d.status !== "unchanged");
  if (meaningful.length === 0) {
    return (
      <Card className="bg-muted/30">
        <CardContent className="p-4 text-sm text-muted-foreground">
          С последней проверки ничего не изменилось.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="font-semibold">Что изменилось с прошлого запуска</div>
        <div className="space-y-2">
          {meaningful.map((d) => {
            const desc = humanizeInvariant(d.code);
            const cfg = STATUS_LABEL[d.status];
            return (
              <div key={d.code} className="flex items-start justify-between gap-3 text-sm border-b border-border/40 last:border-0 pb-2 last:pb-0">
                <div className="min-w-0">
                  <div className="font-medium truncate">{d.code} — {desc.ownerTitle}</div>
                  {d.status === "count_changed" && d.before && d.after && (
                    <div className="text-muted-foreground">
                      было {d.before.count} → стало {d.after.count}{" "}
                      <span className={d.delta > 0 ? "text-red-600" : "text-emerald-600"}>
                        ({d.delta > 0 ? "+" : ""}{d.delta})
                      </span>
                    </div>
                  )}
                  {d.status === "new" && d.after && (
                    <div className="text-muted-foreground">появилась, count={d.after.count}</div>
                  )}
                  {d.status === "disappeared" && d.before && (
                    <div className="text-muted-foreground">исчезла, было count={d.before.count}</div>
                  )}
                </div>
                <Badge variant={cfg.variant}>{cfg.label}</Badge>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
