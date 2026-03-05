import { useState } from "react";
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
}

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

export function TokenPicker({ onInsert, entityTypes = ["product"], open: openProp, onOpenChange, triggerless }: TokenPickerProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = openProp ?? internalOpen;

  const setOpen = (v: boolean) => {
    setInternalOpen(v);
    onOpenChange?.(v);
  };

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
    <PopoverContent className="w-72 p-0" align="start">
      <Command>
        <CommandInput placeholder="Поиск по названию..." />
        <CommandList>
          <CommandEmpty>Поля не найдены</CommandEmpty>
          {entityTypes.map((et) => (
            <CommandGroup key={et} heading={ENTITY_LABELS[et] ?? et}>
              {(grouped[et] ?? []).map((field) => (
                <CommandItem
                  key={field.id}
                  value={`${field.label} ${field.key}`}
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
        <PopoverAnchor className="absolute" />
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
