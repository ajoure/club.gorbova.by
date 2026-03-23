/**
 * PositionPicker — searchable combobox for selecting a position from catalog.
 * Supports filtering by substring and adding new positions via RPC.
 * Shows "Add to directory" only when no exact normalized match exists.
 */

import { useState, useMemo } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, ChevronsUpDown, Plus, Briefcase } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PositionCatalogEntry } from "@/hooks/useEntityPersonLinks";

interface PositionPickerProps {
  positions: PositionCatalogEntry[];
  value: string | null;
  onChange: (id: string | null) => void;
  onCreateNew: (label: string) => Promise<string | null>;
  disabled?: boolean;
  /** Show legacy custom text hint when editing old links */
  legacyCustomText?: string | null;
}

function normalizeForCompare(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

export function PositionPicker({
  positions,
  value,
  onChange,
  onCreateNew,
  disabled,
  legacyCustomText,
}: PositionPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const normalizedSearch = normalizeForCompare(search);

  const filtered = useMemo(() => {
    if (!normalizedSearch) {
      return [...positions].sort((a, b) => a.label.localeCompare(b.label, "ru")).slice(0, 50);
    }
    return positions
      .filter((p) => p.label.toLowerCase().includes(normalizedSearch))
      .sort((a, b) => a.label.localeCompare(b.label, "ru"))
      .slice(0, 50);
  }, [positions, normalizedSearch]);

  const hasExactMatch = useMemo(() => {
    if (!normalizedSearch) return true; // don't show add when empty
    return positions.some(
      (p) => normalizeForCompare(p.label) === normalizedSearch
    );
  }, [positions, normalizedSearch]);

  const selected = positions.find((p) => p.id === value);

  const handleCreate = async () => {
    const label = search.trim();
    if (!label) return;
    setIsCreating(true);
    try {
      const newId = await onCreateNew(label);
      if (newId) {
        onChange(newId);
        setOpen(false);
        setSearch("");
      }
    } finally {
      setIsCreating(false);
    }
  };

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
              <Briefcase className="w-3 h-3 shrink-0" />
              {selected.label}
            </span>
          ) : legacyCustomText ? (
            <span className="truncate flex items-center gap-2 text-muted-foreground">
              <Briefcase className="w-3 h-3 shrink-0" />
              {legacyCustomText} (не в справочнике)
            </span>
          ) : (
            <span className="text-muted-foreground">Выберите должность…</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <div className="p-2">
          <Input
            placeholder="Поиск должности…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-sm"
            autoFocus
          />
        </div>
        <div className="max-h-60 overflow-y-auto">
          {filtered.length === 0 && hasExactMatch && (
            <p className="text-sm text-muted-foreground p-3 text-center">Не найдено</p>
          )}
          {filtered.map((p) => (
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
              <span className="truncate">{p.label}</span>
            </button>
          ))}
          {/* Add new — only when no exact normalized match */}
          {!hasExactMatch && normalizedSearch.length >= 2 && (
            <button
              type="button"
              disabled={isCreating}
              className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors text-primary border-t"
              onClick={handleCreate}
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span className="truncate">
                {isCreating ? "Добавляем…" : `Добавить «${search.trim()}» в справочник`}
              </span>
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
