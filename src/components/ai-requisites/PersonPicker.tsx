/**
 * PersonPicker — combobox for selecting an existing person.
 * Shows only active persons by default, but always includes
 * the currently selected person even if inactive.
 */

import { useState, useMemo } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Check, ChevronsUpDown, User } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PersonRow } from "@/hooks/useAiPersons";

interface PersonPickerProps {
  persons: PersonRow[];
  value: string | null;
  onChange: (personId: string | null) => void;
  disabled?: boolean;
}

export function PersonPicker({ persons, value, onChange, disabled }: PersonPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return persons
      .filter((p) => {
        // Always show active + the currently selected person
        if (!p.is_active && p.id !== value) return false;
        if (!q) return true;
        const name = (p.full_name || "").toLowerCase();
        const pn = (p.personal_number || "").toLowerCase();
        return name.includes(q) || pn.includes(q);
      })
      .slice(0, 50);
  }, [persons, search, value]);

  const selected = persons.find((p) => p.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          {selected ? (
            <span className="truncate flex items-center gap-2">
              <User className="w-3 h-3 shrink-0" />
              {selected.full_name || "Без имени"}
              {!selected.is_active && (
                <Badge variant="secondary" className="text-[10px] h-4">неактивен</Badge>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">Выберите физлицо…</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <div className="p-2">
          <Input
            placeholder="Поиск по ФИО…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-sm"
            autoFocus
          />
        </div>
        <div className="max-h-60 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground p-3 text-center">Не найдено</p>
          ) : (
            filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                className={cn(
                  "flex items-center gap-2 w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors",
                  p.id === value && "bg-accent"
                )}
                onClick={() => {
                  onChange(p.id === value ? null : p.id);
                  setOpen(false);
                  setSearch("");
                }}
              >
                <Check className={cn("w-4 h-4 shrink-0", p.id === value ? "opacity-100" : "opacity-0")} />
                <div className="min-w-0">
                  <div className="truncate font-medium">{p.full_name || "Без имени"}</div>
                  {p.personal_number && (
                    <div className="text-xs text-muted-foreground">{p.personal_number}</div>
                  )}
                </div>
                {!p.is_active && (
                  <Badge variant="secondary" className="text-[10px] h-4 ml-auto shrink-0">неактивен</Badge>
                )}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
