import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

// ── helpers ──────────────────────────────────────────────────────────

function isScalar(v: unknown): v is string | number | bigint {
  return typeof v === "string" || typeof v === "number" || typeof v === "bigint";
}

function isArrayOfObjects(v: unknown): v is Record<string, unknown>[] {
  return Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && v[0] !== null && !Array.isArray(v[0]);
}

function isArrayOfScalars(v: unknown): v is (string | number)[] {
  return Array.isArray(v) && v.length > 0 && v.every(i => typeof i === "string" || typeof i === "number");
}

function isFlatObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  return Object.values(v).every(val => val === null || val === undefined || isScalar(val) || typeof val === "boolean");
}

/** Pretty-print a label from a snake_case / camelCase key */
export function prettifyKey(key: string): string {
  // If already contains spaces or Cyrillic — return as-is with capitalize
  if (/[а-яА-ЯёЁ\s]/.test(key)) {
    return key.charAt(0).toUpperCase() + key.slice(1);
  }
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, s => s.toUpperCase())
    .trim();
}

// ── Scalar value renderer ────────────────────────────────────────────

function ScalarValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground italic text-xs">—</span>;
  }
  if (typeof value === "boolean") {
    return (
      <Badge variant={value ? "default" : "secondary"} className="text-[11px] px-2 py-0 h-5">
        {value ? "Да" : "Нет"}
      </Badge>
    );
  }
  return <span className="text-sm text-foreground break-words whitespace-pre-wrap">{String(value)}</span>;
}

// ── Chips for string arrays ──────────────────────────────────────────

function ChipList({ items }: { items: (string | number)[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <Badge key={i} variant="outline" className="text-xs font-normal">
          {String(item)}
        </Badge>
      ))}
    </div>
  );
}

// ── Key-value grid for flat objects ──────────────────────────────────

function KeyValueGrid({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return <span className="text-muted-foreground italic text-xs">—</span>;
  return (
    <div className="space-y-2">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-baseline gap-3">
          <span className="text-xs text-muted-foreground whitespace-nowrap min-w-[80px]">{prettifyKey(k)}</span>
          <ScalarValue value={v} />
        </div>
      ))}
    </div>
  );
}

// ── Table for array-of-objects ────────────────────────────────────────

function ObjectTable({ rows }: { rows: Record<string, unknown>[] }) {
  const allKeys = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
  const cols = allKeys.filter(k => rows.some(r => r[k] !== null && r[k] !== undefined));

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              {cols.map(c => (
                <TableHead key={c} className="text-[11px] font-semibold whitespace-nowrap h-9 px-3">
                  {prettifyKey(c)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, ri) => (
              <TableRow key={ri} className="hover:bg-muted/20">
                {cols.map(c => (
                  <TableCell key={c} className="text-sm py-2 px-3 whitespace-nowrap">
                    <ScalarValue value={row[c]} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ── JSON fallback ────────────────────────────────────────────────────

function JsonBlock({ data }: { data: unknown }) {
  let text: string;
  try {
    text = JSON.stringify(data, null, 2);
  } catch {
    text = String(data);
  }
  return (
    <div className="rounded-lg border bg-muted/20 overflow-hidden">
      <pre className="text-xs font-mono p-3 overflow-x-auto overflow-y-auto max-h-64 whitespace-pre-wrap break-words text-foreground">
        {text}
      </pre>
    </div>
  );
}

// ── Main dispatcher ──────────────────────────────────────────────────

export function PayloadValue({ value, className }: { value: unknown; className?: string }) {
  return (
    <div className={cn(className)}>
      <PayloadValueInner value={value} />
    </div>
  );
}

function PayloadValueInner({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") return <ScalarValue value={value} />;
  if (typeof value === "boolean") return <ScalarValue value={value} />;
  if (isScalar(value)) return <ScalarValue value={value} />;
  if (isArrayOfScalars(value)) return <ChipList items={value} />;
  if (isArrayOfObjects(value)) return <ObjectTable rows={value} />;
  if (Array.isArray(value) && value.length === 0) return <span className="text-muted-foreground italic text-xs">Пусто</span>;
  if (isFlatObject(value)) return <KeyValueGrid data={value} />;
  return <JsonBlock data={value} />;
}

// ── Section renderers ────────────────────────────────────────────────

interface PayloadSectionProps {
  title: string;
  data: Record<string, unknown>;
  variant?: "summary" | "full";
}

export function PayloadSection({ title, data, variant = "full" }: PayloadSectionProps) {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return null;

  const isSummary = variant === "summary";

  return (
    <div className={cn("rounded-xl border shadow-sm", isSummary ? "bg-muted/15" : "bg-card")}>
      <div className="px-4 pt-3 pb-2 border-b border-border/50">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{title}</p>
      </div>
      <div className={cn("px-4 py-3", isSummary ? "space-y-2" : "space-y-4")}>
        {isSummary ? (
          entries.map(([key, value]) => (
            <div key={key} className="flex items-baseline justify-between gap-4">
              <span className="text-xs text-muted-foreground shrink-0">{prettifyKey(key)}</span>
              <div className="text-right">
                <ScalarValue value={typeof value === "object" ? JSON.stringify(value) : value} />
              </div>
            </div>
          ))
        ) : (
          entries.map(([key, value]) => (
            <div key={key} className="space-y-1.5">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{prettifyKey(key)}</p>
              <PayloadValue value={value} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Training summary metrics ─────────────────────────────────────────

export function TrainingMetrics({ score, maxScore, isCorrect, attempts }: {
  score: number | null;
  maxScore: number | null;
  isCorrect: unknown;
  attempts: unknown;
}) {
  const metrics: { label: string; value: string | number | null; accent?: boolean }[] = [];

  if (score !== null && maxScore !== null) {
    metrics.push({ label: "Баллы", value: `${score} / ${maxScore}`, accent: true });
  } else if (score !== null) {
    metrics.push({ label: "Баллы", value: score, accent: true });
  }

  if (typeof isCorrect === "boolean") {
    metrics.push({ label: "Верно", value: isCorrect ? "Да" : "Нет" });
  }

  if (typeof attempts === "number" && attempts > 0) {
    metrics.push({ label: "Попытки", value: attempts });
  }

  if (metrics.length === 0) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {metrics.map(m => (
        <div key={m.label} className="rounded-xl border bg-card shadow-sm px-4 py-3 text-center">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">{m.label}</p>
          <p className={cn("text-lg font-semibold", m.accent ? "text-primary" : "text-foreground")}>
            {m.value ?? "—"}
          </p>
        </div>
      ))}
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────

export function EmptyPayloadState() {
  return (
    <div className="rounded-xl border bg-card shadow-sm px-6 py-10 text-center">
      <p className="text-sm text-muted-foreground">Нет подробных данных</p>
    </div>
  );
}
