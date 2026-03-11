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
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Pencil, Trash2, Globe, ChevronRight, Copy, ExternalLink, Search, FileText, FolderTree, CornerDownRight, Link, Eye, EyeOff, Archive, CircleCheck, AlertTriangle } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useProductsV2, useCreateProductV2, useUpdateProductV2, useDeleteProductV2 } from "@/hooks/useProductsV2";
import { useProductRelationCounts } from "@/hooks/useProductRelations";
import { useBulkDeleteDryRun, useBulkDeleteExecute, useBulkStatusChange, type DryRunResult } from "@/hooks/useProductsBulkActions";
import { useNavigate } from "react-router-dom";
import { GlassCard } from "@/components/ui/GlassCard";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useTableSort } from "@/hooks/useTableSort";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useDragSelect } from "@/hooks/useDragSelect";
import { SelectionBox } from "@/components/admin/SelectionBox";
import { copyToClipboard, getProductPayUrl } from "@/utils/clipboardUtils";
import { useProductReadiness } from "@/hooks/useProductReadiness";
import { CopyableIdChip } from "@/components/ui/CopyableIdChip";

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
  name: string;
  description: string;
  status: string;
  primary_domain: string;
}

const defaultFormData: ProductFormData = {
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
  const { data: readinessMap } = useProductReadiness(
    products?.map((p: any) => ({ id: p.id, status: p.status || "active" }))
  );
  
  const createMutation = useCreateProductV2();
  const updateMutation = useUpdateProductV2();
  const deleteMutation = useDeleteProductV2();
  const bulkStatusMutation = useBulkStatusChange();
  const bulkDeleteDryRun = useBulkDeleteDryRun();
  const bulkDeleteExecute = useBulkDeleteExecute();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<string | null>(null);
  const [formData, setFormData] = useState<ProductFormData>(defaultFormData);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebouncedValue(searchQuery, 200);

  // Bulk delete dry-run dialog
  const [dryRunResults, setDryRunResults] = useState<DryRunResult[] | null>(null);
  const [showDryRunDialog, setShowDryRunDialog] = useState(false);

  const handleOpenDialog = (product?: any) => {
    if (product) {
      setEditingProduct(product.id);
      setFormData({
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
    if (!formData.name) {
      toast.error("Заполните название");
      return;
    }

    const payload: any = {
      name: formData.name,
      description: formData.description || null,
      status: formData.status,
      primary_domain: formData.primary_domain || null,
    };

    if (editingProduct) {
      // On update: don't touch code
      await updateMutation.mutateAsync({ id: editingProduct, ...payload });
      handleCloseDialog();
    } else {
      // On create: auto-generate code
      payload.code = 'prd_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
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
      (p.description as string | null)?.toLowerCase().includes(q) ||
      (p as any).primary_domain?.toLowerCase().includes(q)
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

  // Drag-select (Contacts-like)
  const {
    selectedIds,
    isDragging,
    selectionBox,
    registerItemRef,
    toggleSelection,
    handleRangeSelect,
    selectAll,
    clearSelection,
    handleMouseDown,
    selectedCount,
    hasSelection,
  } = useDragSelect({
    items: sortedData,
    getItemId: (item: any) => item.id,
  });

  // Bulk actions
  const handleBulkStatus = useCallback(async (status: string) => {
    const ids = Array.from(selectedIds);
    await bulkStatusMutation.mutateAsync({ ids, status });
    clearSelection();
  }, [selectedIds, bulkStatusMutation, clearSelection]);

  const handleBulkDeleteStart = useCallback(async () => {
    const ids = Array.from(selectedIds);
    const result = await bulkDeleteDryRun.mutateAsync(ids);
    setDryRunResults(result);
    setShowDryRunDialog(true);
  }, [selectedIds, bulkDeleteDryRun]);

  const handleBulkDeleteExecute = useCallback(async () => {
    if (!dryRunResults) return;
    const safeIds = dryRunResults.filter(r => r.can_delete).map(r => r.product_id);
    if (safeIds.length === 0) {
      toast.error("Нет продуктов, которые можно безопасно удалить");
      setShowDryRunDialog(false);
      return;
    }
    await bulkDeleteExecute.mutateAsync(safeIds);
    setShowDryRunDialog(false);
    setDryRunResults(null);
    clearSelection();
  }, [dryRunResults, bulkDeleteExecute, clearSelection]);

  const handleCopyLink = useCallback(() => {
    const ids = Array.from(selectedIds);
    if (ids.length === 1) {
      const readiness = readinessMap?.get(ids[0]);
      const url = getProductPayUrl(ids[0]);
      if (readiness && !readiness.isReady) {
        copyToClipboard(url, "Ссылка скопирована");
        toast.warning(`Продукт не готов к оплате: ${readiness.reasonLabel}. Ссылка скопирована, но покупатель увидит ошибку.`);
      } else {
        copyToClipboard(url, "Ссылка на оплату скопирована");
      }
    } else {
      const links = ids.map(id => getProductPayUrl(id)).join("\n");
      const notReadyProducts = ids
        .map(id => {
          const r = readinessMap?.get(id);
          const prod = products?.find((p: any) => p.id === id);
          return r && !r.isReady ? (prod as any)?.name || id : null;
        })
        .filter(Boolean);
      
      copyToClipboard(links, `Скопировано ${ids.length} ссылок`);
      if (notReadyProducts.length > 0) {
        const detail = notReadyProducts.length <= 3
          ? notReadyProducts.join(", ")
          : `${notReadyProducts.slice(0, 3).join(", ")} и ещё ${notReadyProducts.length - 3}`;
        toast.warning(`Скопировано ${ids.length} ссылок. Не готовы: ${notReadyProducts.length}.\n${detail}`);
      }
    }
  }, [selectedIds, readinessMap, products]);

  return (
    <AdminLayout>
      <div className="space-y-4" onMouseDown={handleMouseDown}>
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
                  <TableHead className="w-10">
                    <Checkbox
                      checked={selectedCount > 0 && selectedCount === sortedData.length}
                      onCheckedChange={(checked) => {
                        if (checked) selectAll();
                        else clearSelection();
                      }}
                    />
                  </TableHead>
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
                  const isSelected = selectedIds.has(product.id);
                  return (
                    <TableRow
                      key={product.id}
                      ref={(el) => registerItemRef(product.id, el)}
                      className={`cursor-pointer hover:bg-muted/50 ${isSelected ? "bg-primary/5" : ""}`}
                      data-state={isSelected ? "selected" : undefined}
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        if (target.closest("button, [role=checkbox], a")) return;
                        if (e.shiftKey) {
                          handleRangeSelect(product.id, true);
                        } else if (e.ctrlKey || e.metaKey) {
                          toggleSelection(product.id, true);
                        } else {
                          navigate(`/admin/products-v2/${product.id}`);
                        }
                      }}
                    >
                      <TableCell className="w-10">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleSelection(product.id, true)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-2">
                            {product.public_id && (
                              <CopyableIdChip value={product.public_id} />
                            )}
                            <span className="font-medium text-sm">{product.name}</span>
                          </div>
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
                          {(() => {
                            const readiness = readinessMap?.get(product.id);
                            const isReady = readiness?.isReady ?? true;
                            return (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => {
                                      e.stopPropagation();
                                      const url = getProductPayUrl(product.id);
                                      if (!isReady && readiness) {
                                        copyToClipboard(url, "Ссылка скопирована");
                                        toast.warning(`Продукт не готов к оплате: ${readiness.reasonLabel}. Ссылка скопирована, но покупатель увидит ошибку.`);
                                      } else {
                                        copyToClipboard(url, "Ссылка на оплату скопирована");
                                      }
                                    }}>
                                      <Link className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent className="flex items-center gap-1.5">
                                    {isReady ? (
                                      <>
                                        <CircleCheck className="h-3 w-3 text-green-600" />
                                        <span>Копировать ссылку на оплату</span>
                                      </>
                                    ) : (
                                      <>
                                        <AlertTriangle className="h-3 w-3 text-amber-500" />
                                        <span>{readiness?.reasonLabel || "Не готов к оплате"}</span>
                                      </>
                                    )}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            );
                          })()}
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => {
                                  e.stopPropagation();
                                  copyToClipboard(product.id, "UUID скопирован");
                                }}>
                                  <Copy className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {product.public_id ? `${product.public_id} — копировать UUID` : "Копировать UUID"}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
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

        {/* Selection box overlay */}
        {isDragging && selectionBox && (
          <SelectionBox
            startX={selectionBox.startX}
            startY={selectionBox.startY}
            endX={selectionBox.endX}
            endY={selectionBox.endY}
          />
        )}

        {/* Bulk Actions Bar */}
        {hasSelection && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4">
            <div className="bg-background border rounded-xl shadow-lg px-4 py-3 flex items-center gap-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                  {selectedCount}
                </div>
                <span className="text-muted-foreground">
                  продуктов выбрано из {sortedData.length}
                </span>
              </div>
              <div className="h-6 w-px bg-border" />
              {selectedCount < sortedData.length && (
                <Button variant="ghost" size="sm" onClick={selectAll} className="gap-2">
                  Выбрать все
                </Button>
              )}
              <Button variant="ghost" size="sm" className="gap-1.5 text-primary" onClick={() => handleBulkStatus("active")}>
                <Eye className="h-4 w-4" />
                Активные
              </Button>
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => handleBulkStatus("hidden")}>
                <EyeOff className="h-4 w-4" />
                Скрытые
              </Button>
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => handleBulkStatus("archived")}>
                <Archive className="h-4 w-4" />
                Архив
              </Button>
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={handleCopyLink}>
                <Link className="h-4 w-4" />
                Ссылка
              </Button>
              <Button variant="ghost" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={handleBulkDeleteStart}>
                <Trash2 className="h-4 w-4" />
                Удалить
              </Button>
              <div className="h-6 w-px bg-border" />
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={clearSelection}>
                <span className="text-xs">✕</span>
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editingProduct ? "Редактировать продукт" : "Новый продукт"}
              {editingProduct && (() => {
                const prod = products?.find((p: any) => p.id === editingProduct);
                return prod?.public_id ? <CopyableIdChip value={prod.public_id} /> : null;
              })()}
            </DialogTitle>
            <DialogDescription>
              {editingProduct
                ? "Измените данные продукта"
                : "Заполните данные продукта. После создания вы перейдёте к настройке тарифов и цен."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Название *</Label>
              <Input
                placeholder="Gorbova Club"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
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

      {/* Single Delete Confirmation */}
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

      {/* Bulk Delete Dry-Run Dialog */}
      <Dialog open={showDryRunDialog} onOpenChange={setShowDryRunDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Массовое удаление продуктов</DialogTitle>
            <DialogDescription>Результат проверки безопасности удаления</DialogDescription>
          </DialogHeader>
          {dryRunResults && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Badge variant="default" className="text-xs">
                  Можно удалить: {dryRunResults.filter(r => r.can_delete).length}
                </Badge>
                <Badge variant="destructive" className="text-xs">
                  Нельзя удалить: {dryRunResults.filter(r => !r.can_delete).length}
                </Badge>
              </div>
              {dryRunResults.filter(r => !r.can_delete).length > 0 && (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  <p className="text-xs font-medium text-muted-foreground">Причины блокировки:</p>
                  {dryRunResults.filter(r => !r.can_delete).map(r => {
                    const prod = products?.find((p: any) => p.id === r.product_id);
                    return (
                      <div key={r.product_id} className="text-xs border rounded p-2">
                        <span className="font-medium">{(prod as any)?.name || r.product_id}</span>
                        <span className="text-muted-foreground ml-1">— {r.reasons.join(", ")}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDryRunDialog(false)}>Отмена</Button>
            <Button
              variant="destructive"
              onClick={handleBulkDeleteExecute}
              disabled={bulkDeleteExecute.isPending || !dryRunResults?.some(r => r.can_delete)}
            >
              Удалить безопасные ({dryRunResults?.filter(r => r.can_delete).length || 0})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
