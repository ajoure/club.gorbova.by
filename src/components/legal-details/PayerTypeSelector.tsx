import { Button } from "@/components/ui/button";
import { User, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** UI-level type discriminator: individual or organization (ЮЛ + ИП unified) */
export type PayerUiType = "individual" | "organization";

interface PayerTypeSelectorProps {
  value: PayerUiType;
  onChange: (type: PayerUiType) => void;
}

const types: { value: PayerUiType; label: string; icon: React.ReactNode; description: string }[] = [
  {
    value: "individual",
    label: "Физлицо",
    icon: <User className="h-5 w-5" />,
    description: "Паспортные данные",
  },
  {
    value: "organization",
    label: "Организация / ИП",
    icon: <Building2 className="h-5 w-5" />,
    description: "УНП, реквизиты, адрес",
  },
];

export function PayerTypeSelector({ value, onChange }: PayerTypeSelectorProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {types.map((type) => (
        <Button
          key={type.value}
          type="button"
          variant={value === type.value ? "default" : "outline"}
          className={cn(
            "h-auto py-4 flex flex-col gap-2 transition-all",
            value === type.value && "ring-2 ring-primary ring-offset-2"
          )}
          onClick={() => onChange(type.value)}
        >
          {type.icon}
          <span className="font-medium">{type.label}</span>
          <span className="text-xs opacity-70 font-normal">{type.description}</span>
        </Button>
      ))}
    </div>
  );
}
