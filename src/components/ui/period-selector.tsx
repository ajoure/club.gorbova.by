import { useState } from "react";
import { cn } from "@/lib/utils";
import { Calendar as CalendarIcon, ChevronDown, X, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { format, startOfMonth, endOfMonth, subMonths, startOfQuarter, endOfQuarter, subQuarters, startOfYear, endOfYear, subYears, parseISO, subDays, startOfWeek, endOfWeek, subWeeks } from "date-fns";
import { ru } from "date-fns/locale";
import { toZonedTime } from "date-fns-tz";

// PATCH-3: All periods computed in Minsk TZ
const MINSK_TZ = 'Europe/Minsk';

export interface DateFilter {
  from: string;
  to?: string;
}

interface PeriodSelectorProps {
  value: DateFilter;
  onChange: (value: DateFilter) => void;
  className?: string;
  align?: "start" | "center" | "end";
}

type PresetKey = 'allTime' | 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'lastQuarter' | 'thisYear' | 'lastYear' | 'custom';

interface Preset {
  key: PresetKey;
  label: string;
  getRange: () => { from: string; to: string };
}

// PATCH-3: Helper to get current time in Minsk TZ
function getNowMinsk(): Date {
  return toZonedTime(new Date(), MINSK_TZ);
}

const presets: Preset[] = [
  {
    key: 'allTime',
    label: 'Все периоды',
    getRange: () => ({
      from: '2020-01-01',
      to: format(getNowMinsk(), 'yyyy-MM-dd'),
    }),
  },
  {
    key: 'today',
    label: 'Сегодня',
    getRange: () => {
      const nowMinsk = getNowMinsk();
      const today = format(nowMinsk, 'yyyy-MM-dd');
      return { from: today, to: today };
    },
  },
  {
    key: 'yesterday',
    label: 'Вчера',
    getRange: () => {
      const yesterday = subDays(getNowMinsk(), 1);
      const date = format(yesterday, 'yyyy-MM-dd');
      return { from: date, to: date };
    },
  },
  {
    key: 'thisWeek',
    label: 'Эта неделя',
    getRange: () => {
      const nowMinsk = getNowMinsk();
      return {
        from: format(startOfWeek(nowMinsk, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
        to: format(endOfWeek(nowMinsk, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
      };
    },
  },
  {
    key: 'lastWeek',
    label: 'Прошлая неделя',
    getRange: () => {
      const lastWeek = subWeeks(getNowMinsk(), 1);
      return {
        from: format(startOfWeek(lastWeek, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
        to: format(endOfWeek(lastWeek, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
      };
    },
  },
  {
    key: 'thisMonth',
    label: 'Этот месяц',
    getRange: () => {
      const nowMinsk = getNowMinsk();
      return {
        from: format(startOfMonth(nowMinsk), 'yyyy-MM-dd'),
        to: format(endOfMonth(nowMinsk), 'yyyy-MM-dd'),
      };
    },
  },
  {
    key: 'lastMonth',
    label: 'Прошлый месяц',
    getRange: () => {
      const lastMonth = subMonths(getNowMinsk(), 1);
      return {
        from: format(startOfMonth(lastMonth), 'yyyy-MM-dd'),
        to: format(endOfMonth(lastMonth), 'yyyy-MM-dd'),
      };
    },
  },
  {
    key: 'thisQuarter',
    label: 'Этот квартал',
    getRange: () => {
      const nowMinsk = getNowMinsk();
      return {
        from: format(startOfQuarter(nowMinsk), 'yyyy-MM-dd'),
        to: format(endOfQuarter(nowMinsk), 'yyyy-MM-dd'),
      };
    },
  },
  {
    key: 'lastQuarter',
    label: 'Прошлый квартал',
    getRange: () => {
      const lastQuarter = subQuarters(getNowMinsk(), 1);
      return {
        from: format(startOfQuarter(lastQuarter), 'yyyy-MM-dd'),
        to: format(endOfQuarter(lastQuarter), 'yyyy-MM-dd'),
      };
    },
  },
  {
    key: 'thisYear',
    label: 'Этот год',
    getRange: () => {
      const nowMinsk = getNowMinsk();
      return {
        from: format(startOfYear(nowMinsk), 'yyyy-MM-dd'),
        to: format(endOfYear(nowMinsk), 'yyyy-MM-dd'),
      };
    },
  },
  {
    key: 'lastYear',
    label: 'Прошлый год',
    getRange: () => {
      const lastYear = subYears(getNowMinsk(), 1);
      return {
        from: format(startOfYear(lastYear), 'yyyy-MM-dd'),
        to: format(endOfYear(lastYear), 'yyyy-MM-dd'),
      };
    },
  },
];

function detectActivePreset(value: DateFilter): PresetKey {
  for (const preset of presets) {
    const range = preset.getRange();
    if (value.from === range.from && value.to === range.to) {
      return preset.key;
    }
  }
  return 'custom';
}

function formatPeriodLabel(value: DateFilter): string {
  // Handle undefined/empty values
  if (!value.from) {
    return 'Все периоды';
  }
  
  const activePreset = detectActivePreset(value);
  if (activePreset !== 'custom') {
    const preset = presets.find(p => p.key === activePreset);
    return preset?.label || '';
  }
  
  const fromDate = new Date(value.from);
  // Validate date is valid
  if (isNaN(fromDate.getTime())) {
    return 'Все периоды';
  }
  
  const toStr = value.to ? format(new Date(value.to), 'd MMM', { locale: ru }) : 'сегодня';
  return `${format(fromDate, 'd MMM', { locale: ru })} — ${toStr}`;
}

// Glassmorphism Calendar Popover component
function GlassCalendarPicker({ 
  label, 
  value, 
  onChange,
  minDate,
  maxDate
}: { 
  label: string;
  value: Date | undefined;
  onChange: (date: Date | undefined) => void;
  minDate?: Date;
  maxDate?: Date;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex-1 space-y-1.5">
      <Label className="text-[11px] text-muted-foreground/80 font-medium">{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "w-full h-9 justify-start text-left text-xs font-normal",
              "bg-muted/40 border-border/40 rounded-lg",
              "hover:bg-muted/60 hover:border-border/60",
              "focus:ring-2 focus:ring-primary/20",
              "transition-all duration-200",
              !value && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
            {value ? format(value, "d MMM yyyy", { locale: ru }) : "Выбрать..."}
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
          <Calendar
            mode="single"
            selected={value}
            onSelect={(date) => {
              onChange(date);
              setOpen(false);
            }}
            disabled={(date) => {
              if (minDate && date < minDate) return true;
              if (maxDate && date > maxDate) return true;
              return false;
            }}
            locale={ru}
            initialFocus
            className={cn(
              "p-3 pointer-events-auto",
              "[&_.rdp-day_focus]:ring-2 [&_.rdp-day_focus]:ring-primary/30",
              "[&_.rdp-day_selected]:bg-primary [&_.rdp-day_selected]:text-primary-foreground",
              "[&_.rdp-day_today]:bg-accent/60 [&_.rdp-day_today]:font-semibold"
            )}
          />
          <div className="flex items-center justify-between p-2 pt-0 border-t border-border/30">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                onChange(undefined);
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
                onChange(new Date());
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

export function PeriodSelector({ value, onChange, className, align = "start" }: PeriodSelectorProps) {
  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState<Date | undefined>(
    value.from ? parseISO(value.from) : undefined
  );
  const [customTo, setCustomTo] = useState<Date | undefined>(
    value.to ? parseISO(value.to) : undefined
  );
  
  const activePreset = detectActivePreset(value);

  const handlePresetClick = (preset: Preset) => {
    const range = preset.getRange();
    onChange({ from: range.from, to: range.to });
    setCustomFrom(parseISO(range.from));
    setCustomTo(parseISO(range.to));
    setOpen(false);
  };

  const handleCustomApply = () => {
    if (customFrom) {
      onChange({ 
        from: format(customFrom, 'yyyy-MM-dd'), 
        to: customTo ? format(customTo, 'yyyy-MM-dd') : undefined 
      });
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "h-8 gap-2 px-3 text-xs",
            "bg-background/60 backdrop-blur-sm border-border/50",
            "hover:bg-background/80 hover:border-border",
            "transition-all duration-200",
            className
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-medium">{formatPeriodLabel(value)}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent 
        align={align}
        sideOffset={8}
        className={cn(
          "w-80 p-0 z-50",
          "bg-background/95 backdrop-blur-xl",
          "border-border/50 shadow-2xl",
          "rounded-2xl overflow-hidden",
          "animate-in fade-in-0 zoom-in-95"
        )}
      >
        {/* Presets */}
        <div className="p-2 space-y-0.5">
          {presets.map((preset) => (
            <button
              key={preset.key}
              onClick={() => handlePresetClick(preset)}
              className={cn(
                "w-full text-left px-3 py-2.5 rounded-xl text-sm",
                "transition-all duration-200",
                activePreset === preset.key
                  ? "bg-primary text-primary-foreground font-medium shadow-sm"
                  : "hover:bg-muted/60 text-foreground"
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
        
        {/* Divider */}
        <div className="h-px bg-border/40 mx-3" />
        
        {/* Custom range with Calendar pickers */}
        <div className="p-3 space-y-3">
          <Label className="text-xs text-muted-foreground font-medium">
            Свой период
          </Label>
          <div className="flex gap-2">
            <GlassCalendarPicker
              label="С"
              value={customFrom}
              onChange={setCustomFrom}
              maxDate={customTo}
            />
            <GlassCalendarPicker
              label="По"
              value={customTo}
              onChange={setCustomTo}
              minDate={customFrom}
            />
          </div>
          <Button 
            size="sm" 
            onClick={handleCustomApply}
            disabled={!customFrom}
            className="w-full h-9 text-xs rounded-xl"
          >
            Применить
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Export presets for use in other components
export { presets, detectActivePreset, formatPeriodLabel };
