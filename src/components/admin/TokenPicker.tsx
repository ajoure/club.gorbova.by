import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger, PopoverAnchor } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Braces } from "lucide-react";

interface TokenPickerProps {
  onInsert: (token: string) => void;
  entityTypes?: string[];
  /** Controlled open state */
  open?: boolean;
  /** Callback when open state changes */
  onOpenChange?: (v: boolean) => void;
  /** If true, don't render the trigger button (used for keyboard-triggered mode) */
  triggerless?: boolean;
  /** Anchor element ref for triggerless mode positioning */
  anchorRef?: React.RefObject<HTMLElement>;
  /** Show standard contact variables group */
  showContactVars?: boolean;
  /** Show system date/time variables group */
  showSystemVars?: boolean;
}

/** Standard contact variables available in broadcast templates */
const STANDARD_CONTACT_VARS = [
  { key: "full_name", label: "Полное имя", dataType: "text" },
  { key: "first_name", label: "Имя", dataType: "text" },
  { key: "last_name", label: "Фамилия", dataType: "text" },
  { key: "email", label: "Email", dataType: "text" },
  { key: "phone", label: "Телефон", dataType: "text" },
  { key: "telegram_username", label: "Telegram username", dataType: "text" },
] as const;

/** System date/time variables */
const SYSTEM_DATE_VARS = [
  { key: "today", label: "Сегодня (дд.мм.гггг)", dataType: "date" },
  { key: "tomorrow", label: "Завтра", dataType: "date" },
  { key: "yesterday", label: "Вчера", dataType: "date" },
  { key: "now", label: "Сейчас (дата+время)", dataType: "date" },
  { key: "month_name", label: "Месяц (словом)", dataType: "date" },
  { key: "month", label: "Месяц (01-12)", dataType: "date" },
  { key: "year", label: "Год", dataType: "date" },
  { key: "day", label: "День (01-31)", dataType: "date" },
  { key: "weekday", label: "День недели", dataType: "date" },
] as const;

const DATA_TYPE_LABELS: Record<string, string> = {
  text: "Текст",
  number: "Число",
  boolean: "Да/Нет",
  date: "Дата",
  json: "JSON",
  url: "URL",
  select: "Список",
  multiselect: "Мульти",
};

export function TokenPicker({ onInsert, entityTypes = ["product"], open: openProp, onOpenChange, triggerless, anchorRef, showContactVars = true, showSystemVars = true }: TokenPickerProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = openProp ?? internalOpen;
  const searchInputRef = useRef<HTMLInputElement>(null);

  const setOpen = (v: boolean) => {
    setInternalOpen(v);
    onOpenChange?.(v);
  };

  // Focus search input when picker opens (stable via rAF)
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    }
  }, [isOpen]);

  const { data: fields = [] } = useQuery({
    queryKey: ["fields-registry-picker", entityTypes],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fields_registry")
        .select("id, entity_type, key, label, data_type")
        .in("entity_type", entityTypes)
        .is("archived_at", null)
        .order("entity_type")
        .order("label");

      if (error) throw error;
      return data ?? [];
    },
    enabled: isOpen,
  });

  const grouped = entityTypes.reduce<Record<string, typeof fields>>((acc, et) => {
    acc[et] = fields.filter((f) => f.entity_type === et);
    return acc;
  }, {});

  const ENTITY_LABELS: Record<string, string> = {
    product: "Продукт",
    contact: "Контакт",
  };

  const handleSelect = (field: typeof fields[number]) => {
    onInsert(`{{cf.${field.entity_type}.${field.id}}}`);
    setOpen(false);
  };

  const content = (
    <PopoverContent className="max-w-[320px] p-0" align="start" side="bottom" collisionPadding={8}>
      <Command>
        <CommandInput ref={searchInputRef} placeholder="Поиск по названию..." className="text-xs h-8" />
        <CommandList className="max-h-[240px] overflow-auto">
          <CommandEmpty>Поля не найдены</CommandEmpty>
          {showContactVars && (
            <CommandGroup heading="Контакт / Профиль">
              {STANDARD_CONTACT_VARS.map((v) => (
                <CommandItem
                  key={v.key}
                  value={`${v.label} ${v.key}`}
                  className="text-xs py-1"
                  onSelect={() => {
                    onInsert(`{{${v.key}}}`);
                    setOpen(false);
                  }}
                >
                  <span className="flex-1 truncate">{v.label}</span>
                  <Badge variant="secondary" className="ml-2 text-[10px] px-1.5 py-0">
                    {DATA_TYPE_LABELS[v.dataType] ?? v.dataType}
                  </Badge>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {showSystemVars && (
            <CommandGroup heading="Дата / Время">
              {SYSTEM_DATE_VARS.map((v) => (
                <CommandItem
                  key={v.key}
                  value={`${v.label} ${v.key}`}
                  className="text-xs py-1"
                  onSelect={() => {
                    onInsert(`{{${v.key}}}`);
                    setOpen(false);
                  }}
                >
                  <span className="flex-1 truncate">{v.label}</span>
                  <Badge variant="secondary" className="ml-2 text-[10px] px-1.5 py-0">
                    {DATA_TYPE_LABELS[v.dataType] ?? v.dataType}
                  </Badge>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {entityTypes.map((et) => (
            <CommandGroup key={et} heading={ENTITY_LABELS[et] ?? et}>
              {(grouped[et] ?? []).map((field) => (
                <CommandItem
                  key={field.id}
                  value={`${field.label} ${field.key}`}
                  className="text-xs py-1"
                  onSelect={() => handleSelect(field)}
                >
                  <span className="flex-1 truncate">{field.label}</span>
                  <Badge variant="secondary" className="ml-2 text-[10px] px-1.5 py-0">
                    {DATA_TYPE_LABELS[field.data_type] ?? field.data_type}
                  </Badge>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </PopoverContent>
  );

  if (triggerless) {
    return (
      <Popover open={isOpen} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <span
            ref={anchorRef as React.RefObject<HTMLSpanElement> | undefined}
            className="inline-block w-0 h-0"
          />
        </PopoverAnchor>
        {content}
      </Popover>
    );
  }

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" title="Вставить токен поля">
          <Braces className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      {content}
    </Popover>
  );
}
