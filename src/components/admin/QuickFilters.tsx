import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
import { Plus, X } from "lucide-react";

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
  const [pendingFilter, setPendingFilter] = useState<{
    field: FilterField;
    operator: string;
  } | null>(null);
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
    setPendingFilter(null);
    setPendingValue("");
  };

  const handleRemoveFilter = (index: number) => {
    const preset = presets.find(p => p.id === activePreset);
    const presetFiltersCount = preset?.filters.length || 0;
    
    if (index < presetFiltersCount) {
      // Removing a preset filter - switch to "all" preset
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
        <div className="flex flex-col gap-1 mt-2">
          {field.options.map(option => (
            <DropdownMenuItem
              key={option.value}
              onClick={() => handleAddFilter(field, operator, option.value)}
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
          <DropdownMenuItem onClick={() => handleAddFilter(field, operator, "true")}>
            Да
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleAddFilter(field, operator, "false")}>
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
    <div className="flex items-center gap-2 flex-wrap">
      <ToggleGroup 
        type="single" 
        value={activePreset}
        onValueChange={(value) => value && handlePresetClick(value)}
        className="justify-start"
      >
        {presets.map(preset => (
          <ToggleGroupItem
            key={preset.id}
            value={preset.id}
            className="whitespace-nowrap data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
          >
            {preset.label}
            {preset.count !== undefined && preset.count > 0 && (
              <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-xs">
                {preset.count}
              </Badge>
            )}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <Separator orientation="vertical" className="h-6 hidden sm:block" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Plus className="h-4 w-4 mr-1" />
            Фильтр
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {fields.map(field => (
            <DropdownMenuSub key={field.key}>
              <DropdownMenuSubTrigger>{field.label}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                {(OPERATORS[field.type] || OPERATORS.text).map(op => (
                  <DropdownMenuSub key={op.value}>
                    <DropdownMenuSubTrigger>{op.label}</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {renderValueInput(field, op.value)}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {customFilters.map((filter, i) => {
        const realIndex = activeFilters.indexOf(filter);
        return (
          <Badge 
            key={i} 
            variant="secondary" 
            className="gap-1 cursor-pointer hover:bg-destructive/20"
            onClick={() => handleRemoveFilter(realIndex)}
          >
            {getFilterLabel(filter)}
            <X className="h-3 w-3" />
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
        
        // Calculate match based on filterValue
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
        
        // Apply operator
        return filter.operator === "not_equals" ? !match : match;
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
