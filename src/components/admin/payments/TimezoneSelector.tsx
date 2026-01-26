import { Clock } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const COMMON_TIMEZONES = [
  { value: 'Europe/Minsk', label: 'Минск (UTC+3)', short: 'Минск' },
  { value: 'Europe/Moscow', label: 'Москва (UTC+3)', short: 'Москва' },
  { value: 'Europe/Warsaw', label: 'Варшава (UTC+1)', short: 'Варшава' },
  { value: 'Europe/Kyiv', label: 'Киев (UTC+2)', short: 'Киев' },
  { value: 'Europe/London', label: 'Лондон (UTC+0)', short: 'Лондон' },
  { value: 'Europe/Paris', label: 'Париж (UTC+1)', short: 'Париж' },
  { value: 'Europe/Berlin', label: 'Берлин (UTC+1)', short: 'Берлин' },
  { value: 'Europe/Istanbul', label: 'Стамбул (UTC+3)', short: 'Стамбул' },
  { value: 'Asia/Dubai', label: 'Дубай (UTC+4)', short: 'Дубай' },
  { value: 'Asia/Tbilisi', label: 'Тбилиси (UTC+4)', short: 'Тбилиси' },
  { value: 'Africa/Cairo', label: 'Каир (UTC+2)', short: 'Каир' },
  { value: 'UTC', label: 'UTC (мировое время)', short: 'UTC' },
] as const;

interface TimezoneSelectorProps {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}

export function TimezoneSelector({ value, onValueChange, className }: TimezoneSelectorProps) {
  const selectedTz = COMMON_TIMEZONES.find(tz => tz.value === value);
  
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={`h-8 w-[130px] text-xs ${className}`}>
        <Clock className="h-3 w-3 mr-1.5 text-muted-foreground" />
        <SelectValue>
          {selectedTz?.short || value}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="end" className="max-h-[300px]">
        {COMMON_TIMEZONES.map(tz => (
          <SelectItem 
            key={tz.value} 
            value={tz.value}
            className="text-xs"
          >
            {tz.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Hook for persisting timezone selection
export function usePersistedTimezone(defaultTz: string = 'Europe/Minsk') {
  const storageKey = 'admin_payments_timezone';
  
  const getInitialValue = (): string => {
    if (typeof window === 'undefined') return defaultTz;
    const stored = localStorage.getItem(storageKey);
    return stored && COMMON_TIMEZONES.some(tz => tz.value === stored) ? stored : defaultTz;
  };
  
  const setTimezone = (tz: string) => {
    localStorage.setItem(storageKey, tz);
    return tz;
  };
  
  return { getInitialValue, setTimezone };
}
