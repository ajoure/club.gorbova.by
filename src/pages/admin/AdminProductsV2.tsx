import { useState, useMemo, useCallback } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Pencil, Trash2, Globe, ChevronRight, Copy, ExternalLink, Search, FileText, FolderTree, CornerDownRight, Link, Eye, EyeOff, Archive, CircleCheck, AlertTriangle } from "lucide-react";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useProductsV2, useCreateProductV2, useUpdateProductV2, useDeleteProductV2 } from "@/hooks/useProductsV2";
import { useProductRelationCounts } from "@/hooks/useProductRelations";
import { useBulkDeleteDryRun, useBulkDeleteExecute, useBulkStatusChange, type DryRunResult } from "@/hooks/useProductsBulkActions";
import { useNavigate } from "react-router-dom";
import { GlassCard } from "@/components/ui/GlassCard";
import { useTableSort } from "@/hooks/useTableSort";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useDragSelect } from "@/hooks/useDragSelect";
import { SelectionBox } from "@/components/admin/SelectionBox";
import { copyToClipboard, getProductPayUrl } from "@/utils/clipboardUtils";
import { useProductReadiness } from "@/hooks/useProductReadiness";
import { CopyableIdChip } from "@/components/ui/CopyableIdChip";
import { cn } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { SortPill } from "@/components/admin/SortPill";
import { getStatusBadgeClass } from "@/utils/badgeUtils";
import type { StatusBadgeKind } from "@/utils/badgeUtils";
import { supabase } from "@/integrations/supabase/client";
import {
  assertProductPageSlugAvailable,
  saveProductPageAddress,
} from "@/services/sitePages/ProductSitePageAdminService";
import {
  getProductPageUrl,
  normalizeProductPageSlug,
  suggestProductPageSlug,
  validateProductPageAddress,
} from "@/lib/productPageAddress";

const STATUS_LABELS: Record<string, string> = {
  active: "Активный",
  hidden: "Скрытый",
  archived: "Архивный",
};

interface ProductFormData {
  name: string;
  description: string;
  status: string;
  primary_domain: string;
  page_slug: string;
}

/* ── Universal Product Card ── */
function ProductCard({
  product,
  isSelected,
  isParent,
  isChild,
  readiness,
  onToggleSelect,
  onNavigate,
  onEdit,
  onDelete,
  onCopyLink,
  onDuplicate,
  canEdit,
  canManage,
  innerRef,
}: {
  product: any;
  isSelected: boolean;
  isParent: boolean;
  isChild: boolean;
  readiness: { isReady: boolean; reasonLabel?: string } | undefined;
  onToggleSelect: () => void;
  onNavigate: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCopyLink: () => void;
  onDuplicate: () => void;
  canEdit: boolean;
  canManage: boolean;
  innerRef?: (el: HTMLElement | null) => void;
}) {
  const statusKind: StatusBadgeKind = product.status === "active" ? "active" : product.status === "archived" ? "archived" : product.status === "hidden" ? "hidden" : "inactive";

  return (
    <div
      ref={innerRef}
      className={cn(
        "flex items-center gap-3 p-3 sm:p-4 rounded-xl border bg-card transition-colors cursor-pointer",
        isSelected && "bg-primary/5 border-primary/20"
      )}
      data-state={isSelected ? "selected" : undefined}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest("button, [role=checkbox]")) return;
        if (e.shiftKey) {
          e.preventDefault();
          return;
        }
        if (canEdit && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          onToggleSelect();
          return;
        }
        onNavigate();
      }}
    >
      {/* Checkbox */}
      <Checkbox
        checked={isSelected}
        onCheckedChange={onToggleSelect}
        onClick={(e) => e.stopPropagation()}
        disabled={!canEdit}
        className="shrink-0"
      />

      {/* Center: name + meta */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-sm truncate sm:whitespace-normal sm:line-clamp-2">{product.name}</span>
          {isParent && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <FolderTree className="h-3.5 w-3.5 text-primary/60 shrink-0" />
                </TooltipTrigger>
                <TooltipContent>Содержит дочерние продукты</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {isChild && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <CornerDownRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </TooltipTrigger>
                <TooltipContent>Входит в состав другого продукта</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <Badge variant="outline" className={cn("text-[10px] sm:text-[11px] px-1.5 py-0", getStatusBadgeClass(statusKind))}>
            {STATUS_LABELS[product.status] || product.status}
          </Badge>
          {product.primary_domain ? (
            <span className="text-[11px] sm:text-xs text-muted-foreground truncate sm:truncate-none sm:break-all max-w-[140px] sm:max-w-none">
              {product.primary_domain}
            </span>
          ) : (
            <span className="text-[11px] sm:text-xs text-muted-foreground">без сайта</span>
          )}
        </div>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
        {(() => {
          const isReady = readiness?.isReady ?? true;
          return (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); onCopyLink(); }}>
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
              <Button variant="ghost" size="icon" className="h-7 w-7 hidden sm:inline-flex" onClick={(e) => { e.stopPropagation(); onDuplicate(); }}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {product.public_id ? `${product.public_id} — копировать UUID` : "Копировать UUID"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {canEdit && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); onEdit(); }}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>}
        {canManage && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>}
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
    </div>
  );
}

