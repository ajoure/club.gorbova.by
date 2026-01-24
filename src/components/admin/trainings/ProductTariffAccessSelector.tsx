import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Package, ChevronDown, Info } from "lucide-react";

interface Tariff {
  id: string;
  name: string;
}

interface Product {
  id: string;
  name: string;
  tariffs: Tariff[];
}

interface ProductTariffAccessSelectorProps {
  selectedTariffIds: string[];
  onChange: (tariffIds: string[]) => void;
  products: Product[];
  className?: string;
}

type ProductState = "all" | "partial" | "none";

export function ProductTariffAccessSelector({
  selectedTariffIds,
  onChange,
  products,
  className,
}: ProductTariffAccessSelectorProps) {
  // Track which products are expanded
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(() => {
    // Initially expand products that have selected tariffs
    const expanded = new Set<string>();
    products.forEach(product => {
      const hasSel = product.tariffs.some(t => selectedTariffIds.includes(t.id));
      if (hasSel) expanded.add(product.id);
    });
    return expanded;
  });

  // Get state for a product: all/partial/none
  const getProductState = (product: Product): ProductState => {
    if (product.tariffs.length === 0) return "none";
    const selectedCount = product.tariffs.filter(t =>
      selectedTariffIds.includes(t.id)
    ).length;
    if (selectedCount === 0) return "none";
    if (selectedCount === product.tariffs.length) return "all";
    return "partial";
  };

  // Handle quick selector change for a product
  const handleProductStateChange = (product: Product, state: ProductState) => {
    const productTariffIds = product.tariffs.map(t => t.id);
    let newSelected: string[];

    if (state === "all") {
      // Add all product's tariffs
      newSelected = [...new Set([...selectedTariffIds, ...productTariffIds])];
    } else if (state === "none") {
      // Remove all product's tariffs
      newSelected = selectedTariffIds.filter(id => !productTariffIds.includes(id));
    } else {
      // partial - keep as is, just expand
      newSelected = selectedTariffIds;
    }

    onChange(newSelected);

    // Expand product when selecting
    if (state !== "none") {
      setExpandedProducts(prev => new Set(prev).add(product.id));
    }
  };

  // Toggle individual tariff
  const toggleTariff = (tariffId: string) => {
    if (selectedTariffIds.includes(tariffId)) {
      onChange(selectedTariffIds.filter(id => id !== tariffId));
    } else {
      onChange([...selectedTariffIds, tariffId]);
    }
  };

  // Toggle product expansion
  const toggleExpanded = (productId: string) => {
    setExpandedProducts(prev => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  };

  // Filter products with tariffs
  const productsWithTariffs = useMemo(
    () => products.filter(p => p.tariffs.length > 0),
    [products]
  );

  if (productsWithTariffs.length === 0) {
    return (
      <div className={cn("space-y-2", className)}>
        <Label>Доступ к контенту</Label>
        <p className="text-sm text-muted-foreground">
          Нет доступных продуктов с тарифами
        </p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div>
        <Label className="text-sm font-medium">Доступ к контенту</Label>
        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
          <Info className="h-3 w-3" />
          Если ничего не выбрано — доступ для всех
        </p>
      </div>

      {/* Products accordion */}
      <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1 -mr-1">
        {productsWithTariffs.map(product => {
          const state = getProductState(product);
          const isExpanded = expandedProducts.has(product.id);
          const selectedCount = product.tariffs.filter(t =>
            selectedTariffIds.includes(t.id)
          ).length;

          return (
            <Collapsible
              key={product.id}
              open={isExpanded}
              onOpenChange={() => toggleExpanded(product.id)}
            >
              <div className="rounded-lg border border-border/50 bg-muted/20 backdrop-blur-sm overflow-hidden">
                {/* Product header */}
                <div className="flex items-center justify-between gap-2 p-2.5 sm:p-3">
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-2 min-h-[44px] flex-1 text-left hover:bg-muted/30 -m-2.5 sm:-m-3 p-2.5 sm:p-3 rounded-lg transition-colors"
                    >
                      <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="text-sm font-medium truncate flex-1">
                        {product.name}
                      </span>
                      {selectedCount > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {selectedCount}/{product.tariffs.length}
                        </span>
                      )}
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 text-muted-foreground transition-transform duration-200",
                          isExpanded && "rotate-180"
                        )}
                      />
                    </button>
                  </CollapsibleTrigger>

                  {/* Quick selector */}
                  <Select
                    value={state}
                    onValueChange={(val) => handleProductStateChange(product, val as ProductState)}
                  >
                    <SelectTrigger 
                      className="h-8 w-24 text-xs shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все</SelectItem>
                      <SelectItem value="partial">Выборочно</SelectItem>
                      <SelectItem value="none">Нет</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Tariffs list */}
                <CollapsibleContent>
                  <div className="px-3 pb-3 pt-1 grid gap-1 grid-cols-1 sm:grid-cols-2">
                    {product.tariffs.map(tariff => (
                      <label
                        key={tariff.id}
                        className={cn(
                          "flex items-center gap-2.5 p-2.5 rounded-md cursor-pointer",
                          "min-h-[44px] transition-colors",
                          "hover:bg-muted/40",
                          selectedTariffIds.includes(tariff.id) && "bg-primary/5"
                        )}
                      >
                        <Checkbox
                          checked={selectedTariffIds.includes(tariff.id)}
                          onCheckedChange={() => toggleTariff(tariff.id)}
                          className="shrink-0"
                        />
                        <span className="text-sm leading-tight">{tariff.name}</span>
                      </label>
                    ))}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
}
