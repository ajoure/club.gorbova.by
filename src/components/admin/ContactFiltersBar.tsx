import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Plus, X, Filter } from "lucide-react";
import { FilterField, ActiveFilter, FilterPreset } from "@/components/admin/QuickFilters";

const OPERATORS: Record<string, { value: string; label: string }[]> = {
  text: [
    { value: "contains", label: "содержит" },
    { value: "equals", label: "равно" },
    { value: "not_equals", label: "не равно" },
    { value: "empty", label: "пусто" },
    { value: "not_empty", label: "не пусто" },
  ],
  select: [
    { value: "equals", label: "равно" },
    { value: "not_equals", label: "не равно" },
  ],
  number: [
    { value: "equals", label: "=" },
    { value: "gt", label: ">" },
    { value: "lt", label: "<" },
    { value: "gte", label: "≥" },
    { value: "lte", label: "≤" },
  ],
  date: [
    { value: "equals", label: "равно" },
    { value: "gt", label: "после" },
    { value: "lt", label: "до" },
  ],
  boolean: [
    { value: "equals", label: "равно" },
  ],
};

interface ContactFiltersBarProps {
  fields: FilterField[];
  activeFilters: ActiveFilter[];
  onFiltersChange: (filters: ActiveFilter[]) => void;
  activePreset: string;
  presets: FilterPreset[];
}

export function ContactFiltersBar({
  fields,
  activeFilters,
  onFiltersChange,
  activePreset,
  presets,
}: ContactFiltersBarProps) {
  const [pendingValue, setPendingValue] = useState("");

  const customFilters = useMemo(() => {
    const presetFilters = presets.find(p => p.id === activePreset)?.filters || [];
    return activeFilters.filter(
      af => !presetFilters.some(
        pf => pf.field === af.field && pf.operator === af.operator && pf.value === af.value
      )
    );
  }, [activeFilters, activePreset, presets]);

  const handleAddFilter = (field: FilterField, operator: string, value: string) => {
    const newFilter: ActiveFilter = { field: field.key, operator, value };
    onFiltersChange([...activeFilters, newFilter]);
    setPendingValue("");
  };

  const handleRemoveFilter = (index: number) => {
    const preset = presets.find(p => p.id === activePreset);
    const presetFiltersCount = preset?.filters.length || 0;
    if (index < presetFiltersCount) {
      onFiltersChange(activeFilters.filter((_, i) => i !== index));
    } else {
      onFiltersChange(activeFilters.filter((_, i) => i !== index));
    }
  };

  const getFilterLabel = (filter: ActiveFilter) => {
    const field = fields.find(f => f.key === filter.field);
    if (!field) return filter.value;
    const operators = OPERATORS[field.type] || OPERATORS.text;
    const operator = operators.find(o => o.value === filter.operator);
    if (filter.operator === "empty") return `${field.label}: пусто`;
    if (filter.operator === "not_empty") return `${field.label}: не пусто`;
    let displayValue = filter.value;
    if (field.type === "select" && field.options) {
      const option = field.options.find(o => o.value === filter.value);
      displayValue = option?.label || filter.value;
    }
    if (field.type === "boolean") {
      displayValue = filter.value === "true" ? "Да" : "Нет";
    }
    return `${field.label} ${operator?.label || filter.operator} ${displayValue}`;
  };

  const renderValueInput = (field: FilterField, operator: string) => {
    if (operator === "empty" || operator === "not_empty") {
      return (
        <Button size="sm" className="w-full mt-2" onClick={() => handleAddFilter(field, operator, "")}>
          Применить
        </Button>
      );
    }
    if (field.type === "select" && field.options) {
      return (
        <div className="flex flex-col gap-1 mt-2 max-h-60 overflow-y-auto">
          {field.options.map(option => (
            <DropdownMenuItem key={option.value} onClick={() => handleAddFilter(field, operator, option.value)} className="cursor-pointer">
              {option.label}
            </DropdownMenuItem>
          ))}
        </div>
      );
    }
    if (field.type === "boolean") {
      return (
        <div className="flex flex-col gap-1 mt-2">
          <DropdownMenuItem onClick={() => handleAddFilter(field, operator, "true")} className="cursor-pointer">Да</DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleAddFilter(field, operator, "false")} className="cursor-pointer">Нет</DropdownMenuItem>
        </div>
      );
    }
    return (
      <div className="flex gap-2 mt-2 p-2">
        <Input
          type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
          placeholder="Значение..."
          value={pendingValue}
          onChange={e => setPendingValue(e.target.value)}
          className="h-8"
          onKeyDown={e => {
            if (e.key === "Enter" && pendingValue) {
              handleAddFilter(field, operator, pendingValue);
            }
          }}
        />
        <Button size="sm" onClick={() => { if (pendingValue) handleAddFilter(field, operator, pendingValue); }}>OK</Button>
      </div>
    );
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 whitespace-nowrap text-muted-foreground hover:text-foreground">
            <Filter className="h-3.5 w-3.5" />
            Фильтр
            <Plus className="h-3 w-3" />
            {customFilters.length > 0 && (
              <Badge className="h-4 min-w-4 px-1 text-[10px] font-semibold rounded-full bg-primary/20 text-primary">
                {customFilters.length}
              </Badge>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 p-2">
          {fields.map(field => (
            <DropdownMenuSub key={field.key}>
              <DropdownMenuSubTrigger className="rounded-lg">{field.label}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                {(OPERATORS[field.type] || OPERATORS.text).map(op => (
                  <DropdownMenuSub key={op.value}>
                    <DropdownMenuSubTrigger className="rounded-lg">{op.label}</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>{renderValueInput(field, op.value)}</DropdownMenuSubContent>
                  </DropdownMenuSub>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Active filter badges rendered inline */}
      {customFilters.map((filter, i) => {
        const realIndex = activeFilters.indexOf(filter);
        return (
          <Badge
            key={i}
            variant="secondary"
            className="gap-1 px-2 py-0.5 rounded-full text-xs cursor-pointer hover:bg-destructive/10 hover:text-destructive transition-colors"
            onClick={() => handleRemoveFilter(realIndex)}
          >
            {getFilterLabel(filter)}
            <X className="h-3 w-3 opacity-60" />
          </Badge>
        );
      })}
    </>
  );
}
