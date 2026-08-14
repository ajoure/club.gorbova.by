import { useState } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  MonthYearPicker,
  formatMonthYearLabel,
} from "@/components/ui/month-year-picker";
import { normalizeLiveAccessPurchaseMonths } from "@/lib/liveEventAccessMonths";

interface LiveEventPurchaseMonthsPickerProps {
  value: string[];
  fallbackMonth?: string | null;
  onChange: (months: string[]) => void;
}

export function LiveEventPurchaseMonthsPicker({
  value,
  fallbackMonth,
  onChange,
}: LiveEventPurchaseMonthsPickerProps) {
  const [draftMonth, setDraftMonth] = useState<string | null>(null);
  const months = normalizeLiveAccessPurchaseMonths(value, fallbackMonth);

  const addMonth = (month: string | null) => {
    setDraftMonth(null);
    if (!month || months.includes(month)) return;
    onChange([...months, month].sort());
  };

  const removeMonth = (month: string) => {
    onChange(months.filter((item) => item !== month));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2" aria-label="Допустимые месяцы покупки">
        {months.map((month) => (
          <Badge key={month} variant="secondary" className="gap-1 py-1 pl-2.5 pr-1">
            {formatMonthYearLabel(month) ?? month}
            {months.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-5 w-5 rounded-full"
                aria-label={`Удалить ${formatMonthYearLabel(month) ?? month}`}
                onClick={() => removeMonth(month)}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </Badge>
        ))}
      </div>
      <MonthYearPicker
        value={draftMonth}
        onChange={addMonth}
        allowClear={false}
        placeholder="Добавить ещё месяц"
      />
    </div>
  );
}
