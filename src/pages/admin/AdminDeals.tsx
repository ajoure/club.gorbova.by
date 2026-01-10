import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Search,
  Handshake,
  RefreshCw,
  Package,
  Clock,
  Calendar,
  CheckCircle,
  XCircle,
  AlertTriangle,
  TrendingUp,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DealDetailSheet } from "@/components/admin/DealDetailSheet";
import { SmartImportWizard } from "@/components/integrations/SmartImportWizard";
import { QuickFilters, ActiveFilter, FilterField, FilterPreset, applyFilters } from "@/components/admin/QuickFilters";
import { useDragSelect } from "@/hooks/useDragSelect";
import { SelectionBox } from "@/components/admin/SelectionBox";
import { BulkActionsBar } from "@/components/admin/BulkActionsBar";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useTableSort } from "@/hooks/useTableSort";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  draft: { label: "Черновик", color: "bg-muted text-muted-foreground", icon: Clock },
  pending: { label: "Ожидает оплаты", color: "bg-amber-500/20 text-amber-600", icon: Clock },
  paid: { label: "Оплачен", color: "bg-green-500/20 text-green-600", icon: CheckCircle },
  partial: { label: "Частично оплачен", color: "bg-blue-500/20 text-blue-600", icon: AlertTriangle },
  cancelled: { label: "Отменён", color: "bg-red-500/20 text-red-600", icon: XCircle },
  refunded: { label: "Возврат", color: "bg-red-500/20 text-red-600", icon: XCircle },
  expired: { label: "Истёк", color: "bg-muted text-muted-foreground", icon: XCircle },
};

