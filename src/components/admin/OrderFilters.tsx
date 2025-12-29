import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { CalendarIcon, X, Filter, RotateCcw } from "lucide-react";

export interface OrderFilters {
  statuses: string[];
  dateFrom: Date | undefined;
  dateTo: Date | undefined;
  email: string;
  productId: string;
  amountMin: string;
  amountMax: string;
  paymentMethod: string;
}

interface Product {
  id: string;
  name: string;
}

interface OrderFiltersProps {
  filters: OrderFilters;
  onFiltersChange: (filters: OrderFilters) => void;
  products: Product[];
  totalCount: number;
}

const statusOptions = [
  { value: "pending", label: "Ожидает" },
  { value: "processing", label: "Обработка" },
  { value: "completed", label: "Оплачен" },
  { value: "failed", label: "Ошибка" },
  { value: "refunded", label: "Возврат" },
];

const paymentMethodOptions = [
  { value: "card", label: "Карта" },
  { value: "erip", label: "ЕРИП" },
  { value: "apple_pay", label: "Apple Pay" },
  { value: "samsung_pay", label: "Samsung Pay" },
  { value: "google_pay", label: "Google Pay" },
];

export function OrderFilters({ filters, onFiltersChange, products, totalCount }: OrderFiltersProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const updateFilter = <K extends keyof OrderFilters>(key: K, value: OrderFilters[K]) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const toggleStatus = (status: string) => {
    const newStatuses = filters.statuses.includes(status)
      ? filters.statuses.filter((s) => s !== status)
      : [...filters.statuses, status];
    updateFilter("statuses", newStatuses);
  };

  const resetFilters = () => {
    onFiltersChange({
      statuses: [],
      dateFrom: undefined,
      dateTo: undefined,
      email: "",
      productId: "",
      amountMin: "",
      amountMax: "",
      paymentMethod: "",
    });
  };

  const hasActiveFilters = 
    filters.statuses.length > 0 ||
    filters.dateFrom ||
    filters.dateTo ||
    filters.email ||
    filters.productId ||
    filters.amountMin ||
    filters.amountMax ||
    filters.paymentMethod;

  return (
    <div className="space-y-4 mb-6">
      {/* Header with toggle and count */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="gap-2"
          >
            <Filter className="h-4 w-4" />
            Фильтры
            {hasActiveFilters && (
              <Badge variant="secondary" className="ml-1">
                {[
                  filters.statuses.length,
                  filters.dateFrom || filters.dateTo ? 1 : 0,
                  filters.email ? 1 : 0,
                  filters.productId ? 1 : 0,
                  filters.amountMin || filters.amountMax ? 1 : 0,
                  filters.paymentMethod ? 1 : 0,
                ].reduce((a, b) => a + (b > 0 ? 1 : 0), 0)}
              </Badge>
            )}
          </Button>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-2 text-muted-foreground">
              <RotateCcw className="h-4 w-4" />
              Сбросить
            </Button>
          )}
        </div>
        <div className="text-sm text-muted-foreground">
          Найдено: <span className="font-medium text-foreground">{totalCount}</span> заказов
        </div>
      </div>

      {/* Filter panels */}
      {isExpanded && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-4 bg-muted/30 rounded-lg border">
          {/* Status filter */}
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">Статус</Label>
            <div className="flex flex-wrap gap-1.5">
              {statusOptions.map((status) => (
                <Badge
                  key={status.value}
                  variant={filters.statuses.includes(status.value) ? "default" : "outline"}
                  className="cursor-pointer hover:bg-primary/80 transition-colors"
                  onClick={() => toggleStatus(status.value)}
                >
                  {status.label}
                </Badge>
              ))}
            </div>
          </div>

          {/* Date range filter */}
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">Период</Label>
            <div className="flex gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "justify-start text-left font-normal flex-1",
                      !filters.dateFrom && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {filters.dateFrom ? format(filters.dateFrom, "dd.MM.yy") : "От"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={filters.dateFrom}
                    onSelect={(date) => updateFilter("dateFrom", date)}
                    initialFocus
                    locale={ru}
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "justify-start text-left font-normal flex-1",
                      !filters.dateTo && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {filters.dateTo ? format(filters.dateTo, "dd.MM.yy") : "До"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={filters.dateTo}
                    onSelect={(date) => updateFilter("dateTo", date)}
                    initialFocus
                    locale={ru}
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Email filter */}
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">Email клиента</Label>
            <Input
              placeholder="email@example.com"
              value={filters.email}
              onChange={(e) => updateFilter("email", e.target.value)}
              className="h-9"
            />
          </div>

          {/* Product filter */}
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">Продукт</Label>
            <Select
              value={filters.productId}
              onValueChange={(value) => updateFilter("productId", value === "all" ? "" : value)}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Все продукты" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все продукты</SelectItem>
                {products.map((product) => (
                  <SelectItem key={product.id} value={product.id}>
                    {product.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Amount range filter */}
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">Сумма (BYN)</Label>
            <div className="flex gap-2">
              <Input
                placeholder="От"
                type="number"
                value={filters.amountMin}
                onChange={(e) => updateFilter("amountMin", e.target.value)}
                className="h-9"
              />
              <Input
                placeholder="До"
                type="number"
                value={filters.amountMax}
                onChange={(e) => updateFilter("amountMax", e.target.value)}
                className="h-9"
              />
            </div>
          </div>

          {/* Payment method filter */}
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">Способ оплаты</Label>
            <Select
              value={filters.paymentMethod}
              onValueChange={(value) => updateFilter("paymentMethod", value === "all" ? "" : value)}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Все способы" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все способы</SelectItem>
                {paymentMethodOptions.map((method) => (
                  <SelectItem key={method.value} value={method.value}>
                    {method.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}
