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
import { cn } from "@/lib/utils";

export interface FilterField {
  key: string;
  label: string;
  type: "text" | "select" | "number" | "date" | "boolean";
  options?: { value: string; label: string }[];
}

export interface ActiveFilter {
  field: string;
  operator: string;
  value: string;
}

export interface FilterPreset {
  id: string;
  label: string;
  filters: ActiveFilter[];
  count?: number;
}

interface QuickFiltersProps {
  presets: FilterPreset[];
  fields: FilterField[];
  activeFilters: ActiveFilter[];
  onFiltersChange: (filters: ActiveFilter[]) => void;
  activePreset: string;
  onPresetChange: (presetId: string) => void;
}

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

export function QuickFilters({
  presets,
  fields,
  activeFilters,
  onFiltersChange,
  activePreset,
  onPresetChange,
}: QuickFiltersProps) {
  const [pendingValue, setPendingValue] = useState("");

  const customFilters = useMemo(() => {
    const presetFilters = presets.find(p => p.id === activePreset)?.filters || [];
    return activeFilters.filter(
      af => !presetFilters.some(
        pf => pf.field === af.field && pf.operator === af.operator && pf.value === af.value
      )
    );
  }, [activeFilters, activePreset, presets]);

  const handlePresetClick = (presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    onPresetChange(presetId);
    onFiltersChange(preset?.filters || []);
  };

  const handleAddFilter = (field: FilterField, operator: string, value: string) => {
    const newFilter: ActiveFilter = { field: field.key, operator, value };
    onFiltersChange([...activeFilters, newFilter]);
    setPendingValue("");
  };

  const handleRemoveFilter = (index: number) => {
    const preset = presets.find(p => p.id === activePreset);
    const presetFiltersCount = preset?.filters.length || 0;
    
    if (index < presetFiltersCount) {
      onPresetChange("all");
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
        <Button
          size="sm"
          className="w-full mt-2"
          onClick={() => handleAddFilter(field, operator, "")}
        >
          Применить
        </Button>
      );
    }

    if (field.type === "select" && field.options) {
      return (
        <div className="flex flex-col gap-1 mt-2 max-h-60 overflow-y-auto">
          {field.options.map(option => (
            <DropdownMenuItem
              key={option.value}
              onClick={() => handleAddFilter(field, operator, option.value)}
              className="cursor-pointer"
            >
              {option.label}
            </DropdownMenuItem>
          ))}
        </div>
      );
    }

    if (field.type === "boolean") {
      return (
        <div className="flex flex-col gap-1 mt-2">
          <DropdownMenuItem 
            onClick={() => handleAddFilter(field, operator, "true")}
            className="cursor-pointer"
          >
            Да
          </DropdownMenuItem>
          <DropdownMenuItem 
            onClick={() => handleAddFilter(field, operator, "false")}
            className="cursor-pointer"
          >
            Нет
          </DropdownMenuItem>
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
        <Button
          size="sm"
          onClick={() => {
            if (pendingValue) {
              handleAddFilter(field, operator, pendingValue);
            }
          }}
        >
          OK
        </Button>
      </div>
    );
  };

  return (
    <div className="flex items-center gap-3 flex-wrap p-3 rounded-2xl bg-card/30 backdrop-blur-xl border border-border/30 shadow-[0_4px_24px_rgba(0,0,0,0.06)]">
      {/* Preset tabs with glass effect */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-background/50 backdrop-blur-sm border border-border/20">
        {presets.map(preset => {
          const isActive = activePreset === preset.id;
          return (
            <button
              key={preset.id}
              onClick={() => handlePresetClick(preset.id)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 whitespace-nowrap",
                isActive 
                  ? "bg-primary text-primary-foreground shadow-sm" 
                  : "text-muted-foreground hover:text-foreground hover:bg-background/80"
              )}
            >
              {preset.label}
              {preset.count !== undefined && preset.count > 0 && (
                <span className={cn(
                  "ml-1.5 px-1.5 py-0.5 text-xs rounded-full",
                  isActive
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : "bg-primary/10 text-primary"
                )}>
                  {preset.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Add filter button */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button 
            variant="outline" 
            size="sm"
            className="bg-background/50 backdrop-blur-sm border-border/30 hover:bg-background/80"
          >
            <Filter className="h-4 w-4 mr-1.5" />
            Фильтр
            <Plus className="h-3 w-3 ml-1" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent 
          align="start" 
          className="w-64 p-2 bg-popover/95 backdrop-blur-xl border border-border/50 shadow-lg rounded-xl"
        >
          {fields.map(field => (
            <DropdownMenuSub key={field.key}>
              <DropdownMenuSubTrigger className="rounded-lg">
                {field.label}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48 bg-popover/95 backdrop-blur-xl border border-border/50 rounded-xl">
                {(OPERATORS[field.type] || OPERATORS.text).map(op => (
                  <DropdownMenuSub key={op.value}>
                    <DropdownMenuSubTrigger className="rounded-lg">
                      {op.label}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="bg-popover/95 backdrop-blur-xl border border-border/50 rounded-xl">
                      {renderValueInput(field, op.value)}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Active filter badges */}
      {customFilters.map((filter, i) => {
        const realIndex = activeFilters.indexOf(filter);
        return (
          <Badge 
            key={i} 
            variant="secondary" 
            className="gap-1.5 px-3 py-1 rounded-full bg-background/60 backdrop-blur-sm border border-border/30 text-foreground hover:bg-destructive/10 hover:border-destructive/30 hover:text-destructive cursor-pointer transition-colors"
            onClick={() => handleRemoveFilter(realIndex)}
          >
            {getFilterLabel(filter)}
            <X className="h-3 w-3 opacity-60" />
          </Badge>
        );
      })}
    </div>
  );
}

export function applyFilters<T>(
  data: T[],
  filters: ActiveFilter[],
  getFieldValue: (item: T, fieldKey: string) => any
): T[] {
  if (filters.length === 0) return data;

  return data.filter(item => {
    return filters.every(filter => {
      const value = getFieldValue(item, filter.field);
      const filterValue = filter.value;

      // Special handling for status_account composite filter
      if (filter.field === "status_account") {
        const composite = value as { status: string; hasAccount: boolean } | undefined;
        if (!composite) return false;
        
        let match = false;
        switch (filterValue) {
          case "no_account":
            match = !composite.hasAccount;
            break;
          case "has_account":
            match = composite.hasAccount;
            break;
          case "active":
          case "archived":
          case "ghost":
            match = composite.status === filterValue;
            break;
          default:
            match = true;
        }
        
        return filter.operator === "not_equals" ? !match : match;
      }

      // Handle array values (for purchased_product, purchased_tariff, active_subscription)
      if (Array.isArray(value)) {
        switch (filter.operator) {
          case "equals":
            return value.includes(filterValue);
          case "not_equals":
            return !value.includes(filterValue);
          case "empty":
            return value.length === 0;
          case "not_empty":
            return value.length > 0;
          default:
            return value.includes(filterValue);
        }
      }

      switch (filter.operator) {
        case "contains":
          return String(value || "").toLowerCase().includes(filterValue.toLowerCase());
        case "equals":
          if (filter.field === "is_duplicate" || filter.field === "has_telegram" || filter.field === "is_trial") {
            return String(value) === filterValue;
          }
          return String(value || "").toLowerCase() === filterValue.toLowerCase();
        case "not_equals":
          return String(value || "").toLowerCase() !== filterValue.toLowerCase();
        case "gt":
          return Number(value) > Number(filterValue);
        case "lt":
          return Number(value) < Number(filterValue);
        case "gte":
          return Number(value) >= Number(filterValue);
        case "lte":
          return Number(value) <= Number(filterValue);
        case "empty":
          return value === null || value === undefined || value === "";
        case "not_empty":
          return value !== null && value !== undefined && value !== "";
        default:
          return true;
      }
    });
  });
}
