import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger, PopoverAnchor } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Braces } from "lucide-react";
import {
  CONTACT_TOKENS,
  DATETIME_TOKENS,
  type TokenDef,
} from "@/lib/tokens/tokenRegistry";

interface TokenPickerProps {
  onInsert: (token: string) => void;
  entityTypes?: string[];
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  triggerless?: boolean;
  anchorRef?: React.RefObject<HTMLElement>;
  showContactVars?: boolean;
  showSystemVars?: boolean;
}

const ENTITY_LABELS: Record<string, string> = {
  product: "Продукт",
  contact: "Контакт",
};

export function TokenPicker({ onInsert, entityTypes = ["product"], open: openProp, onOpenChange, triggerless, anchorRef, showContactVars = true, showSystemVars = true }: TokenPickerProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = openProp ?? internalOpen;
  const searchInputRef = useRef<HTMLInputElement>(null);

  const setOpen = (v: boolean) => {
    setInternalOpen(v);
    onOpenChange?.(v);
  };

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    }
  }, [isOpen]);

  // Dynamic custom fields from fields_registry
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
              {CONTACT_TOKENS.map((t) => (
                <CommandItem
                  key={t.key}
                  value={t.searchKeywords}
                  className="text-xs py-1"
                  onSelect={() => {
                    onInsert(t.tokenString);
                    setOpen(false);
                  }}
                >
                  <span className="flex-1 truncate">{t.label}</span>
                  <Badge variant="secondary" className="ml-2 text-[10px] px-1.5 py-0">
                    {t.badge}
                  </Badge>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {showSystemVars && (
            <CommandGroup heading="Дата / Время">
              {DATETIME_TOKENS.map((t) => (
                <CommandItem
                  key={t.key}
                  value={t.searchKeywords}
                  className="text-xs py-1"
                  onSelect={() => {
                    onInsert(t.tokenString);
                    setOpen(false);
                  }}
                >
                  <span className="flex-1 truncate">{t.label}</span>
                  <Badge variant="secondary" className="ml-2 text-[10px] px-1.5 py-0">
                    {t.badge}
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
                    {field.data_type}
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
