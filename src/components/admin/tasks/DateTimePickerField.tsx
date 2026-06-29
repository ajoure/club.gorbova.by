import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import { DateTimePicker } from "@/components/ui/datetime-picker";

interface Props {
  /** ISO string or empty */
  value: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Thin wrapper over the canonical project DateTimePicker.
 * Exposes a single ISO-string value/onChange so it drops
 * into existing forms that used <input type="datetime-local">.
 */
export function DateTimePickerField({ value, onChange, disabled, className }: Props) {
  const { date, time } = useMemo(() => {
    if (!value) return { date: undefined as Date | undefined, time: "" };
    try {
      const d = parseISO(value);
      if (isNaN(d.getTime())) return { date: undefined, time: "" };
      return { date: d, time: format(d, "HH:mm") };
    } catch {
      return { date: undefined, time: "" };
    }
  }, [value]);

  const handleDate = (next: Date | undefined) => {
    if (!next) {
      onChange("");
      return;
    }
    // keep current time-of-day if set, else default to 09:00 (without time selected yet)
    const [hh, mm] = (time || "09:00").split(":").map((x) => parseInt(x, 10));
    const merged = new Date(next);
    merged.setHours(hh || 0, mm || 0, 0, 0);
    onChange(merged.toISOString());
  };

  const handleTime = (t: string) => {
    if (!date) {
      onChange("");
      return;
    }
    if (!t) {
      // clear time-of-day → keep date at 00:00
      const merged = new Date(date);
      merged.setHours(0, 0, 0, 0);
      onChange(merged.toISOString());
      return;
    }
    const [hh, mm] = t.split(":").map((x) => parseInt(x, 10));
    const merged = new Date(date);
    merged.setHours(hh || 0, mm || 0, 0, 0);
    onChange(merged.toISOString());
  };

  return (
    <DateTimePicker
      date={date}
      time={time}
      onDateChange={handleDate}
      onTimeChange={handleTime}
      disabled={disabled}
      className={className}
    />
  );
}
