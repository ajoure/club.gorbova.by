import { Button } from "@/components/ui/button";
import { User, Briefcase, Building2 } from "lucide-react";
import { ClientType } from "@/hooks/useLegalDetails";
import { cn } from "@/lib/utils";

interface PayerTypeSelectorProps {
  value: ClientType;
  onChange: (type: ClientType) => void;
}

const types: { value: ClientType; label: string; icon: React.ReactNode; description: string }[] = [
  {
    value: "individual",
    label: "Физлицо",
    icon: <User className="h-5 w-5" />,
    description: "Паспортные данные",
  },
  {
    value: "entrepreneur",
    label: "ИП",
    icon: <Briefcase className="h-5 w-5" />,
    description: "Индивидуальный предприниматель",
  },
  {
    value: "legal_entity",
    label: "Юрлицо",
    icon: <Building2 className="h-5 w-5" />,
    description: "ООО, ЗАО и т.д.",
  },
];

export function PayerTypeSelector({ value, onChange }: PayerTypeSelectorProps) {
  return (
    <div className="grid grid-cols-3 gap-3">
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