export default function AdminDeals() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([]);
  const [activePreset, setActivePreset] = useState("all");
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [showImportWizard, setShowImportWizard] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const queryClient = useQueryClient();

  // Fetch deals (orders_v2) with related data
  const { data: deals, isLoading, refetch } = useQuery({
    queryKey: ["admin-deals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders_v2")
        .select(`
          *,
          products_v2(id, name, code),
          tariffs(id, name, code, access_days),
          flows(id, name),
          payments_v2(id, status, amount, paid_at)
        `)
        .order("created_at", { ascending: false })
        .limit(500);

      if (error) throw error;
      return data;
    },
  });

  // Fetch products for filter
  const { data: products } = useQuery({
    queryKey: ["products-filter"],
    queryFn: async () => {
      const { data } = await supabase
        .from("products_v2")
        .select("id, name")
        .eq("is_active", true);
      return data || [];
    },
  });

  // Fetch profiles for contact info
  const { data: profilesMap } = useQuery({
    queryKey: ["profiles-map"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, email, full_name, phone, avatar_url");
      const map = new Map<string, any>();
      data?.forEach(p => map.set(p.user_id, p));
      return map;
    },
  });

  // Build filter fields dynamically based on available products
  const DEAL_FILTER_FIELDS: FilterField[] = useMemo(() => [
    { key: "order_number", label: "№ заказа", type: "text" },
    { key: "customer_email", label: "Email", type: "text" },
    { key: "customer_phone", label: "Телефон", type: "text" },
    { key: "contact_name", label: "Имя контакта", type: "text" },
    { 
      key: "status", 
      label: "Статус", 
      type: "select",
      options: Object.entries(STATUS_CONFIG).map(([value, { label }]) => ({ value, label }))
    },
    { 
      key: "product_id", 
      label: "Продукт", 
      type: "select",
      options: products?.map(p => ({ value: p.id, label: p.name })) || []
    },
    { key: "final_price", label: "Сумма", type: "number" },
    { key: "is_trial", label: "Триал", type: "boolean" },
    { key: "created_at", label: "Дата создания", type: "date" },
  ], [products]);

  // Calculate stats
  const stats = useMemo(() => {
    if (!deals) return { total: 0, paid: 0, pending: 0, revenue: 0 };
    const total = deals.length;
    const paid = deals.filter(d => d.status === "paid").length;
    const pending = deals.filter(d => d.status === "pending").length;
    const revenue = deals
      .filter(d => d.status === "paid")
      .reduce((sum, d) => sum + Number(d.final_price || 0), 0);
    return { total, paid, pending, revenue };
  }, [deals]);


  // Get field value for sorting/filtering
  const getDealFieldValue = useCallback((deal: any, fieldKey: string): any => {
    switch (fieldKey) {
      case "contact_name":
        const profile = profilesMap?.get(deal.user_id);
        return profile?.full_name || deal.customer_email || "";
      case "product_name":
        return (deal.products_v2 as any)?.name || "";
      case "tariff_name":
        return (deal.tariffs as any)?.name || "";
      default:
        return deal[fieldKey];
    }
  }, [profilesMap]);

  // Filter deals
  const filteredDeals = useMemo(() => {
    if (!deals) return [];
    
    // First apply search
    let result = deals;
    if (search) {
      const searchLower = search.toLowerCase();
      result = result.filter(deal => {
        const profile = profilesMap?.get(deal.user_id);
        return (
          deal.order_number?.toLowerCase().includes(searchLower) ||
          deal.customer_email?.toLowerCase().includes(searchLower) ||
          deal.customer_phone?.includes(search) ||
          profile?.email?.toLowerCase().includes(searchLower) ||
          profile?.full_name?.toLowerCase().includes(searchLower) ||
          (deal.products_v2 as any)?.name?.toLowerCase().includes(searchLower)
        );
      });
    }
    
    // Then apply filters
    return applyFilters(result, activeFilters, getDealFieldValue);
  }, [deals, search, activeFilters, profilesMap, getDealFieldValue]);

  // Sorting
  const { sortedData: sortedDeals, sortKey, sortDirection, handleSort } = useTableSort({
    data: filteredDeals,
    defaultSortKey: "created_at",
    defaultSortDirection: "desc",
    getFieldValue: getDealFieldValue,
  });

  // Preset counts
  const presetCounts = useMemo(() => {
    if (!deals) return { paid: 0, pending: 0, trial: 0, canceled: 0 };
    return {
      paid: deals.filter(d => d.status === "paid").length,
      pending: deals.filter(d => d.status === "pending").length,
      trial: deals.filter(d => d.is_trial).length,
      canceled: deals.filter(d => d.status === "canceled" || d.status === "refunded").length,
    };
  }, [deals]);

  const DEAL_PRESETS: FilterPreset[] = useMemo(() => [
    { id: "all", label: "Все", filters: [] },
    { id: "paid", label: "Оплачены", filters: [{ field: "status", operator: "equals", value: "paid" }], count: presetCounts.paid },
    { id: "pending", label: "Ожидают оплаты", filters: [{ field: "status", operator: "equals", value: "pending" }], count: presetCounts.pending },
    { id: "trial", label: "Триал", filters: [{ field: "is_trial", operator: "equals", value: "true" }], count: presetCounts.trial },
    { id: "canceled", label: "Отменённые", filters: [{ field: "status", operator: "equals", value: "canceled" }], count: presetCounts.canceled },
  ], [presetCounts]);

  const selectedDeal = deals?.find(d => d.id === selectedDealId);

  // Drag select hook - use sortedDeals for consistent selection
  const {
    selectedIds: selectedDealIds,
    setSelectedIds: setSelectedDealIds,
    isDragging,
    selectionBox,
    containerRef,
    registerItemRef,
    toggleSelection,
    handleRangeSelect,
    selectAll,
    clearSelection,
    handleMouseDown,
    selectedCount,
    hasSelection,
  } = useDragSelect({
    items: sortedDeals,
    getItemId: (deal) => deal.id,
  });

  // Bulk delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      // 0. Get order details for notifications
      const { data: ordersToDelete } = await supabase
        .from("orders_v2")
        .select("id, user_id, order_number, products_v2(name, code, telegram_club_id)")
        .in("id", ids);

      // 1. Get subscription IDs linked to these orders
      const { data: subscriptions } = await supabase
        .from("subscriptions_v2")
        .select("id, user_id")
        .in("order_id", ids);
      
      const subscriptionIds = subscriptions?.map(s => s.id) || [];
      
      // Collect unique user IDs for notifications
      const affectedUserIds = new Set<string>();
      ordersToDelete?.forEach(o => o.user_id && affectedUserIds.add(o.user_id));
      
      // 2. Delete installment payments for these subscriptions
      if (subscriptionIds.length > 0) {
        const { error: installmentsError } = await supabase
          .from("installment_payments")
          .delete()
          .in("subscription_id", subscriptionIds);
        
        if (installmentsError) {
          console.error("Error deleting installments:", installmentsError);
        }
      }
      
      // 3. Delete subscriptions
      const { error: subscriptionsError } = await supabase
        .from("subscriptions_v2")
        .delete()
        .in("order_id", ids);
      
      if (subscriptionsError) {
        console.error("Error deleting subscriptions:", subscriptionsError);
        throw subscriptionsError;
      }
      
      // 4. Delete entitlements for affected users & products
      for (const order of ordersToDelete || []) {
        const productCode = (order.products_v2 as any)?.code;
        if (order.user_id && productCode) {
          await supabase
            .from("entitlements")
            .delete()
            .eq("user_id", order.user_id)
            .eq("product_code", productCode);
        }
        
        // Revoke Telegram access if product has telegram_club_id
        const telegramClubId = (order.products_v2 as any)?.telegram_club_id;
        if (order.user_id && telegramClubId) {
          await supabase.functions.invoke("telegram-revoke-access", {
            body: { user_id: order.user_id, club_id: telegramClubId },
          }).catch(console.error);
        }
      }

      // 5. Delete payments
      const { error: paymentsError } = await supabase
        .from("payments_v2")
        .delete()
        .in("order_id", ids);
      
      if (paymentsError) {
        console.error("Error deleting payments:", paymentsError);
      }

      // 6. Delete orders
      const { error } = await supabase
        .from("orders_v2")
        .delete()
        .in("id", ids);
      
      if (error) throw error;
      
      // 7. Send revocation notifications to affected users
      for (const userId of affectedUserIds) {
        await supabase.functions.invoke("telegram-send-notification", {
          body: { user_id: userId, message_type: "access_revoked" },
        }).catch(console.error);
      }

      return ids.length;
    },
    onSuccess: (count) => {
      toast.success(`Удалено ${count} сделок`);
      clearSelection();
      queryClient.invalidateQueries({ queryKey: ["admin-deals"] });
      queryClient.invalidateQueries({ queryKey: ["admin-subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["admin-entitlements"] });
    },
    onError: (error) => {
      toast.error("Ошибка удаления: " + (error as Error).message);
    },
  });

  const handleBulkDelete = () => {
    deleteMutation.mutate(Array.from(selectedDealIds));
    setShowDeleteDialog(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Handshake className="h-6 w-6" />
            Сделки
          </h1>
          <p className="text-muted-foreground">Все заказы, подписки, триалы и ручные выдачи</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setShowImportWizard(true)}>
            <Sparkles className="h-4 w-4 mr-2" />
            Умный импорт
          </Button>
          <Button variant="outline" onClick={() => {
            queryClient.invalidateQueries({ queryKey: ["admin-deals"] });
            queryClient.invalidateQueries({ queryKey: ["profiles-map"] });
            queryClient.invalidateQueries({ queryKey: ["products-filter"] });
            toast.success("Данные обновлены");
          }}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Обновить
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Package className="h-4 w-4" />
              Всего сделок
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              Оплачено
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats.paid}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-600" />
              Ожидает оплаты
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{stats.pending}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Выручка
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {new Intl.NumberFormat("ru-BY", { style: "currency", currency: "BYN" }).format(stats.revenue)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск по номеру, email, телефону, продукту..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        
        <QuickFilters
          presets={DEAL_PRESETS}
          fields={DEAL_FILTER_FIELDS}
          activeFilters={activeFilters}
          onFiltersChange={setActiveFilters}
          activePreset={activePreset}
          onPresetChange={setActivePreset}
        />
      </div>

      {/* Stats line */}
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <span>Найдено: <strong className="text-foreground">{filteredDeals.length}</strong></span>
      </div>

      {/* Deals Table */}
      <GlassCard className="p-0 overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : !filteredDeals.length ? (
          <div className="p-12 text-center text-muted-foreground">
            <Handshake className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p>Сделки не найдены</p>
          </div>
        ) : (
          <div 
            ref={containerRef}
            onMouseDown={handleMouseDown}
            className="overflow-x-auto select-none"
          >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={sortedDeals.length > 0 && selectedDealIds.size === sortedDeals.length}
                    onCheckedChange={() => selectedDealIds.size === sortedDeals.length ? clearSelection() : selectAll()}
                  />
                </TableHead>
                <SortableTableHead sortKey="created_at" currentSortKey={sortKey} currentSortDirection={sortDirection} onSort={handleSort}>
                  Дата
                </SortableTableHead>
                <SortableTableHead sortKey="contact_name" currentSortKey={sortKey} currentSortDirection={sortDirection} onSort={handleSort}>
                  Контакт
                </SortableTableHead>
                <SortableTableHead sortKey="product_name" currentSortKey={sortKey} currentSortDirection={sortDirection} onSort={handleSort}>
                  Продукт / Тариф
                </SortableTableHead>
                <SortableTableHead sortKey="final_price" currentSortKey={sortKey} currentSortDirection={sortDirection} onSort={handleSort} className="text-right">
                  Сумма
                </SortableTableHead>
                <SortableTableHead sortKey="status" currentSortKey={sortKey} currentSortDirection={sortDirection} onSort={handleSort}>
                  Статус
                </SortableTableHead>
                <TableHead>Оплата</TableHead>
                <SortableTableHead sortKey="trial_end_at" currentSortKey={sortKey} currentSortDirection={sortDirection} onSort={handleSort}>
                  Доступ до
                </SortableTableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedDeals.map((deal) => {
                const profile = profilesMap?.get(deal.user_id);
                const statusConfig = STATUS_CONFIG[deal.status] || { label: deal.status, color: "bg-muted", icon: Clock };
                const StatusIcon = statusConfig.icon;
                const payments = (deal.payments_v2 as any[]) || [];
                const paidPayments = payments.filter(p => p.status === "paid");

                return (
                  <TableRow 
                    key={deal.id}
                    ref={(el) => registerItemRef(deal.id, el)}
                    data-selectable-item
                    className={`cursor-pointer hover:bg-muted/50 ${selectedDealIds.has(deal.id) ? "bg-primary/10" : ""}`}
                    onClick={(e) => {
                      if (e.shiftKey) {
                        handleRangeSelect(deal.id, true);
                      } else if (e.ctrlKey || e.metaKey) {
                        toggleSelection(deal.id, true);
                      } else {
                        setSelectedDealId(deal.id);
                      }
                    }}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedDealIds.has(deal.id)}
                        onCheckedChange={() => toggleSelection(deal.id, true)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-sm">
                        <Calendar className="h-3 w-3 text-muted-foreground" />
                        {format(new Date(deal.created_at), "dd.MM.yy")}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono mt-0.5">
                        {deal.order_number}
                      </div>
                    </TableCell>
                    <TableCell 
                      onClick={(e) => {
                        e.stopPropagation();
                        if (deal.user_id && profile) {
                          navigate(`/admin/contacts?contact=${profile.user_id}&from=deals`);
                        }
                      }}
                      className={deal.user_id && profile ? "cursor-pointer hover:text-primary" : ""}
                    >
                      <div className="flex items-center gap-2">
                        <Avatar className="h-8 w-8 shrink-0">
                          {profile?.avatar_url && <AvatarImage src={profile.avatar_url} alt={profile?.full_name || ""} />}
                          <AvatarFallback className="text-xs">
                            {profile?.full_name?.[0]?.toUpperCase() || deal.customer_email?.[0]?.toUpperCase() || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="font-medium truncate">
                            {profile?.full_name || deal.customer_email || "—"}
                          </div>
                          <div className="text-sm text-muted-foreground truncate">
                            {profile?.email || deal.customer_email || "—"}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Package className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <div className="font-medium">{(deal.products_v2 as any)?.name || "—"}</div>
                          {deal.tariffs && (
                            <div className="text-xs text-muted-foreground">{(deal.tariffs as any)?.name}</div>
                          )}
                        </div>
                      </div>
                      {deal.is_trial && (
                        <Badge variant="outline" className="text-xs mt-1 text-blue-600 border-blue-500/30">Trial</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="font-medium">
                        {new Intl.NumberFormat("ru-BY", { style: "currency", currency: deal.currency }).format(Number(deal.final_price))}
                      </div>
                      {deal.discount_percent && Number(deal.discount_percent) > 0 && (
                        <div className="text-xs text-green-600">-{deal.discount_percent}%</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={statusConfig.color}>
                        <StatusIcon className="w-3 h-3 mr-1" />
                        {statusConfig.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {paidPayments.length > 0 ? (
                        <div className="flex items-center gap-1.5 text-sm">
                          <CheckCircle className="h-3 w-3 text-green-600" />
                          <span>{paidPayments.length} платеж{paidPayments.length > 1 ? "а" : ""}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {deal.trial_end_at ? (
                        <div className="text-sm">
                          {format(new Date(deal.trial_end_at), "dd.MM.yy")}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
            })}
            </TableBody>
          </Table>
          </div>
        )}
      </GlassCard>

      {/* Deal Detail Sheet */}
      <DealDetailSheet
        deal={selectedDeal || null}
        profile={selectedDeal ? profilesMap?.get(selectedDeal.user_id) : null}
        open={!!selectedDealId}
        onOpenChange={(open) => !open && setSelectedDealId(null)}
      />

      {/* Smart Import Wizard */}
      <SmartImportWizard
        open={showImportWizard}
        onOpenChange={setShowImportWizard}
      />

      {/* Selection Box for drag select */}
      {isDragging && selectionBox && (
        <SelectionBox
          startX={selectionBox.startX}
          startY={selectionBox.startY}
          endX={selectionBox.endX}
          endY={selectionBox.endY}
        />
      )}

      {/* Bulk Actions Bar */}
      <BulkActionsBar
        selectedCount={selectedCount}
        onClearSelection={clearSelection}
        onBulkDelete={() => setShowDeleteDialog(true)}
        totalCount={sortedDeals.length}
        entityName="сделок"
        onSelectAll={selectAll}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить сделки?</AlertDialogTitle>
            <AlertDialogDescription>
              Вы уверены, что хотите удалить {selectedCount} сделок? 
              Также будут удалены все связанные подписки, платежи и рассрочки. 
              Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
