import { useState } from "react";
import { cn } from "@/lib/utils";
import { Calendar, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { format, startOfMonth, endOfMonth, subMonths, startOfQuarter, endOfQuarter, subQuarters, startOfYear, endOfYear, subYears } from "date-fns";
import { ru } from "date-fns/locale";
import { DateFilter } from "@/hooks/useUnifiedPayments";

interface DatePeriodSelectorProps {
  value: DateFilter;
  onChange: (value: DateFilter) => void;
}

type PresetKey = 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'lastQuarter' | 'thisYear' | 'lastYear' | 'custom';

interface Preset {
  key: PresetKey;
  label: string;
  getRange: () => { from: string; to: string };
}

const presets: Preset[] = [
  {
    key: 'thisMonth',
    label: 'Этот месяц',
    getRange: () => {
      const now = new Date();
      return {
        from: format(startOfMonth(now), 'yyyy-MM-dd'),
        to: format(endOfMonth(now), 'yyyy-MM-dd'),
      };
    },
  },
  {
    key: 'lastMonth',
    label: 'Прошлый месяц',
    getRange: () => {
      const lastMonth = subMonths(new Date(), 1);
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
      const now = new Date();
      return {
        from: format(startOfQuarter(now), 'yyyy-MM-dd'),
        to: format(endOfQuarter(now), 'yyyy-MM-dd'),
      };
    },
  },
  {
    key: 'lastQuarter',
    label: 'Прошлый квартал',
    getRange: () => {
      const lastQuarter = subQuarters(new Date(), 1);
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
      const now = new Date();
      return {
        from: format(startOfYear(now), 'yyyy-MM-dd'),
        to: format(endOfYear(now), 'yyyy-MM-dd'),
      };
    },
  },
  {
    key: 'lastYear',
    label: 'Прошлый год',
    getRange: () => {
      const lastYear = subYears(new Date(), 1);
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
  const activePreset = detectActivePreset(value);
  if (activePreset !== 'custom') {
    const preset = presets.find(p => p.key === activePreset);
    return preset?.label || '';
  }
  
  const fromDate = new Date(value.from);
  const toStr = value.to ? format(new Date(value.to), 'd MMM', { locale: ru }) : 'сегодня';
  return `${format(fromDate, 'd MMM', { locale: ru })} — ${toStr}`;
}

export default function DatePeriodSelector({ value, onChange }: DatePeriodSelectorProps) {
  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(value.from);
  const [customTo, setCustomTo] = useState(value.to || '');
  
  const activePreset = detectActivePreset(value);

  const handlePresetClick = (preset: Preset) => {
    const range = preset.getRange();
    onChange({ from: range.from, to: range.to });
    setCustomFrom(range.from);
    setCustomTo(range.to);
    setOpen(false);
  };

  const handleCustomApply = () => {
    onChange({ from: customFrom, to: customTo || undefined });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "h-9 gap-2 px-3",
            "bg-background/60 backdrop-blur-sm border-border/50",
            "hover:bg-background/80 hover:border-border",
            "transition-all duration-200"
          )}
        >
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{formatPeriodLabel(value)}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent 
        align="start" 
        className={cn(
          "w-72 p-0",
          "bg-background/95 backdrop-blur-xl",
          "border-border/50 shadow-xl",
          "rounded-xl overflow-hidden"
        )}
      >
        {/* Presets */}
        <div className="p-2 space-y-1">
          {presets.map((preset) => (
            <button
              key={preset.key}
              onClick={() => handlePresetClick(preset)}
              className={cn(
                "w-full text-left px-3 py-2 rounded-lg text-sm",
                "transition-all duration-150",
                activePreset === preset.key
                  ? "bg-primary/10 text-primary font-medium"
                  : "hover:bg-muted/50 text-foreground"
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
        
        {/* Divider */}
        <div className="h-px bg-border/50 mx-2" />
        
        {/* Custom range */}
        <div className="p-3 space-y-3">
          <Label className="text-xs text-muted-foreground font-medium">
            Свой период
          </Label>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="custom-from" className="text-xs text-muted-foreground">С</Label>
              <Input
                id="custom-from"
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-8 text-xs bg-muted/30 border-border/30"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="custom-to" className="text-xs text-muted-foreground">По</Label>
              <Input
                id="custom-to"
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-8 text-xs bg-muted/30 border-border/30"
              />
            </div>
          </div>
          <Button 
            size="sm" 
            onClick={handleCustomApply}
            className="w-full h-8 text-xs"
          >
            Применить
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
