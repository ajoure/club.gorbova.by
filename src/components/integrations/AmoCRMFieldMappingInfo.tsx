import { Info } from "lucide-react";

const AMOCRM_FIELD_HINTS: Record<string, { description: string; examples: string[] }> = {
  contacts: {
    description: "Стандартные поля контактов amoCRM",
    examples: [
      "name — Имя контакта",
      "first_name — Имя",
      "last_name — Фамилия",
      "cf_XXXXXX — Пользовательское поле (замените XXXXXX на ID поля)",
      "PHONE — Рабочий телефон",
      "MOBIL — Мобильный телефон",
      "EMAIL — Email",
    ],
  },
  deals: {
    description: "Стандартные поля сделок amoCRM",
    examples: [
      "name — Название сделки",
      "price — Бюджет",
      "status_id — ID статуса",
      "pipeline_id — ID воронки",
      "responsible_user_id — ID ответственного",
      "cf_XXXXXX — Пользовательское поле",
    ],
  },
  companies: {
    description: "Стандартные поля компаний amoCRM",
    examples: [
      "name — Название компании",
      "PHONE — Телефон",
      "WEB — Сайт",
      "ADDRESS — Адрес",
      "cf_XXXXXX — Пользовательское поле",
    ],
  },
};

interface AmoCRMFieldMappingInfoProps {
  entityType: string;
}

export function AmoCRMFieldMappingInfo({ entityType }: AmoCRMFieldMappingInfoProps) {
  const hints = AMOCRM_FIELD_HINTS[entityType];
  
  if (!hints) return null;

  return (
    <div className="p-4 rounded-xl bg-primary/5 border border-primary/10 space-y-2 mb-4">
      <div className="flex items-center gap-2 text-sm font-medium text-primary">
        <Info className="h-4 w-4" />
        {hints.description}
      </div>
      <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
        {hints.examples.map((example, idx) => (
          <div key={idx} className="font-mono bg-background/50 px-2 py-1 rounded">
            {example}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Для пользовательских полей используйте <code className="bg-background/50 px-1 rounded">cf_</code> + ID поля из amoCRM
      </p>
    </div>
  );
}
