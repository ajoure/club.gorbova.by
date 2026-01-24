import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { LayoutGrid, List, LayoutList, Maximize } from "lucide-react";

const LAYOUT_OPTIONS = [
  {
    value: "grid",
    label: "Сетка",
    icon: LayoutGrid,
    description: "Карточки 2-3 колонки",
  },
  {
    value: "list",
    label: "Список",
    icon: List,
    description: "Вертикальный список",
  },
  {
    value: "cards-horizontal",
    label: "Широкие",
    icon: LayoutList,
    description: "Горизонтальные карточки",
  },
  {
    value: "fullscreen",
    label: "Большие",
    icon: Maximize,
    description: "Крупные блоки",
  },
] as const;

export type DisplayLayout = typeof LAYOUT_OPTIONS[number]["value"];

interface DisplayLayoutSelectorProps {
  value: string;
  onChange: (value: DisplayLayout) => void;
  className?: string;
}

export function DisplayLayoutSelector({
  value,
  onChange,
  className,
}: DisplayLayoutSelectorProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label>Стиль отображения</Label>
      <p className="text-xs text-muted-foreground mb-2">
        Как модуль будет выглядеть для пользователей
      </p>
      <div className="grid grid-cols-4 gap-2">
        {LAYOUT_OPTIONS.map((option) => {
          const Icon = option.icon;
          const isSelected = value === option.value;

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={cn(
                "flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all",
                "hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/20",
                isSelected
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border text-muted-foreground"
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-medium leading-tight text-center">
                {option.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
