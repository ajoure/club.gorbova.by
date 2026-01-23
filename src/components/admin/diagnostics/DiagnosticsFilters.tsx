import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import type { DiagnosticsFilters as FiltersType } from "@/hooks/usePaymentDiagnostics";
import { ERROR_CATEGORY_LABELS } from "@/hooks/usePaymentDiagnostics";

interface DiagnosticsFiltersProps {
  filters: FiltersType;
  onFiltersChange: (filters: FiltersType) => void;
  filterOptions: {
    brands: string[];
    banks: string[];
    issuerCountries: string[];
    clientCountries: string[];
  };
}

export function DiagnosticsFilters({
  filters,
  onFiltersChange,
  filterOptions,
}: DiagnosticsFiltersProps) {
  const updateFilter = <K extends keyof FiltersType>(key: K, value: FiltersType[K]) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const resetFilters = () => {
    onFiltersChange({
      from: filters.from,
      to: filters.to,
    });
  };

  const hasActiveFilters =
    filters.brand ||
    filters.issuerBank ||
    filters.issuerCountry ||
    filters.clientCountry ||
    filters.errorCategory ||
    (filters.transactionType && filters.transactionType !== "all") ||
    filters.has3DS !== null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {/* Brand filter */}
        <Select
          value={filters.brand || "all"}
          onValueChange={(value) => updateFilter("brand", value === "all" ? undefined : value)}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Бренд" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все бренды</SelectItem>
            {filterOptions.brands.map((brand) => (
              <SelectItem key={brand} value={brand}>
                {brand}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Issuer Bank filter */}
        <Select
          value={filters.issuerBank || "all"}
          onValueChange={(value) => updateFilter("issuerBank", value === "all" ? undefined : value)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Банк-эмитент" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все банки</SelectItem>
            {filterOptions.banks.map((bank) => (
              <SelectItem key={bank} value={bank}>
                {bank}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Issuer Country filter */}
        <Select
          value={filters.issuerCountry || "all"}
          onValueChange={(value) =>
            updateFilter("issuerCountry", value === "all" ? undefined : value)
          }
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Страна банка" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все страны</SelectItem>
            {filterOptions.issuerCountries.map((country) => (
              <SelectItem key={country} value={country}>
                {country}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Client Country filter */}
        <Select
          value={filters.clientCountry || "all"}
          onValueChange={(value) =>
            updateFilter("clientCountry", value === "all" ? undefined : value)
          }
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Страна клиента" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все страны</SelectItem>
            {filterOptions.clientCountries.map((country) => (
              <SelectItem key={country} value={country}>
                {country}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Error Category filter */}
        <Select
          value={filters.errorCategory || "all"}
          onValueChange={(value) =>
            updateFilter("errorCategory", value === "all" ? undefined : value)
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Тип ошибки" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все ошибки</SelectItem>
            {Object.entries(ERROR_CATEGORY_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* 3DS filter */}
        <Select
          value={filters.has3DS === null || filters.has3DS === undefined ? "all" : filters.has3DS ? "yes" : "no"}
          onValueChange={(value) =>
            updateFilter("has3DS", value === "all" ? null : value === "yes")
          }
        >
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="3DS" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="yes">С 3DS</SelectItem>
            <SelectItem value="no">Без 3DS</SelectItem>
          </SelectContent>
        </Select>

        {/* Reset button */}
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1">
            <X className="h-4 w-4" />
            Сбросить
          </Button>
        )}
      </div>
    </div>
  );
}