const defaultFormData: ProductFormData = {
  name: "",
  description: "",
  status: "active",
  primary_domain: "",
  page_slug: "",
};

export default function AdminProductsV2() {
  const navigate = useNavigate();
  const access = useAdminAccess();
  const permLoading = access.isLoading;
  const canEdit = access.canAccessSection("products", "edit");
  const canManage = access.canAccessSection("products", "manage");
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
  const [isSavingPageAddress, setIsSavingPageAddress] = useState(false);
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
        page_slug: product.site_pages?.[0]?.slug || "",
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
    if (formData.primary_domain.trim() && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(formData.primary_domain.trim())) {
      toast.error("Домен указывается без https:// и пути, например club.gorbova.by");
      return;
    }

    const pageValidation = formData.page_slug.trim()
      ? validateProductPageAddress(formData.page_slug)
      : null;
    if (pageValidation && pageValidation.ok === false) {
      toast.error(pageValidation.error);
      return;
    }

    const payload: any = {
      name: formData.name,
      description: formData.description || null,
      status: formData.status,
      primary_domain: formData.primary_domain.trim().toLowerCase() || null,
    };

    setIsSavingPageAddress(true);
    try {
      if (pageValidation?.ok) {
        const currentPageId = editingProduct
          ? products?.find((p: any) => p.id === editingProduct)?.site_pages?.[0]?.id
          : undefined;
        await assertProductPageSlugAvailable(pageValidation.slug, currentPageId);
      }

      if (editingProduct) {
        await updateMutation.mutateAsync({ id: editingProduct, ...payload });
        if (pageValidation?.ok) {
          await saveProductPageAddress({
            productId: editingProduct,
            productName: formData.name,
            address: pageValidation.slug,
          });
          toast.success(`Адрес страницы сохранён: ${getProductPageUrl(pageValidation.slug)}`);
        }
        handleCloseDialog();
      } else {
        payload.code = 'prd_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
        const newProduct = await createMutation.mutateAsync(payload);
        if (newProduct?.id && pageValidation?.ok) {
          try {
            await saveProductPageAddress({
              productId: newProduct.id,
              productName: formData.name,
              address: pageValidation.slug,
            });
          } catch (pageError) {
            await supabase.from("products_v2").delete().eq("id", newProduct.id);
            throw pageError;
          }
        }
        handleCloseDialog();
        if (newProduct?.id) {
          navigate(`/admin/products-v2/${newProduct.id}`);
          toast.info(pageValidation?.ok ? "Страница создана как черновик" : "Теперь добавьте тарифы для продукта");
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить адрес страницы");
    } finally {
      setIsSavingPageAddress(false);
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
    defaultSortKey: "name",
    defaultSortDirection: "asc",
    getFieldValue: (item: any, key: string) => {
      switch (key) {
        case "name": return item.name;
        case "domain": return item.primary_domain || "";
        case "status": return STATUS_LABELS[item.status] || item.status;
        default: return (item as any)[key];
      }
    },
  });

  // Drag-select
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
          {!permLoading && (
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
          {canEdit && <Button size="sm" className="h-8" onClick={() => handleOpenDialog()}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            <span className="hidden sm:inline">Добавить продукт</span>
            <span className="sm:hidden">Добавить</span>
          </Button>}
        </div>

        {/* Loading / Empty */}
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
          <>
            {/* ── Select-all + Sort controls ── */}
            <div className="flex items-center justify-between px-1 gap-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={selectedCount > 0 && selectedCount === sortedData.length}
                  onCheckedChange={(checked) => {
                    if (checked) selectAll();
                    else clearSelection();
                  }}
                />
                <span className="text-xs text-muted-foreground">
                  {selectedCount > 0
                    ? `${selectedCount} из ${sortedData.length}`
                    : `${sortedData.length} продуктов`}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <SortPill label="Имя" sortKey="name" currentSortKey={sortKey} currentSortDirection={sortDirection} onSort={handleSort} />
                <SortPill label="Сайт" sortKey="domain" currentSortKey={sortKey} currentSortDirection={sortDirection} onSort={handleSort} />
                <SortPill label="Статус" sortKey="status" currentSortKey={sortKey} currentSortDirection={sortDirection} onSort={handleSort} />
              </div>
            </div>

            {/* ── Card list (all breakpoints) ── */}
            <div className="space-y-2 px-1">
              {sortedData.map((product: any) => {
                const isParent = relationCounts?.parentIds?.has(product.id) ?? false;
                const isChild = relationCounts?.childIds?.has(product.id) ?? false;
                const readiness = readinessMap?.get(product.id);
                return (
                  <ProductCard
                    key={product.id}
                    product={product}
                    isSelected={selectedIds.has(product.id)}
                    isParent={isParent}
                    isChild={isChild}
                    readiness={readiness}
                    canEdit={canEdit}
                    canManage={canManage}
                    innerRef={(el) => registerItemRef(product.id, el)}
                    onToggleSelect={() => toggleSelection(product.id, true)}
                    onNavigate={() => navigate(`/admin/products-v2/${product.id}`)}
                    onEdit={() => handleOpenDialog(product)}
                    onDelete={() => setDeleteConfirmId(product.id)}
                    onDuplicate={() => {
                      copyToClipboard(product.id, "UUID скопирован");
                    }}
                    onCopyLink={() => {
                      const url = getProductPayUrl(product.id);
                      if (readiness && !readiness.isReady) {
                        copyToClipboard(url, "Ссылка скопирована");
                        toast.warning(`Продукт не готов: ${readiness.reasonLabel}`);
                      } else {
                        copyToClipboard(url, "Ссылка на оплату скопирована");
                      }
                    }}
                  />
                );
              })}
            </div>
          </>
        )}

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
        {hasSelection && canEdit && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4">
          <div className="bg-background border rounded-xl shadow-lg px-3 sm:px-4 py-2.5 sm:py-3 flex flex-wrap items-center gap-2 sm:gap-3 max-w-[calc(100vw-2rem)]">
              <div className="flex items-center gap-2 text-xs sm:text-sm font-medium">
                <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary text-xs sm:text-sm">
                  {selectedCount}
                </div>
                <span className="text-muted-foreground whitespace-nowrap">
                  из {sortedData.length}
                </span>
              </div>
              <div className="h-5 w-px bg-border hidden sm:block" />
              {selectedCount < sortedData.length && (
                <Button variant="ghost" size="sm" onClick={selectAll} className="gap-1.5 h-7 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm">
                  Все
                </Button>
              )}
              <Button variant="ghost" size="sm" className="gap-1 h-7 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm text-primary" onClick={() => handleBulkStatus("active")}>
                <Eye className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Активные</span>
              </Button>
              <Button variant="ghost" size="sm" className="gap-1 h-7 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm" onClick={() => handleBulkStatus("hidden")}>
                <EyeOff className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Скрытые</span>
              </Button>
              <Button variant="ghost" size="sm" className="gap-1 h-7 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm" onClick={() => handleBulkStatus("archived")}>
                <Archive className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Архив</span>
              </Button>
              <Button variant="ghost" size="sm" className="gap-1 h-7 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm" onClick={handleCopyLink}>
                <Link className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Ссылка</span>
              </Button>
              {canManage && (
                <Button variant="ghost" size="sm" className="gap-1 h-7 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm text-destructive hover:text-destructive" onClick={handleBulkDeleteStart}>
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Удалить</span>
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-8 sm:w-8" onClick={clearSelection}>
                <span className="text-xs">✕</span>
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl w-[calc(100vw-1.5rem)] sm:w-full overflow-hidden p-0 bg-background">
          <div className="max-h-[calc(100dvh-4rem)] overflow-y-auto overflow-x-hidden scrollbar-none p-4 sm:p-6">
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

          <div className="space-y-5">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Основное</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label>Название *</Label>
                    {editingProduct && (() => {
                      const prod = products?.find((p: any) => p.id === editingProduct);
                      return prod?.public_id ? <CopyableIdChip value={prod.public_id} /> : null;
                    })()}
                  </div>
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
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Дополнительно</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Домен сайта</Label>
                  <Input
                    placeholder="club.gorbova.by"
                    value={formData.primary_domain}
                    onChange={(e) => setFormData({ ...formData, primary_domain: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">Только домен без https:// и пути (опционально)</p>
                </div>

                <div className="space-y-2">
                  <Label>Адрес страницы на gorbova.by</Label>
                  <div className="flex items-center rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                    <span className="pl-3 text-sm text-muted-foreground whitespace-nowrap">gorbova.by/</span>
                    <Input
                      className="border-0 pl-1 focus-visible:ring-0 focus-visible:ring-offset-0"
                      placeholder={suggestProductPageSlug(formData.name) || "ir"}
                      value={formData.page_slug}
                      onChange={(e) => setFormData({ ...formData, page_slug: e.target.value })}
                      onBlur={() => {
                        if (!formData.page_slug.trim()) return;
                        setFormData((current) => ({
                          ...current,
                          page_slug: normalizeProductPageSlug(current.page_slug),
                        }));
                      }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Например: ir. При изменении старый адрес продолжит работать.
                  </p>
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
              </CardContent>
            </Card>
          </div>

          <DialogFooter className="pt-4 border-t border-border/40">
            <Button variant="outline" onClick={handleCloseDialog}>Отмена</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending || isSavingPageAddress}>
              {editingProduct ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
          </div>
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
