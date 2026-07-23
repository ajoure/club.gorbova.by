import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GlassCard } from "@/components/ui/GlassCard";
import { Plus, Trash2, ArrowUp, ArrowDown, Search } from "lucide-react";
import { toast } from "sonner";
import { useProductsV2 } from "@/hooks/useProductsV2";
import {
  useProductRelations,
  useCreateProductRelation,
  useDeleteProductRelation,
  useUpdateProductRelation,
  RELATION_TYPE_LABELS,
  RELATION_TYPES,
} from "@/hooks/useProductRelations";
import { OfferAddonsEditor } from "./OfferAddonsEditor";

const STATUS_LABELS: Record<string, string> = {
  active: "Активный",
  hidden: "Скрытый",
  archived: "Архивный",
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline"> = {
  active: "default",
  hidden: "outline",
  archived: "secondary",
};

interface ProductCompositionTabProps {
  productId: string;
}

export function ProductCompositionTab({ productId }: ProductCompositionTabProps) {
  const { data: relations, isLoading } = useProductRelations(productId);
  const { data: allProducts } = useProductsV2();
  const createRelation = useCreateProductRelation();
  const deleteRelation = useDeleteProductRelation();
  const updateRelation = useUpdateProductRelation();

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedChildId, setSelectedChildId] = useState("");
  const [selectedRelationType, setSelectedRelationType] = useState("includes");
  const [searchQuery, setSearchQuery] = useState("");

  // Products available to add (exclude self and already linked)
  const availableProducts = useMemo(() => {
    if (!allProducts) return [];
    const linkedIds = new Set((relations || []).map(r => r.child_product_id));
    linkedIds.add(productId);
    return allProducts.filter(p => !linkedIds.has(p.id));
  }, [allProducts, relations, productId]);

  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return availableProducts;
    const q = searchQuery.toLowerCase();
    return availableProducts.filter(p => p.name?.toLowerCase().includes(q));
  }, [availableProducts, searchQuery]);

  const handleAdd = async () => {
    if (!selectedChildId) {
      toast.error("Выберите продукт");
      return;
    }
    const maxOrder = Math.max(0, ...(relations || []).map(r => r.sort_order));
    await createRelation.mutateAsync({
      parent_product_id: productId,
      child_product_id: selectedChildId,
      relation_type: selectedRelationType,
      sort_order: maxOrder + 1,
    });
    setAddDialogOpen(false);
    setSelectedChildId("");
    setSearchQuery("");
  };

  const handleMoveUp = async (relation: any, index: number) => {
    if (index === 0 || !relations) return;
    const prev = relations[index - 1];
    await Promise.all([
      updateRelation.mutateAsync({ id: relation.id, sort_order: prev.sort_order }),
      updateRelation.mutateAsync({ id: prev.id, sort_order: relation.sort_order }),
    ]);
  };

  const handleMoveDown = async (relation: any, index: number) => {
    if (!relations || index >= relations.length - 1) return;
    const next = relations[index + 1];
    await Promise.all([
      updateRelation.mutateAsync({ id: relation.id, sort_order: next.sort_order }),
      updateRelation.mutateAsync({ id: next.id, sort_order: relation.sort_order }),
    ]);
  };

  return (
    <div className="space-y-4">
      <OfferAddonsEditor productId={productId} />
      <div className="border-t pt-4" />
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-semibold">Состав продукта</h2>
          <p className="text-sm text-muted-foreground">
            Дочерние продукты, модули и бандлы
          </p>
        </div>
        <Button onClick={() => setAddDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Добавить
        </Button>
      </div>

      {isLoading ? (
        <GlassCard className="py-8 text-center text-muted-foreground text-sm">
          Загрузка...
        </GlassCard>
      ) : !relations?.length ? (
        <GlassCard className="py-12 text-center text-muted-foreground">
          Нет связанных продуктов. Добавьте дочерние продукты или модули.
        </GlassCard>
      ) : (
        <div className="space-y-2">
          {relations.map((rel, index) => (
            <GlassCard key={rel.id} className="p-3">
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    disabled={index === 0}
                    onClick={() => handleMoveUp(rel, index)}
                  >
                    <ArrowUp className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    disabled={index === relations.length - 1}
                    onClick={() => handleMoveDown(rel, index)}
                  >
                    <ArrowDown className="h-3 w-3" />
                  </Button>
                </div>
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-sm">
                    {rel.child_product?.name || rel.child_product_id}
                  </span>
                </div>
                <Badge variant="outline" className="text-[11px]">
                  {RELATION_TYPE_LABELS[rel.relation_type] || rel.relation_type}
                </Badge>
                {rel.child_product?.status && (
                  <Badge
                    variant={STATUS_VARIANTS[rel.child_product.status] || "outline"}
                    className="text-[11px]"
                  >
                    {STATUS_LABELS[rel.child_product.status] || rel.child_product.status}
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => deleteRelation.mutate(rel.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </GlassCard>
          ))}
        </div>
      )}

      {/* Add Child Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Добавить дочерний продукт</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Тип связи</Label>
              <Select value={selectedRelationType} onValueChange={setSelectedRelationType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RELATION_TYPES.map(type => (
                    <SelectItem key={type} value={type}>
                      {RELATION_TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Продукт</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Поиск..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8"
                />
              </div>
              <div className="max-h-48 overflow-y-auto border rounded-md">
                {filteredProducts.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground text-center">
                    Нет доступных продуктов
                  </div>
                ) : (
                  filteredProducts.map(p => (
                    <button
                      key={p.id}
                      onClick={() => setSelectedChildId(p.id)}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 flex items-center justify-between ${
                        selectedChildId === p.id ? "bg-primary/10 text-primary" : ""
                      }`}
                    >
                      <span>{p.name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {STATUS_LABELS[(p as any).status] || (p as any).status}
                      </Badge>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>Отмена</Button>
            <Button onClick={handleAdd} disabled={!selectedChildId || createRelation.isPending}>
              Добавить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
