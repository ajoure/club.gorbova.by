import * as React from "react";
import { CalendarIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const MONTHS_RU = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

export interface MonthYearPickerProps {
  /** YYYY-MM string or null */
  value?: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  yearRange?: { from: number; to: number };
  className?: string;
  id?: string;
}

export function formatMonthYearLabel(value?: string | null): string | null {
  if (!value) return null;
  const m = value.match(/^(\d{4})-(\d{2})$/);
  if (!m) return value;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  if (month < 1 || month > 12) return value;
  return `${MONTHS_RU[month - 1]} ${year}`;
}

export function MonthYearPicker({
  value,
  onChange,
  placeholder = "Выберите месяц",
  disabled,
  allowClear = true,
  yearRange,
  className,
  id,
}: MonthYearPickerProps) {
  const now = new Date();
  const range = yearRange ?? { from: now.getFullYear() - 5, to: now.getFullYear() + 2 };
  const years = React.useMemo(() => {
    const arr: number[] = [];
    for (let y = range.to; y >= range.from; y--) arr.push(y);
    return arr;
  }, [range.from, range.to]);

  const parsed = React.useMemo(() => {
    if (!value) return { year: undefined as number | undefined, month: undefined as number | undefined };
    const m = value.match(/^(\d{4})-(\d{2})$/);
    if (!m) return { year: undefined, month: undefined };
    return { year: parseInt(m[1], 10), month: parseInt(m[2], 10) };
  }, [value]);

  const [open, setOpen] = React.useState(false);
  const [draftYear, setDraftYear] = React.useState<number | undefined>(parsed.year ?? now.getFullYear());

  React.useEffect(() => {
    if (open) setDraftYear(parsed.year ?? now.getFullYear());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const label = formatMonthYearLabel(value);

  const pickMonth = (monthIdx: number) => {
    const y = draftYear ?? now.getFullYear();
    const mm = String(monthIdx + 1).padStart(2, "0");
    onChange(`${y}-${mm}`);
    setOpen(false);
  };

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              "w-full justify-start text-left font-normal",
              !value && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {label ?? <span>{placeholder}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3 pointer-events-auto" align="start">
          <div className="space-y-3">
            <Select
              value={String(draftYear ?? now.getFullYear())}
              onValueChange={(v) => setDraftYear(parseInt(v, 10))}
            >
              <SelectTrigger className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-[40vh]">
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="grid grid-cols-3 gap-1.5 w-[240px]">
              {MONTHS_RU.map((name, idx) => {
                const isSelected =
                  parsed.year === draftYear && parsed.month === idx + 1;
                return (
                  <Button
                    key={name}
                    type="button"
                    size="sm"
                    variant={isSelected ? "default" : "outline"}
                    className="h-8 text-xs"
                    onClick={() => pickMonth(idx)}
                  >
                    {name.slice(0, 3)}
                  </Button>
                );
              })}
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {allowClear && value && !disabled && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => onChange(null)}
          aria-label="Очистить"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
