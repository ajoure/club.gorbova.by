// Re-export from shared UI component for backwards compatibility
import { PeriodSelector, DateFilter } from "@/components/ui/period-selector";

interface DatePeriodSelectorProps {
  value: DateFilter;
  onChange: (value: DateFilter) => void;
}

export default function DatePeriodSelector({ value, onChange }: DatePeriodSelectorProps) {
  return <PeriodSelector value={value} onChange={onChange} />;
}

export { type DateFilter };
