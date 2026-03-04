import { useState, useMemo, useCallback, useEffect } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, Globe, ChevronRight, Copy, ExternalLink, Search, ChevronDown, ChevronUp, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { useProductsV2, useCreateProductV2, useUpdateProductV2, useDeleteProductV2 } from "@/hooks/useProductsV2";
import { useTelegramClubs } from "@/hooks/useTelegramIntegration";
import { useNavigate } from "react-router-dom";
import { PRODUCT_CATEGORIES, PRODUCT_CATEGORY_LABELS, getCategoryLabel } from "@/lib/product-names";
import { GlassCard } from "@/components/ui/GlassCard";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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

const CATEGORY_ORDER: string[] = ['subscription', 'course', 'module', 'service', 'digital_product'];

function getStoredCollapsedState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem("products_collapsed_groups");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCollapsedState(state: Record<string, boolean>) {
  localStorage.setItem("products_collapsed_groups", JSON.stringify(state));
}

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
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(getStoredCollapsedState);
  const [docsOpen, setDocsOpen] = useState(false);

  useEffect(() => {
    saveCollapsedState(collapsedGroups);
  }, [collapsedGroups]);

  const toggleGroup = useCallback((category: string) => {
    setCollapsedGroups(prev => ({ ...prev, [category]: !prev[category] }));
  }, []);

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

  const activeProducts = products?.filter(p => p.is_active).length || 0;
  const withDomain = products?.filter(p => (p as any).primary_domain).length || 0;
  const withClub = products?.filter(p => p.telegram_club_id).length || 0;

  // Tabs
  const [activeTab, setActiveTab] = useState("all");

  const productTabs = [
    { id: "all", label: "Все", count: products?.length || 0 },
    { id: "active", label: "Активные", count: activeProducts },
    { id: "with_club", label: "С клубом", count: withClub },
    { id: "with_domain", label: "С доменом", count: withDomain },
  ];

  // Filter by tab
  const tabFiltered = useMemo(() => {
    if (!products) return [];
    switch (activeTab) {
      case "active": return products.filter(p => p.is_active);
      case "with_club": return products.filter(p => p.telegram_club_id);
      case "with_domain": return products.filter(p => p.primary_domain);
      default: return products;
    }
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

  const isSearching = debouncedSearch.trim().length > 0;

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

  // Group by category
  const groupedProducts = useMemo(() => {
    const groups: Record<string, any[]> = {};
    for (const p of sortedData) {
      const cat = (p as any).category || "course";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(p);
    }
    // Sort categories by predefined order
    const ordered: { category: string; label: string; items: any[] }[] = [];
    for (const cat of CATEGORY_ORDER) {
      if (groups[cat]) {
        ordered.push({ category: cat, label: getCategoryLabel(cat), items: groups[cat] });
        delete groups[cat];
      }
    }
    // Any remaining unknown categories
    for (const [cat, items] of Object.entries(groups)) {
      ordered.push({ category: cat, label: getCategoryLabel(cat), items });
    }
    return ordered;
  }, [sortedData]);

  const renderProductRow = (product: any) => (
    <TableRow
      key={product.id}
      className="cursor-pointer hover:bg-muted/50"
      onClick={() => navigate(`/admin/products-v2/${product.id}`)}
    >
      <TableCell>
        <div className="space-y-1">
          <div className="font-medium text-sm">{product.name}</div>
          <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
            {product.code}
          </code>
        </div>
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
  );

  const tableHeader = (
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
  );

  return (
    <AdminLayout>
      <div className="space-y-4">
        {/* Pill-style Tabs */}
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
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span>{tab.label}</span>
                  {tab.count > 0 && (
                    <Badge className="h-4 min-w-4 px-1 text-[10px] font-semibold rounded-full bg-primary/20 text-primary">
                      {tab.count}
                    </Badge>
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
              placeholder="Поиск по названию, коду..."
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

        {/* Products Table with Collapsible Groups */}
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
            <div>
              {groupedProducts.map((group) => {
                const isOpen = isSearching || !collapsedGroups[group.category];
                return (
                  <Collapsible key={group.category} open={isOpen} onOpenChange={() => !isSearching && toggleGroup(group.category)}>
                    <CollapsibleTrigger asChild>
                      <button className="w-full flex items-center gap-2 px-4 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors border-b border-border/30 text-left">
                        {isOpen ? (
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        )}
                        <span className="text-xs font-semibold text-foreground">{group.label}</span>
                        <Badge className="h-4 min-w-4 px-1.5 text-[10px] font-semibold rounded-full bg-primary/15 text-primary border-0">
                          {group.items.length}
                        </Badge>
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <Table>
                        {tableHeader}
                        <TableBody>
                          {group.items.map(renderProductRow)}
                        </TableBody>
                      </Table>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </div>
          )}
        </GlassCard>

        {/* Documentation Section */}
        <Collapsible open={docsOpen} onOpenChange={setDocsOpen}>
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center gap-2 px-4 py-3 rounded-xl bg-muted/20 hover:bg-muted/30 border border-border/20 transition-colors text-left">
              <BookOpen className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-foreground">Справка: Продукты и связи</span>
              {docsOpen ? (
                <ChevronUp className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
              )}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <GlassCard className="mt-2 space-y-6 text-sm text-muted-foreground">
              {/* Продукт */}
              <div className="space-y-2">
                <h3 className="text-foreground font-semibold text-base">Продукт <code className="text-xs bg-muted px-1.5 py-0.5 rounded">products_v2</code></h3>
                <p>Основная сущность каталога. Каждый продукт имеет уникальный <strong>код</strong> (code) и <strong>название</strong> (name).</p>
                <div className="overflow-x-auto">
                  <table className="text-xs w-full border-collapse">
                    <thead>
                      <tr className="border-b border-border/30">
                        <th className="text-left py-1.5 pr-4 font-medium text-foreground">Поле</th>
                        <th className="text-left py-1.5 pr-4 font-medium text-foreground">Описание</th>
                        <th className="text-left py-1.5 font-medium text-foreground">Связь</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/20">
                      <tr><td className="py-1 pr-4 font-mono">code</td><td className="py-1 pr-4">Уникальный код (напр. <code>cb20</code>, <code>club</code>)</td><td className="py-1">—</td></tr>
                      <tr><td className="py-1 pr-4 font-mono">name</td><td className="py-1 pr-4">Внутреннее название</td><td className="py-1">—</td></tr>
                      <tr><td className="py-1 pr-4 font-mono">slug</td><td className="py-1 pr-4">URL-часть для лендинга</td><td className="py-1">Используется в маршрутизации</td></tr>
                      <tr><td className="py-1 pr-4 font-mono">category</td><td className="py-1 pr-4">subscription, course, module, service, digital_product</td><td className="py-1">Визуальная группировка</td></tr>
                      <tr><td className="py-1 pr-4 font-mono">primary_domain</td><td className="py-1 pr-4">Домен, на котором отображается продукт</td><td className="py-1">—</td></tr>
                      <tr><td className="py-1 pr-4 font-mono">telegram_club_id</td><td className="py-1 pr-4">Привязанный Telegram-клуб</td><td className="py-1">→ <code>telegram_clubs</code></td></tr>
                      <tr><td className="py-1 pr-4 font-mono">status</td><td className="py-1 pr-4">draft / active / archived</td><td className="py-1">—</td></tr>
                      <tr><td className="py-1 pr-4 font-mono">is_active</td><td className="py-1 pr-4">Активен ли продукт</td><td className="py-1">—</td></tr>
                      <tr><td className="py-1 pr-4 font-mono">currency</td><td className="py-1 pr-4">BYN / RUB / USD / EUR</td><td className="py-1">—</td></tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-xs"><strong>Настройки без связей</strong> (только для лендинга): <code>public_title</code>, <code>public_subtitle</code>, <code>payment_disclaimer_text</code>, <code>landing_config</code>.</p>
              </div>

              {/* Тариф */}
              <div className="space-y-2">
                <h3 className="text-foreground font-semibold text-base">Тариф <code className="text-xs bg-muted px-1.5 py-0.5 rounded">tariffs</code></h3>
                <p>Пакет доступа к продукту. У одного продукта может быть несколько тарифов (Базовый, VIP и т.д.).</p>
                <div className="overflow-x-auto">
                  <table className="text-xs w-full border-collapse">
                    <thead>
                      <tr className="border-b border-border/30">
                        <th className="text-left py-1.5 pr-4 font-medium text-foreground">Поле</th>
                        <th className="text-left py-1.5 pr-4 font-medium text-foreground">Описание</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/20">
                      <tr><td className="py-1 pr-4 font-mono">code</td><td className="py-1 pr-4">Уникальный код тарифа</td></tr>
                      <tr><td className="py-1 pr-4 font-mono">name</td><td className="py-1 pr-4">Название (отображается на лендинге)</td></tr>
                      <tr><td className="py-1 pr-4 font-mono">description</td><td className="py-1 pr-4">Описание тарифа</td></tr>
                      <tr><td className="py-1 pr-4 font-mono">period_label</td><td className="py-1 pr-4">Метка периода (напр. «в месяц», «навсегда»)</td></tr>
                      <tr><td className="py-1 pr-4 font-mono">access_days</td><td className="py-1 pr-4">Длительность доступа в днях</td></tr>
                      <tr><td className="py-1 pr-4 font-mono">is_popular</td><td className="py-1 pr-4">Отметка «Популярный» на лендинге</td></tr>
                      <tr><td className="py-1 pr-4 font-mono">badge</td><td className="py-1 pr-4">Дополнительная плашка (напр. «Лучшая цена»)</td></tr>
                      <tr><td className="py-1 pr-4 font-mono">sort_order</td><td className="py-1 pr-4">Порядок отображения</td></tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-xs"><strong>Связь:</strong> <code>product_id</code> → <code>products_v2.id</code>. Тариф → <code>tariff_features</code> (список возможностей).</p>
              </div>

              {/* Кнопка оплаты */}
              <div className="space-y-2">
                <h3 className="text-foreground font-semibold text-base">Кнопка оплаты <code className="text-xs bg-muted px-1.5 py-0.5 rounded">tariff_offers</code></h3>
                <p>Способ покупки конкретного тарифа. У одного тарифа может быть несколько кнопок (оплатить, рассрочка, пробный период).</p>
                <div className="overflow-x-auto">
                  <table className="text-xs w-full border-collapse">
                    <thead>
                      <tr className="border-b border-border/30">
                        <th className="text-left py-1.5 pr-4 font-medium text-foreground">Поле</th>
                        <th className="text-left py-1.5 pr-4 font-medium text-foreground">Описание</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/20">
                      <tr><td className="py-1 pr-4 font-mono">type</td><td className="py-1 pr-4">pay_now / trial / preregistration</td></tr>
                      <tr><td className="py-1 pr-4 font-mono">price</td><td className="py-1 pr-4">Цена (основная)</td></tr>
                      <tr><td className="py-1 pr-4 font-mono">old_price</td><td className="py-1 pr-4">Старая цена (для перечёркнутой)</td></tr>
                      <tr><td className="py-1 pr-4 font-mono">installment_months</td><td className="py-1 pr-4">Рассрочка на N месяцев</td></tr>
                      <tr><td className="py-1 pr-4 font-mono">tokenize_card</td><td className="py-1 pr-4">Токенизация карты (для подписок)</td></tr>
                      <tr><td className="py-1 pr-4 font-mono">auto_charge</td><td className="py-1 pr-4">Автосписание</td></tr>
                      <tr><td className="py-1 pr-4 font-mono">reject_virtual_cards</td><td className="py-1 pr-4">Отклонять виртуальные карты</td></tr>
                      <tr><td className="py-1 pr-4 font-mono">meta</td><td className="py-1 pr-4">JSON: welcome_message, button_label и др.</td></tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-xs"><strong>Связь:</strong> <code>tariff_id</code> → <code>tariffs.id</code>. Кнопки → <code>document_generation_rules</code> (правила генерации документов).</p>
              </div>

              {/* Поток */}
              <div className="space-y-2">
                <h3 className="text-foreground font-semibold text-base">Поток <code className="text-xs bg-muted px-1.5 py-0.5 rounded">flows</code></h3>
                <p>Когорта (набор) с датами старта/окончания и лимитом участников. Привязан к продукту.</p>
                <div className="overflow-x-auto">
                  <table className="text-xs w-full border-collapse">
                    <thead>
                      <tr className="border-b border-border/30">
                        <th className="text-left py-1.5 pr-4 font-medium text-foreground">Поле</th>
                        <th className="text-left py-1.5 pr-4 font-medium text-foreground">Описание</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/20">
                      <tr><td className="py-1 pr-4 font-mono">name</td><td className="py-1 pr-4">Название потока</td></tr>
                      <tr><td className="py-1 pr-4 font-mono">starts_at / ends_at</td><td className="py-1 pr-4">Даты проведения</td></tr>
                      <tr><td className="py-1 pr-4 font-mono">max_participants</td><td className="py-1 pr-4">Лимит участников</td></tr>
                      <tr><td className="py-1 pr-4 font-mono">is_active</td><td className="py-1 pr-4">Активен ли поток</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Цепочка связей */}
              <div className="space-y-2">
                <h3 className="text-foreground font-semibold text-base">Цепочка связей</h3>
                <div className="bg-muted/30 rounded-lg p-3 font-mono text-xs leading-relaxed">
                  <p>Продукт → Тарифы → Кнопки оплаты → Платежи (orders)</p>
                  <p>Продукт → Подписки (subscriptions)</p>
                  <p>Продукт → Telegram-клуб (telegram_clubs)</p>
                  <p>Тариф → Features (tariff_features — список возможностей)</p>
                  <p>Кнопки → Документы (document_generation_rules)</p>
                  <p>Продукт → Потоки (flows)</p>
                  <p>Продукт → bePaid маппинги (bepaid_product_mappings)</p>
                </div>
              </div>
            </GlassCard>
          </CollapsibleContent>
        </Collapsible>
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
            {/* Basic Info */}
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
                  <Select
                    value={formData.status}
                    onValueChange={(v) => setFormData({ ...formData, status: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
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
                <Select
                  value={formData.category}
                  onValueChange={(v) => setFormData({ ...formData, category: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRODUCT_CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {PRODUCT_CATEGORY_LABELS[cat]}
                      </SelectItem>
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

            {/* Domain & Currency */}
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
                  <p className="text-xs text-muted-foreground">
                    Домен, на котором будет отображаться продукт
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Валюта</Label>
                  <Select
                    value={formData.currency}
                    onValueChange={(v) => setFormData({ ...formData, currency: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
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

            {/* Public Display */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium text-muted-foreground">Публичное отображение</h4>
              <div className="space-y-2">
                <Label>Заголовок секции тарифов</Label>
                <Input
                  placeholder="Тарифы клуба"
                  value={formData.public_title}
                  onChange={(e) => setFormData({ ...formData, public_title: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Подзаголовок</Label>
                <Input
                  placeholder="Выберите подходящий формат участия"
                  value={formData.public_subtitle}
                  onChange={(e) => setFormData({ ...formData, public_subtitle: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Текст под тарифами (disclaimer)</Label>
                <Textarea
                  placeholder="Безопасная оплата через bePaid..."
                  value={formData.payment_disclaimer_text}
                  onChange={(e) => setFormData({ ...formData, payment_disclaimer_text: e.target.value })}
                />
              </div>
            </div>

            {/* Telegram & Status */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium text-muted-foreground">Интеграции</h4>
              <div className="space-y-2">
                <Label>Telegram клуб</Label>
                <Select
                  value={formData.telegram_club_id || "none"}
                  onValueChange={(v) =>
                    setFormData({ ...formData, telegram_club_id: v === "none" ? null : v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите клуб" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Не привязан</SelectItem>
                    {clubs?.map((club) => (
                      <SelectItem key={club.id} value={club.id}>
                        {club.club_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  checked={formData.is_active}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, is_active: checked })
                  }
                />
                <Label>Активен</Label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog}>
              Отмена
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
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
            <DialogDescription>
              Это действие нельзя отменить. Все связанные тарифы и данные будут удалены.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
