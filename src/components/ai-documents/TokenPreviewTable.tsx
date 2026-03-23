import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import type { TokenEntry } from "@/utils/aiDocumentSnapshotResolver";

interface TokenPreviewTableProps {
  tokens: TokenEntry[];
}

export function TokenPreviewTable({ tokens }: TokenPreviewTableProps) {
  const filled = tokens.filter((t) => t.filled);
  const missing = tokens.filter((t) => !t.filled);

  return (
    <div className="space-y-3">
      {missing.length > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-400/20 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
          <span className="text-amber-700 dark:text-amber-400">
            {missing.length} {missing.length === 1 ? "поле не заполнено" : "полей не заполнено"}. Документ будет сформирован с пустыми значениями.
          </span>
        </div>
      )}

      <div className="rounded-lg border divide-y max-h-[320px] overflow-y-auto">
        {tokens.map((t) => (
          <div
            key={t.token}
            className="flex items-center gap-3 px-3 py-2 text-sm"
          >
            {t.filled ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium truncate">{t.label}</span>
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {t.source}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {t.filled ? t.value : "— не заполнено —"}
              </p>
            </div>
            <code className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0 hidden sm:block">
              {t.token}
            </code>
          </div>
        ))}
      </div>
    </div>
  );
}
