// ============================================================================
// RemindOffsetSelect
// ----------------------------------------------------------------------------
// Пресеты «Напомнить за …» относительно дедлайна. Хранится как offset в
// минутах; фактическое `remind_at` вычисляется вызывающей формой как
// `dueAt - offset`. Если дедлайн не задан — селект дизейблится.
// ============================================================================
import { useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

export const REMIND_PRESETS: Array<{ value: number; label: string }> = [
  { value: 5, label: "За 5 минут" },
  { value: 15, label: "За 15 минут" },
  { value: 30, label: "За 30 минут" },
  { value: 60, label: "За 1 час" },
  { value: 180, label: "За 3 часа" },
  { value: 60 * 24, label: "За 1 день" },
  { value: 60 * 24 * 2, label: "За 2 дня" },
  { value: 60 * 24 * 3, label: "За 3 дня" },
  { value: 60 * 24 * 7, label: "За неделю" },
];

const NONE = "__none__";
const CUSTOM = "__custom__";

interface Props {
  /** Смещение в минутах (положительное — «за N минут до дедлайна»); null — не напоминать. */
  offsetMinutes: number | null;
  onChange: (value: number | null) => void;
  /** ISO-строка дедлайна. Если пусто/null — селект дизейблится. */
  dueAt: string | null;
  /** Показать warning «reminder уже в прошлом». */
  warnPast?: boolean;
}

function normalizeCustom(num: number, unit: "min" | "hour" | "day"): number {
  const n = Math.max(1, Math.floor(num));
  if (unit === "hour") return n * 60;
  if (unit === "day") return n * 60 * 24;
  return n;
}

function formatCustomLabel(min: number): string {
  if (min % (60 * 24) === 0) return `Своё значение (${min / (60 * 24)} дн.)`;
  if (min % 60 === 0) return `Своё значение (${min / 60} ч)`;
  return `Своё значение (${min} мин)`;
}

export function RemindOffsetSelect({ offsetMinutes, onChange, dueAt, warnPast }: Props) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customNum, setCustomNum] = useState<string>("2");
  const [customUnit, setCustomUnit] = useState<"min" | "hour" | "day">("hour");

  const isCustom = useMemo(() => {
    if (offsetMinutes == null) return false;
    return !REMIND_PRESETS.some((p) => p.value === offsetMinutes);
  }, [offsetMinutes]);

  const value =
    offsetMinutes == null
      ? NONE
      : isCustom
        ? CUSTOM
        : String(offsetMinutes);

  const disabled = !dueAt;

  const handleChange = (v: string) => {
    if (v === NONE) {
      onChange(null);
      return;
    }
    if (v === CUSTOM) {
      setCustomOpen(true);
      return;
    }
    onChange(Number(v));
  };

  const applyCustom = () => {
    const parsed = Number(customNum);
    if (!Number.isFinite(parsed) || parsed < 1) return;
    onChange(normalizeCustom(parsed, customUnit));
    setCustomOpen(false);
  };

  return (
    <div className="space-y-1">
      <Select value={value} onValueChange={handleChange} disabled={disabled}>
        <SelectTrigger className="bg-white/80">
          <SelectValue placeholder="Не напоминать" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Не напоминать</SelectItem>
          {REMIND_PRESETS.map((p) => (
            <SelectItem key={p.value} value={String(p.value)}>
              {p.label}
            </SelectItem>
          ))}
          {isCustom && offsetMinutes != null ? (
            <SelectItem value={CUSTOM}>{formatCustomLabel(offsetMinutes)}</SelectItem>
          ) : null}
          <SelectItem value={CUSTOM}>Своё значение…</SelectItem>
        </SelectContent>
      </Select>

      {disabled ? (
        <p className="text-[11px] text-muted-foreground">
          Сначала укажите дедлайн.
        </p>
      ) : warnPast ? (
        <p className="text-[11px] text-amber-700">
          Напоминание в прошлом — оно уйдёт сразу.
        </p>
      ) : null}

      <Popover open={customOpen} onOpenChange={setCustomOpen}>
        <PopoverTrigger asChild>
          <span />
        </PopoverTrigger>
        <PopoverContent className="w-64 space-y-2" align="start">
          <Label className="text-xs">Напомнить за</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              value={customNum}
              onChange={(e) => setCustomNum(e.target.value)}
              className="h-8"
            />
            <Select value={customUnit} onValueChange={(v) => setCustomUnit(v as any)}>
              <SelectTrigger className="h-8 w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="min">минут</SelectItem>
                <SelectItem value="hour">часов</SelectItem>
                <SelectItem value="day">дней</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={() => setCustomOpen(false)}>
              Отмена
            </Button>
            <Button size="sm" onClick={applyCustom}>
              Применить
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Восстановить пресет по разнице due_at − remind_at. */
export function inferOffsetMinutes(
  dueAt: string | null | undefined,
  remindAt: string | null | undefined,
): number | null {
  if (!dueAt || !remindAt) return null;
  const due = new Date(dueAt).getTime();
  const rem = new Date(remindAt).getTime();
  if (!Number.isFinite(due) || !Number.isFinite(rem)) return null;
  const diffMin = Math.round((due - rem) / 60000);
  return diffMin > 0 ? diffMin : null;
}

/** Вычислить remind_at из due_at и offset. */
export function computeRemindAt(
  dueAt: string | null,
  offsetMinutes: number | null,
): string | null {
  if (!dueAt || offsetMinutes == null) return null;
  const t = new Date(dueAt).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t - offsetMinutes * 60000).toISOString();
}
