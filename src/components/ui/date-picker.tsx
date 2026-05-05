import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Calendar as CalendarIcon, X, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { format, parse, parseISO, isValid } from "date-fns";
import { ru } from "date-fns/locale";

export interface DatePickerProps {
  value?: string; // yyyy-MM-dd (canonical storage format)
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  minDate?: string; // yyyy-MM-dd
  maxDate?: string; // yyyy-MM-dd
  className?: string;
  disabled?: boolean;
  id?: string;
  /** Enable month/year dropdowns + manual input. */
  fromYear?: number;
  toYear?: number;
  /** Force-enable extended UI even without year range. */
  showMonthYearDropdowns?: boolean;
  /** Force-enable manual input field. Default: true when fromYear/toYear set. */
  allowManualInput?: boolean;
}

const DISPLAY_FMT = "dd.MM.yyyy";

function tryParseInput(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  // Try dd.MM.yyyy
  let d = parse(s, DISPLAY_FMT, new Date());
  if (isValid(d)) return d;
  // Try yyyy-MM-dd
  d = parse(s, "yyyy-MM-dd", new Date());
  if (isValid(d)) return d;
  // Tolerate dd/MM/yyyy
  d = parse(s, "dd/MM/yyyy", new Date());
  if (isValid(d)) return d;
  return null;
}

export function DatePicker({
  value,
  onChange,
  label,
  placeholder = "Выбрать дату...",
  minDate,
  maxDate,
  className,
  disabled,
  id,
  fromYear,
  toYear,
  showMonthYearDropdowns,
  allowManualInput,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);

  const dateValue = value ? parseISO(value) : undefined;
  const minDateObj = minDate ? parseISO(minDate) : undefined;
  const maxDateObj = maxDate ? parseISO(maxDate) : undefined;

  const extended =
    showMonthYearDropdowns === true ||
    typeof fromYear === "number" ||
    typeof toYear === "number";
  const manual = allowManualInput ?? extended;

  // Manual input local state
  const [inputText, setInputText] = useState<string>(
    dateValue ? format(dateValue, DISPLAY_FMT) : ""
  );
  const [inputError, setInputError] = useState<string | null>(null);

  useEffect(() => {
    setInputText(dateValue ? format(dateValue, DISPLAY_FMT) : "");
    setInputError(null);
  }, [value]);

  const commitInput = (closeOnSuccess: boolean) => {
    const txt = inputText.trim();
    if (!txt) {
      onChange("");
      setInputError(null);
      if (closeOnSuccess) setOpen(false);
      return;
    }
    const d = tryParseInput(txt);
    if (!d) {
      setInputError("Формат: ДД.ММ.ГГГГ");
      return;
    }
    if (minDateObj && d < minDateObj) {
      setInputError("Дата слишком ранняя");
      return;
    }
    if (maxDateObj && d > maxDateObj) {
      setInputError("Дата слишком поздняя");
      return;
    }
    setInputError(null);
    onChange(format(d, "yyyy-MM-dd"));
    if (closeOnSuccess) setOpen(false);
  };

  // Compute defaultMonth so dropdown opens at a sensible year when no value yet.
  const defaultMonth =
    dateValue ??
    (toYear ? new Date(toYear, 0, 1) : undefined);

  const calendarExtraProps: Record<string, unknown> = {};
  if (extended) {
    calendarExtraProps.captionLayout = "dropdown-buttons";
    if (typeof fromYear === "number") calendarExtraProps.fromYear = fromYear;
    if (typeof toYear === "number") calendarExtraProps.toYear = toYear;
  }
  if (defaultMonth) calendarExtraProps.defaultMonth = defaultMonth;

  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <Label className="text-[11px] text-muted-foreground/80 font-medium">{label}</Label>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            disabled={disabled}
            className={cn(
              "w-full h-9 justify-start text-left text-xs font-normal",
              "bg-muted/40 border-border/40 rounded-lg",
              "hover:bg-muted/60 hover:border-border/60",
              "focus:ring-2 focus:ring-primary/20",
              "transition-all duration-200",
              !dateValue && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
            {dateValue ? format(dateValue, DISPLAY_FMT, { locale: ru }) : placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={4}
          className={cn(
            "w-auto p-0 z-[100]",
            "bg-background/95 backdrop-blur-xl",
            "border-border/50 shadow-2xl",
            "rounded-2xl overflow-hidden",
            "animate-in fade-in-0 zoom-in-95"
          )}
        >
          {manual && (
            <div className="p-2 pb-0 space-y-1">
              <Input
                autoFocus
                value={inputText}
                onChange={(e) => {
                  setInputText(e.target.value);
                  if (inputError) setInputError(null);
                }}
                onBlur={() => commitInput(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitInput(true);
                  }
                }}
                placeholder="ДД.ММ.ГГГГ"
                inputMode="numeric"
                className={cn(
                  "h-8 text-xs",
                  inputError && "border-destructive focus-visible:ring-destructive/30"
                )}
              />
              {inputError && (
                <p className="text-[10px] text-destructive px-0.5">{inputError}</p>
              )}
            </div>
          )}
          <Calendar
            mode="single"
            selected={dateValue}
            onSelect={(date) => {
              if (date) {
                onChange(format(date, "yyyy-MM-dd"));
              }
              setOpen(false);
            }}
            disabled={(date) => {
              if (minDateObj && date < minDateObj) return true;
              if (maxDateObj && date > maxDateObj) return true;
              return false;
            }}
            locale={ru}
            initialFocus={!manual}
            className={cn(
              "p-3 pointer-events-auto",
              "[&_.rdp-day_focus]:ring-2 [&_.rdp-day_focus]:ring-primary/30",
              "[&_.rdp-day_selected]:bg-primary [&_.rdp-day_selected]:text-primary-foreground",
              "[&_.rdp-day_today]:bg-accent/60 [&_.rdp-day_today]:font-semibold"
            )}
            {...calendarExtraProps}
          />
          <div className="flex items-center justify-between p-2 pt-0 border-t border-border/30">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              <X className="h-3 w-3 mr-1" />
              Очистить
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                const today = new Date();
                if (minDateObj && today < minDateObj) return;
                if (maxDateObj && today > maxDateObj) return;
                onChange(format(today, "yyyy-MM-dd"));
                setOpen(false);
              }}
            >
              <CalendarDays className="h-3 w-3 mr-1" />
              Сегодня
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
