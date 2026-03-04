import { useState, useMemo, useCallback } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, Globe, ChevronRight, Copy, ExternalLink, Search, FileText, FolderTree, CornerDownRight } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useProductsV2, useCreateProductV2, useUpdateProductV2, useDeleteProductV2 } from "@/hooks/useProductsV2";
import { useProductRelationCounts } from "@/hooks/useProductRelations";
import { useNavigate } from "react-router-dom";
import { GlassCard } from "@/components/ui/GlassCard";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useTableSort } from "@/hooks/useTableSort";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

const STATUS_LABELS: Record<string, string> = {
  active: "Активный",
  hidden: "Скрытый",
  archived: "Архивный",
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  hidden: "outline",
  archived: "secondary",
};

interface ProductFormData {
  code: string;
  name: string;
  description: string;
  status: string;
  primary_domain: string;
}

const defaultFormData: ProductFormData = {
  code: "",
  name: "",
  description: "",
  status: "active",
  primary_domain: "",
};

export default function AdminProductsV2() {
  const navigate = useNavigate();
  const { isSuperAdmin, loading: permLoading } = usePermissions();
  const { data: products, isLoading } = useProductsV2();
  const { data: relationCounts } = useProductRelationCounts();
  
  const createMutation = useCreateProductV2();
  const updateMutation = useUpdateProductV2();
  const deleteMutation = useDeleteProductV2();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<string | null>(null);
  const [formData, setFormData] = useState<ProductFormData>(defaultFormData);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebouncedValue(searchQuery, 200);

  const handleOpenDialog = (product?: any) => {
    if (product) {
      setEditingProduct(product.id);
      setFormData({
        code: product.code,
        name: product.name,
        description: product.description || "",
        status: product.status || "active",
        primary_domain: product.primary_domain || "",
      });
    } else {
      setEditingProduct(null);
      setFormData(defaultFormData);
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingProduct(null);
    setFormData(defaultFormData);
  };

  const handleSubmit = async () => {
    if (!formData.code || !formData.name) {
      toast.error("Заполните код и название");
      return;
    }

    const payload: any = {
      code: formData.code,
      name: formData.name,
      description: formData.description || null,
      status: formData.status,
      primary_domain: formData.primary_domain || null,
    };

    if (editingProduct) {
      await updateMutation.mutateAsync({ id: editingProduct, ...payload });
      handleCloseDialog();
    } else {
      const newProduct = await createMutation.mutateAsync(payload);
      handleCloseDialog();
      if (newProduct?.id) {
        navigate(`/admin/products-v2/${newProduct.id}`);
        toast.info("Теперь добавьте тарифы для продукта");
      }
    }
  };

  const handleDelete = async () => {
    if (deleteConfirmId) {
      await deleteMutation.mutateAsync(deleteConfirmId);
      setDeleteConfirmId(null);
    }
  };

  const copyProductId = (id: string) => {
    navigator.clipboard.writeText(id);
    toast.success("ID скопирован");
  };

  // Counts
  const statusCounts = useMemo(() => {
    const counts = { active: 0, hidden: 0, archived: 0, with_club: 0 };
    products?.forEach(p => {
      const s = (p as any).status || "active";
      if (s in counts) counts[s as keyof typeof counts]++;
      if (p.telegram_club_id) counts.with_club++;
    });
    return counts;
  }, [products]);

  // Pill-filter tabs
  const [activeTab, setActiveTab] = useState("all");

  const productTabs = useMemo(() => [
    { id: "all", label: "Все", count: products?.length || 0 },
    { id: "active", label: "Активные", count: statusCounts.active },
    { id: "hidden", label: "Скрытые", count: statusCounts.hidden },
    { id: "archived", label: "Архивные", count: statusCounts.archived },
    { id: "with_club", label: "С клубом", count: statusCounts.with_club },
  ], [products?.length, statusCounts]);

  // Filter by tab
  const tabFiltered = useMemo(() => {
    if (!products) return [];
    if (activeTab === "active") return products.filter(p => (p as any).status === "active");
    if (activeTab === "hidden") return products.filter(p => (p as any).status === "hidden");
    if (activeTab === "archived") return products.filter(p => (p as any).status === "archived");
    if (activeTab === "with_club") return products.filter(p => p.telegram_club_id);
    return products;
  }, [products, activeTab]);

  // Filter by search
  const searchFiltered = useMemo(() => {
    if (!debouncedSearch.trim()) return tabFiltered;
    const q = debouncedSearch.toLowerCase();
    return tabFiltered.filter(p =>
      p.name?.toLowerCase().includes(q) ||
      p.code?.toLowerCase().includes(q) ||
      (p.description as string | null)?.toLowerCase().includes(q)
    );
  }, [tabFiltered, debouncedSearch]);

  // Sort
  const { sortedData, sortKey, sortDirection, handleSort } = useTableSort({
    data: searchFiltered,
    getFieldValue: (item: any, key: string) => {
      switch (key) {
        case "name": return item.name;
        case "domain": return item.primary_domain || "";
        case "status": return STATUS_LABELS[item.status] || item.status;
        default: return (item as any)[key];
      }
    },
  });

  return (
    <AdminLayout>
      <div className="space-y-4">
        {/* Pill-style filter tabs */}
        <div className="px-1 pt-1 pb-1.5 shrink-0">
          <div className="inline-flex p-0.5 rounded-full bg-muted/40 backdrop-blur-md border border-border/20 overflow-x-auto max-w-full scrollbar-none">
            {productTabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 whitespace-nowrap ${
                    isActive
                      ? "bg-primary/10 text-primary shadow-none"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span>{tab.label}</span>
                  {tab.count > 0 && (
                    <span className={`text-[10px] font-semibold ${isActive ? "text-primary" : "text-muted-foreground"}`}>
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Search + Actions row */}
        <div className="flex items-center gap-3 px-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Поиск по названию..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-xs"
            />
          </div>
          {!permLoading && isSuperAdmin() && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => navigate("/admin/products-v2/docs")}
                  >
                    <FileText className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Документация раздела</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <Button size="sm" className="h-8" onClick={() => handleOpenDialog()}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Добавить продукт
          </Button>
        </div>

        {/* Flat products table */}
        <GlassCard className="p-0 overflow-hidden">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Загрузка...</div>
          ) : !products?.length ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              Нет продуктов. Создайте первый продукт.
            </div>
          ) : searchFiltered.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              Ничего не найдено по запросу «{debouncedSearch}»
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead sortKey="name" currentSortKey={sortKey} currentSortDirection={sortDirection} onSort={handleSort}>
                    Продукт
                  </SortableTableHead>
                  <SortableTableHead sortKey="domain" currentSortKey={sortKey} currentSortDirection={sortDirection} onSort={handleSort}>
                    Сайт
                  </SortableTableHead>
                  <SortableTableHead sortKey="status" currentSortKey={sortKey} currentSortDirection={sortDirection} onSort={handleSort}>
                    Статус
                  </SortableTableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedData.map((product: any) => {
                  const isParent = relationCounts?.parentIds?.has(product.id);
                  const isChild = relationCounts?.childIds?.has(product.id);
                  return (
                    <TableRow
                      key={product.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate(`/admin/products-v2/${product.id}`)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{product.name}</span>
                          {isParent && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <FolderTree className="h-3.5 w-3.5 text-primary/60" />
                                </TooltipTrigger>
                                <TooltipContent>Содержит дочерние продукты</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          {isChild && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <CornerDownRight className="h-3.5 w-3.5 text-muted-foreground" />
                                </TooltipTrigger>
                                <TooltipContent>Входит в состав другого продукта</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {product.primary_domain ? (
                          <div className="flex items-center gap-1.5">
                            <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-xs">{product.primary_domain}</span>
                            <a
                              href={`https://${product.primary_domain}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANTS[product.status] || "outline"} className="text-[11px]">
                          {STATUS_LABELS[product.status] || product.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); copyProductId(product.id); }}>
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); handleOpenDialog(product); }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(product.id); }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-1" />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </GlassCard>
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingProduct ? "Редактировать продукт" : "Новый продукт"}
            </DialogTitle>
            <DialogDescription>
              {editingProduct
                ? "Измените данные продукта"
                : "Заполните данные продукта. После создания вы перейдёте к настройке тарифов и цен."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Код *</Label>
                <Input
                  placeholder="gorbova_club"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Название *</Label>
                <Input
                  placeholder="Gorbova Club"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Статус</Label>
              <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Активный</SelectItem>
                  <SelectItem value="hidden">Скрытый</SelectItem>
                  <SelectItem value="archived">Архивный</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>URL сайта</Label>
              <Input
                placeholder="club.gorbova.by"
                value={formData.primary_domain}
                onChange={(e) => setFormData({ ...formData, primary_domain: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">Где продаётся продукт (опционально)</p>
            </div>

            <div className="space-y-2">
              <Label>Описание</Label>
              <Textarea
                placeholder="Описание продукта..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog}>Отмена</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
              {editingProduct ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить продукт?</DialogTitle>
            <DialogDescription>Это действие нельзя отменить. Все связанные тарифы и данные будут удалены.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>Отмена</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteMutation.isPending}>Удалить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
