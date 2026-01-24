import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronRight, Package, Check, Minus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

interface Tariff {
  id: string;
  name: string;
}

interface Product {
  id: string;
  name: string;
  tariffs: Tariff[];
}

interface CompactAccessSelectorProps {
  selectedTariffIds: string[];
  onChange: (tariffIds: string[]) => void;
  products: Product[];
  className?: string;
}

type ProductState = "all" | "partial" | "none";

export function CompactAccessSelector({
  selectedTariffIds,
  onChange,
  products,
  className,
}: CompactAccessSelectorProps) {
  const [open, setOpen] = useState(false);
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);

  // Filter products with tariffs
  const productsWithTariffs = useMemo(
    () => products.filter((p) => p.tariffs.length > 0),
    [products]
  );

  // Get product selection state
  const getProductState = (product: Product): ProductState => {
    const selectedCount = product.tariffs.filter((t) =>
      selectedTariffIds.includes(t.id)
    ).length;
    if (selectedCount === 0) return "none";
    if (selectedCount === product.tariffs.length) return "all";
    return "partial";
  };

  // Toggle product (all tariffs)
  const toggleProduct = (product: Product) => {
    const state = getProductState(product);
    const productTariffIds = product.tariffs.map((t) => t.id);

    if (state === "all") {
      // Deselect all tariffs of this product
      onChange(selectedTariffIds.filter((id) => !productTariffIds.includes(id)));
    } else {
      // Select all tariffs of this product
      const newIds = [...selectedTariffIds];
      productTariffIds.forEach((id) => {
        if (!newIds.includes(id)) newIds.push(id);
      });
      onChange(newIds);
    }
  };

  // Toggle single tariff
  const toggleTariff = (tariffId: string) => {
    if (selectedTariffIds.includes(tariffId)) {
      onChange(selectedTariffIds.filter((id) => id !== tariffId));
    } else {
      onChange([...selectedTariffIds, tariffId]);
    }
  };

  // Get summary for display
  const getSummary = () => {
    if (selectedTariffIds.length === 0) {
      return "Доступ для всех";
    }

    const summaryParts: string[] = [];
    for (const product of productsWithTariffs) {
      const state = getProductState(product);
      if (state === "all") {
        summaryParts.push(`${product.name} (все)`);
      } else if (state === "partial") {
        const count = product.tariffs.filter((t) =>
          selectedTariffIds.includes(t.id)
        ).length;
        summaryParts.push(`${product.name} (${count})`);
      }
    }
    return summaryParts.length > 0 ? summaryParts.join(", ") : "Не выбрано";
  };

  // Get count of selected products
  const getSelectedProductsCount = () => {
    return productsWithTariffs.filter(
      (p) => getProductState(p) !== "none"
    ).length;
  };

  const ProductCheckIcon = ({ state }: { state: ProductState }) => {
    if (state === "all") return <Check className="h-4 w-4 text-primary" />;
    if (state === "partial") return <Minus className="h-4 w-4 text-primary" />;
    return null;
  };

  return (
    <div className={cn("space-y-2", className)}>
      <Label>Доступ к контенту</Label>
      <p className="text-xs text-muted-foreground mb-2">
        Если ничего не выбрано — доступ для всех пользователей
      </p>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between h-auto min-h-10 py-2"
          >
            <span className="text-left truncate flex-1 text-sm">
              {selectedTariffIds.length === 0 ? (
                <span className="text-muted-foreground">Выбрать продукты...</span>
              ) : (
                <span className="flex items-center gap-2">
                  <Package className="h-4 w-4 shrink-0" />
                  {getSelectedProductsCount()} продуктов
                </span>
              )}
            </span>
            <ChevronRight
              className={cn(
                "ml-2 h-4 w-4 shrink-0 transition-transform",
                open && "rotate-90"
              )}
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent 
          className="w-80 p-0 bg-background/95 backdrop-blur-xl border-border/50" 
          align="start"
          sideOffset={4}
        >
          <ScrollArea className="max-h-[300px]">
            <div className="py-1">
              {productsWithTariffs.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  Нет продуктов с тарифами
                </div>
              ) : (
                productsWithTariffs.map((product) => {
                  const state = getProductState(product);
                  const isExpanded = expandedProductId === product.id;

                  return (
                    <div key={product.id} className="border-b border-border/30 last:border-0">
                      {/* Product row */}
                      <div
                        className={cn(
                          "flex items-center gap-2 px-3 py-2.5 hover:bg-muted/50 cursor-pointer transition-colors",
                          state !== "none" && "bg-primary/5"
                        )}
                      >
                        {/* Checkbox for product */}
                        <Checkbox
                          checked={state === "all"}
                          onCheckedChange={() => toggleProduct(product)}
                          className={cn(
                            "shrink-0",
                            state === "partial" && "data-[state=unchecked]:bg-primary/20"
                          )}
                        />

                        {/* Product name - click to expand/collapse */}
                        <div
                          className="flex-1 flex items-center justify-between min-w-0"
                          onClick={() =>
                            setExpandedProductId(isExpanded ? null : product.id)
                          }
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm font-medium truncate">
                              {product.name}
                            </span>
                            {state === "partial" && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                {product.tariffs.filter((t) =>
                                  selectedTariffIds.includes(t.id)
                                ).length}
                                /{product.tariffs.length}
                              </Badge>
                            )}
                          </div>
                          <ChevronRight
                            className={cn(
                              "h-4 w-4 text-muted-foreground shrink-0 transition-transform",
                              isExpanded && "rotate-90"
                            )}
                          />
                        </div>
                      </div>

                      {/* Tariffs (expanded) */}
                      {isExpanded && (
                        <div className="bg-muted/30 border-t border-border/30">
                          {product.tariffs.map((tariff) => (
                            <label
                              key={tariff.id}
                              className="flex items-center gap-2 px-3 pl-9 py-2 hover:bg-muted/50 cursor-pointer"
                            >
                              <Checkbox
                                checked={selectedTariffIds.includes(tariff.id)}
                                onCheckedChange={() => toggleTariff(tariff.id)}
                              />
                              <span className="text-sm truncate">{tariff.name}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </ScrollArea>

          {/* Footer with clear action */}
          {selectedTariffIds.length > 0 && (
            <div className="border-t border-border/30 p-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground"
                onClick={() => onChange([])}
              >
                <X className="h-4 w-4 mr-1.5" />
                Очистить выбор
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {/* Selected summary badges */}
      {selectedTariffIds.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {productsWithTariffs
            .filter((p) => getProductState(p) !== "none")
            .slice(0, 3)
            .map((product) => {
              const state = getProductState(product);
              const count = product.tariffs.filter((t) =>
                selectedTariffIds.includes(t.id)
              ).length;

              return (
                <Badge
                  key={product.id}
                  variant="outline"
                  className="text-xs bg-muted/30"
                >
                  {product.name}
                  {state === "partial" && ` (${count})`}
                  {state === "all" && " ✓"}
                </Badge>
              );
            })}
          {productsWithTariffs.filter((p) => getProductState(p) !== "none").length >
            3 && (
            <Badge variant="secondary" className="text-xs">
              +
              {productsWithTariffs.filter((p) => getProductState(p) !== "none")
                .length - 3}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
