import { useState, useMemo, useCallback } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, Globe, ChevronRight, Copy, ExternalLink, Search } from "lucide-react";
import { toast } from "sonner";
import { useProductsV2, useCreateProductV2, useUpdateProductV2, useDeleteProductV2 } from "@/hooks/useProductsV2";
import { useTelegramClubs } from "@/hooks/useTelegramIntegration";
import { useNavigate } from "react-router-dom";
import { PRODUCT_CATEGORIES, PRODUCT_CATEGORY_LABELS, getCategoryLabel } from "@/lib/product-names";
import { GlassCard } from "@/components/ui/GlassCard";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useTableSort } from "@/hooks/useTableSort";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

interface ProductFormData {
  code: string;
  name: string;
  description: string;
  slug: string;
  status: string;
  category: string;
  primary_domain: string;
  currency: string;
  public_title: string;
  public_subtitle: string;
  payment_disclaimer_text: string;
  telegram_club_id: string | null;
  is_active: boolean;
}

const defaultFormData: ProductFormData = {
  code: "",
  name: "",
  description: "",
  slug: "",
  status: "active",
  category: "course",
  primary_domain: "",
  currency: "BYN",
  public_title: "",
  public_subtitle: "",
  payment_disclaimer_text: "",
  telegram_club_id: null,
  is_active: true,
};

export default function AdminProductsV2() {
  const navigate = useNavigate();
  const { data: products, isLoading } = useProductsV2();
  const { data: clubs } = useTelegramClubs();
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
        slug: product.slug || "",
        status: product.status || "active",
        category: product.category || "course",
        primary_domain: product.primary_domain || "",
        currency: product.currency || "BYN",
        public_title: product.public_title || "",
        public_subtitle: product.public_subtitle || "",
        payment_disclaimer_text: product.payment_disclaimer_text || "",
        telegram_club_id: product.telegram_club_id,
        is_active: product.is_active,
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
      slug: formData.slug || null,
      status: formData.status,
      category: formData.category,
      primary_domain: formData.primary_domain || null,
      currency: formData.currency,
      public_title: formData.public_title || null,
      public_subtitle: formData.public_subtitle || null,
      payment_disclaimer_text: formData.payment_disclaimer_text || null,
      telegram_club_id: formData.telegram_club_id || null,
      is_active: formData.is_active,
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
  const activeProducts = products?.filter(p => p.is_active).length || 0;
  const withClub = products?.filter(p => p.telegram_club_id).length || 0;
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    products?.forEach(p => {
      const cat = (p as any).category || "course";
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return counts;
  }, [products]);

  // Pill-filter tabs
  const [activeTab, setActiveTab] = useState("all");

  const productTabs = useMemo(() => [
    { id: "all", label: "Все", count: products?.length || 0 },
    { id: "active", label: "Активные", count: activeProducts },
    ...PRODUCT_CATEGORIES.map(cat => ({
      id: `cat_${cat}`,
      label: PRODUCT_CATEGORY_LABELS[cat],
      count: categoryCounts[cat] || 0,
    })),
    { id: "with_club", label: "С клубом", count: withClub },
  ], [products?.length, activeProducts, categoryCounts, withClub]);

  // Filter by tab
  const tabFiltered = useMemo(() => {
    if (!products) return [];
    if (activeTab === "active") return products.filter(p => p.is_active);
    if (activeTab === "with_club") return products.filter(p => p.telegram_club_id);
    if (activeTab.startsWith("cat_")) {
      const cat = activeTab.replace("cat_", "");
      return products.filter(p => (p as any).category === cat);
    }
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
        case "category": return getCategoryLabel(item.category || "course");
        case "domain": return item.primary_domain || "";
        case "status": return item.is_active ? "Активен" : "Неактивен";
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
                  <SortableTableHead sortKey="category" currentSortKey={sortKey} currentSortDirection={sortDirection} onSort={handleSort}>
                    Категория
                  </SortableTableHead>
                  <SortableTableHead sortKey="domain" currentSortKey={sortKey} currentSortDirection={sortDirection} onSort={handleSort}>
                    Домен
                  </SortableTableHead>
                  <SortableTableHead sortKey="status" currentSortKey={sortKey} currentSortDirection={sortDirection} onSort={handleSort}>
                    Статус
                  </SortableTableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedData.map((product: any) => (
                  <TableRow
                    key={product.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/admin/products-v2/${product.id}`)}
                  >
                    <TableCell>
                      <span className="font-medium text-sm">{product.name}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {getCategoryLabel(product.category || 'course')}
                      </Badge>
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
                      <div className="flex gap-1.5">
                        <Badge variant={product.is_active ? "default" : "secondary"} className="text-[11px]">
                          {product.is_active ? "Активен" : "Неактивен"}
                        </Badge>
                        {product.status === "draft" && (
                          <Badge variant="outline" className="text-[11px]">Черновик</Badge>
                        )}
                      </div>
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
                ))}
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

          <div className="space-y-6">
            <div className="space-y-4">
              <h4 className="text-sm font-medium text-muted-foreground">Основные данные</h4>
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

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Slug (URL)</Label>
                  <Input
                    placeholder="gorbova-club"
                    value={formData.slug}
                    onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Статус</Label>
                  <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Черновик</SelectItem>
                      <SelectItem value="active">Активный</SelectItem>
                      <SelectItem value="archived">Архивный</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Категория</Label>
                <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRODUCT_CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>{PRODUCT_CATEGORY_LABELS[cat]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Описание</Label>
                <Textarea
                  placeholder="Описание продукта..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-sm font-medium text-muted-foreground">Домен и валюта</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Основной домен</Label>
                  <Input
                    placeholder="club.gorbova.by"
                    value={formData.primary_domain}
                    onChange={(e) => setFormData({ ...formData, primary_domain: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">Домен, на котором будет отображаться продукт</p>
                </div>
                <div className="space-y-2">
                  <Label>Валюта</Label>
                  <Select value={formData.currency} onValueChange={(v) => setFormData({ ...formData, currency: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BYN">BYN</SelectItem>
                      <SelectItem value="RUB">RUB</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-sm font-medium text-muted-foreground">Публичное отображение</h4>
              <div className="space-y-2">
                <Label>Заголовок секции тарифов</Label>
                <Input placeholder="Тарифы клуба" value={formData.public_title} onChange={(e) => setFormData({ ...formData, public_title: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Подзаголовок</Label>
                <Input placeholder="Выберите подходящий формат участия" value={formData.public_subtitle} onChange={(e) => setFormData({ ...formData, public_subtitle: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Текст под тарифами (disclaimer)</Label>
                <Textarea placeholder="Безопасная оплата через bePaid..." value={formData.payment_disclaimer_text} onChange={(e) => setFormData({ ...formData, payment_disclaimer_text: e.target.value })} />
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-sm font-medium text-muted-foreground">Интеграции</h4>
              <div className="space-y-2">
                <Label>Telegram клуб</Label>
                <Select value={formData.telegram_club_id || "none"} onValueChange={(v) => setFormData({ ...formData, telegram_club_id: v === "none" ? null : v })}>
                  <SelectTrigger><SelectValue placeholder="Выберите клуб" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Не привязан</SelectItem>
                    {clubs?.map((club) => (
                      <SelectItem key={club.id} value={club.id}>{club.club_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center space-x-2">
                <Switch checked={formData.is_active} onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })} />
                <Label>Активен</Label>
              </div>
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
