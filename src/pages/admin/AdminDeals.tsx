import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { BulkEditDealsDialog } from "@/components/admin/BulkEditDealsDialog";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useTableSort } from "@/hooks/useTableSort";
import { usePermissions } from "@/hooks/usePermissions";
import { PeriodSelector, DateFilter } from "@/components/ui/period-selector";
import { DealsStatsBar } from "@/components/admin/deals/DealsStatsBar";
import { ArchiveCleanupDialog } from "@/components/admin/ArchiveCleanupDialog";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  draft: { label: "Черновик", color: "bg-muted text-muted-foreground", icon: Clock },
  pending: { label: "Ожидает оплаты", color: "bg-amber-500/20 text-amber-600", icon: Clock },
  paid: { label: "Оплачен", color: "bg-green-500/20 text-green-600", icon: CheckCircle },
  partial: { label: "Частично оплачен", color: "bg-blue-500/20 text-blue-600", icon: AlertTriangle },
  cancelled: { label: "Отменён", color: "bg-red-500/20 text-red-600", icon: XCircle },
  refunded: { label: "Возврат", color: "bg-red-500/20 text-red-600", icon: XCircle },
  expired: { label: "Истёк", color: "bg-muted text-muted-foreground", icon: XCircle },
  needs_mapping: { label: "Требует маппинга", color: "bg-purple-500/20 text-purple-600", icon: AlertTriangle },
};

export default function AdminDeals() {
  const navigate = useNavigate();
  const { canWrite, isSuperAdmin } = usePermissions();
  
  // Permission check - can user edit/delete deals?
  const canEdit = canWrite("deals") || isSuperAdmin();
  
  const [search, setSearch] = useState("");
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([]);
  const [activePreset, setActivePreset] = useState("all");
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [showImportWizard, setShowImportWizard] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showBulkEditDialog, setShowBulkEditDialog] = useState(false);
  const [showArchiveCleanupDialog, setShowArchiveCleanupDialog] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateFilter>({ from: undefined, to: undefined });
  const [showProblematic, setShowProblematic] = useState(false);
  const queryClient = useQueryClient();

  // Fetch deals (orders_v2) with related data
  const { data: deals, isLoading, refetch } = useQuery({
    queryKey: ["admin-deals", dateFilter],
    queryFn: async () => {
      let query = supabase
        .from("orders_v2")
        .select(`
          *,
          products_v2(id, name, code),
          tariffs(id, name, code, access_days),
          flows(id, name),
          payments_v2(id, status, amount, paid_at)
        `)
        .order("created_at", { ascending: false })
        .limit(1000);

      // Apply date filter
      if (dateFilter.from) {
        query = query.gte("created_at", `${dateFilter.from}T00:00:00Z`);
      }
      if (dateFilter.to) {
        query = query.lte("created_at", `${dateFilter.to}T23:59:59Z`);
      }

      const { data, error } = await query;
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

  // Fetch profiles for contact info - map by both id and user_id
  const { data: profilesMap } = useQuery({
    queryKey: ["profiles-map"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, user_id, email, full_name, phone, avatar_url");
      const map = new Map<string, any>();
      data?.forEach(p => {
        // Map by profile.id (for orders that store profile_id in user_id field)
        map.set(p.id, p);
        // Also map by user_id if it exists (for orders linked to auth users)
        if (p.user_id) {
          map.set(p.user_id, p);
        }
      });
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
    { 
      key: "reconcile_source", 
      label: "Источник", 
      type: "select",
      options: [
        { value: "bepaid_archive_import", label: "Архивный импорт (ARC-*)" },
        { value: "bepaid_import", label: "Bepaid импорт" },
        { value: "bepaid_reconcile", label: "Сверка" },
        { value: "manual", label: "Ручная" },
      ]
    },
    { key: "final_price", label: "Сумма", type: "number" },
    { key: "is_trial", label: "Триал", type: "boolean" },
    { key: "created_at", label: "Дата создания", type: "date" },
  ], [products]);

  // Subscription Health stats
  const { data: healthStats } = useQuery({
    queryKey: ["subscription-health-stats"],
    queryFn: async () => {
      const now = new Date();
      const in72h = new Date(now.getTime() + 72 * 60 * 60 * 1000);
      
      const { data } = await supabase
        .from("subscriptions_v2")
        .select("status, payment_method_id, access_end_at")
        .in("status", ["active", "trial"]);
      
      const activeWithoutCard = data?.filter(
        s => s.status === "active" && !s.payment_method_id
      ).length || 0;
      
      const trialsExpiring72h = data?.filter(s => {
        if (s.status !== "trial" || s.payment_method_id) return false;
        const endAt = new Date(s.access_end_at);
        return endAt <= in72h;
      }).length || 0;
      
      return { activeWithoutCard, trialsExpiring72h };
    },
  });

  // Auto-payment stats
  const { data: autoPaymentStats } = useQuery({
    queryKey: ["auto-payment-stats"],
    queryFn: async () => {
      const { data } = await supabase
        .from("subscriptions_v2")
        .select("id, order_id, orders_v2(final_price)")
        .eq("status", "active")
        .eq("auto_renew", true)
        .not("payment_method_id", "is", null);
      
      const count = data?.length || 0;
      const totalPlanned = data?.reduce((sum, s) => {
        const price = (s.orders_v2 as any)?.final_price;
        return sum + Number(price || 0);
      }, 0) || 0;
      
      return { count, totalPlanned };
    },
  });


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
      case "reconcile_source":
        return deal.reconcile_source || "";
      default:
        return deal[fieldKey];
    }
  }, [profilesMap]);

  // Filter deals
  const filteredDeals = useMemo(() => {
    if (!deals) return [];
    
    // PATCH 5: Filter out needs_mapping by default unless showProblematic
    let result = deals;
    if (!showProblematic) {
      result = result.filter(deal => deal.status !== 'needs_mapping');
    }
    
    // Then apply search
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
  }, [deals, search, activeFilters, profilesMap, getDealFieldValue, showProblematic]);

  // Count problematic deals
  const problematicCount = useMemo(() => {
    return deals?.filter(d => d.status === 'needs_mapping').length || 0;
  }, [deals]);

  // Navigate to problematic orders
  const navigateToProblematic = () => {
    navigate('/admin/payments/needs-mapping');
  };

  // Calculate stats from filtered deals (after filteredDeals is defined)
  const stats = useMemo(() => {
    const source = activeFilters.length > 0 || search ? filteredDeals : deals;
    if (!source || source.length === 0) {
      return { total: 0, paid: 0, pending: 0, revenue: 0 };
    }
    const total = source.length;
    const paid = source.filter(d => d.status === "paid").length;
    const pending = source.filter(d => d.status === "pending").length;
    const revenue = source
      .filter(d => d.status === "paid")
      .reduce((sum, d) => sum + Number(d.final_price || 0), 0);
    return { total, paid, pending, revenue };
  }, [deals, filteredDeals, activeFilters, search]);

  // Handle stat click to apply filters
  const handleStatClick = useCallback((filter: string) => {
    switch (filter) {
      case "all":
        setActiveFilters([]);
        setActivePreset("all");
        break;
      case "paid":
        setActiveFilters([{ field: "status", operator: "equals", value: "paid" }]);
        setActivePreset("paid");
        break;
      case "pending":
        setActiveFilters([{ field: "status", operator: "equals", value: "pending" }]);
        setActivePreset("pending");
        break;
    }
  }, []);

  // Sorting
  const { sortedData: sortedDeals, sortKey, sortDirection, handleSort } = useTableSort({
    data: filteredDeals,
    defaultSortKey: "created_at",
    defaultSortDirection: "desc",
    getFieldValue: getDealFieldValue,
  });

  // Preset counts
  const presetCounts = useMemo(() => {
    if (!deals) return { paid: 0, pending: 0, trial: 0, canceled: 0, imported: 0 };
    return {
      paid: deals.filter(d => d.status === "paid").length,
      pending: deals.filter(d => d.status === "pending").length,
      trial: deals.filter(d => d.is_trial).length,
      canceled: deals.filter(d => d.status === "canceled" || d.status === "refunded").length,
      imported: deals.filter(d => d.reconcile_source === "bepaid_archive_import").length,
    };
  }, [deals]);

  const DEAL_PRESETS: FilterPreset[] = useMemo(() => [
    { id: "all", label: "Все", filters: [] },
    { id: "paid", label: "Оплачены", filters: [{ field: "status", operator: "equals", value: "paid" }], count: presetCounts.paid },
    { id: "pending", label: "Ожидают оплаты", filters: [{ field: "status", operator: "equals", value: "pending" }], count: presetCounts.pending },
    { id: "trial", label: "Триал", filters: [{ field: "is_trial", operator: "equals", value: "true" }], count: presetCounts.trial },
    { id: "canceled", label: "Отменённые", filters: [{ field: "status", operator: "equals", value: "canceled" }], count: presetCounts.canceled },
    { id: "imported", label: "Импортированные", filters: [{ field: "reconcile_source", operator: "equals", value: "bepaid_archive_import" }], count: presetCounts.imported },
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
      console.log(`[AdminDeals] Starting deletion of ${ids.length} orders:`, ids);
      
      // 0. Get order details for notifications and GetCourse cancel
      const { data: ordersToDelete, error: fetchError } = await supabase
        .from("orders_v2")
        .select("id, user_id, product_id, order_number, status, customer_email, products_v2(name, code, telegram_club_id)")
        .in("id", ids);

      if (fetchError) {
        console.error("[AdminDeals] Failed to fetch orders for deletion:", fetchError);
        throw new Error(`Не удалось получить данные сделок: ${fetchError.message}`);
      }

      if (!ordersToDelete || ordersToDelete.length === 0) {
        throw new Error("Сделки не найдены или уже удалены");
      }

      console.log(`[AdminDeals] Found ${ordersToDelete.length} orders to delete`);

      // 0.5 Cancel in GetCourse for paid orders BEFORE deleting
      for (const order of ordersToDelete || []) {
        if (order.status === "paid") {
          console.log(`[AdminDeals] Canceling GetCourse for order ${order.order_number}`);
          await supabase.functions.invoke("getcourse-cancel-deal", {
            body: { order_id: order.id, reason: "deal_deleted_by_admin" },
          }).catch(err => console.error("GetCourse cancel error:", err));
        }
      }

      // 1. Get subscription IDs linked to these orders
      const { data: subscriptions, error: subsQueryError } = await supabase
        .from("subscriptions_v2")
        .select("id, user_id")
        .in("order_id", ids);
      
      if (subsQueryError) {
        console.error("[AdminDeals] Error fetching subscriptions:", subsQueryError);
      }
      
      const subscriptionIds = subscriptions?.map(s => s.id) || [];
      console.log(`[AdminDeals] Found ${subscriptionIds.length} subscriptions to delete`);
      
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
          console.error("[AdminDeals] Error deleting installments:", installmentsError);
          // Don't throw - continue with deletion
        }
      }
      
      // 3. Delete subscriptions
      if (subscriptionIds.length > 0) {
        const { error: subscriptionsError } = await supabase
          .from("subscriptions_v2")
          .delete()
          .in("order_id", ids);
        
        if (subscriptionsError) {
          console.error("[AdminDeals] Error deleting subscriptions:", subscriptionsError);
          throw new Error(`Ошибка удаления подписок: ${subscriptionsError.message}`);
        }
        console.log(`[AdminDeals] Deleted ${subscriptionIds.length} subscriptions`);
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
        
        // Check for other active deals before revoking Telegram access
        const telegramClubId = (order.products_v2 as any)?.telegram_club_id;
        if (order.user_id && telegramClubId) {
          // Check if user has other active deals with same product (excluding orders being deleted)
          const { count: otherActiveDeals } = await supabase
            .from('orders_v2')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', order.user_id)
            .eq('product_id', order.product_id)
            .eq('status', 'paid')
            .not('id', 'in', `(${ids.join(',')})`);

          // Check for other active subscriptions
          const { count: activeSubscriptions } = await supabase
            .from('subscriptions_v2')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', order.user_id)
            .eq('product_id', order.product_id)
            .in('status', ['active', 'trial'])
            .not('order_id', 'in', `(${ids.join(',')})`);

          // Only revoke if no other active deals/subscriptions
          if (!otherActiveDeals && !activeSubscriptions) {
            await supabase.functions.invoke("telegram-revoke-access", {
              body: { 
                user_id: order.user_id, 
                club_id: telegramClubId,
                reason: 'deal_deleted',
              },
            }).catch(console.error);
          } else {
            console.log(`[AdminDeals] Skipping TG revoke for ${order.order_number}: user has ${otherActiveDeals} other deals, ${activeSubscriptions} active subs`);
          }
        }
        
        // Notify super_admins about deal deletion
        const productName = (order.products_v2 as any)?.name || 'Продукт';
        await supabase.functions.invoke("telegram-notify-admins", {
          body: {
            message: `🗑 <b>Сделка удалена</b>\n\n` +
              `📧 ${order.customer_email || 'N/A'}\n` +
              `📦 ${productName}\n` +
              `🧾 ${order.order_number}`,
            parse_mode: 'HTML',
          },
        }).catch(console.error);
      }

      // 5. Delete payments
      const { error: paymentsError } = await supabase
        .from("payments_v2")
        .delete()
        .in("order_id", ids);
      
      if (paymentsError) {
        console.error("[AdminDeals] Error deleting payments:", paymentsError);
        // Don't throw - continue with order deletion
      } else {
        console.log(`[AdminDeals] Deleted payments for orders`);
      }

      // 6. Delete orders - CRITICAL STEP
      console.log(`[AdminDeals] Attempting to delete orders:`, ids);
      const { error, count } = await supabase
        .from("orders_v2")
        .delete()
        .in("id", ids);
      
      if (error) {
        console.error("[AdminDeals] CRITICAL: Failed to delete orders:", error);
        throw new Error(`Не удалось удалить сделки: ${error.message}. Код: ${error.code}`);
      }
      
      console.log(`[AdminDeals] Successfully deleted orders, count:`, count);
      
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
    onError: (error: any) => {
      console.error("[AdminDeals] Delete mutation error:", error);
      toast.error("Ошибка удаления: " + (error?.message || String(error)));
    },
  });

  const handleBulkDelete = () => {
    deleteMutation.mutate(Array.from(selectedDealIds));
    setShowDeleteDialog(false);
  };

  // Pill-style tabs for status filtering
  const handleTabChange = useCallback((tabId: string) => {
    setActivePreset(tabId);
    const preset = DEAL_PRESETS.find(p => p.id === tabId);
    if (preset) {
      setActiveFilters(preset.filters);
    }
  }, [DEAL_PRESETS]);

  return (
    <div className="space-y-4">
      {/* Pill-style Tabs */}
      <div className="px-1 pt-1 pb-1.5 shrink-0">
        <div className="inline-flex p-0.5 rounded-full bg-muted/40 backdrop-blur-md border border-border/20 overflow-x-auto max-w-full scrollbar-none">
          {DEAL_PRESETS.map((preset) => {
            const isActive = activePreset === preset.id;
            return (
              <button
                key={preset.id}
                onClick={() => handleTabChange(preset.id)}
                className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 whitespace-nowrap ${
                  isActive
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>{preset.label}</span>
                {preset.count !== undefined && preset.count > 0 && (
                  <Badge className="h-4 min-w-4 px-1 text-[10px] font-semibold rounded-full bg-primary/20 text-primary">
                    {preset.count > 99 ? "99+" : preset.count}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Actions row */}
      <div className="flex items-center justify-between flex-wrap gap-3 px-1">
        <div className="flex items-center gap-2 flex-wrap">
          <PeriodSelector value={dateFilter} onChange={setDateFilter} />
          {isSuperAdmin() && presetCounts.imported > 0 && (
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setShowArchiveCleanupDialog(true)}
              className="text-destructive hover:text-destructive gap-1.5 h-8"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Удалить архив</span>
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-8" onClick={() => setShowImportWizard(true)}>
            <Sparkles className="h-3.5 w-3.5 sm:mr-1.5" />
            <span className="hidden sm:inline">Импорт</span>
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={() => {
            queryClient.invalidateQueries({ queryKey: ["admin-deals"] });
            queryClient.invalidateQueries({ queryKey: ["profiles-map"] });
            queryClient.invalidateQueries({ queryKey: ["products-filter"] });
            toast.success("Данные обновлены");
          }}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Compact Stats Bar */}
      <DealsStatsBar
        stats={stats}
        healthStats={healthStats}
        autoPaymentStats={autoPaymentStats}
        onStatClick={handleStatClick}
        isLoading={isLoading}
      />

      {/* Search */}
      <div className="flex flex-col sm:flex-row gap-3 px-1">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по номеру, email, телефону, продукту..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-form-type="other"
            data-lpignore="true"
            data-1p-ignore
          />
        </div>
      </div>

      {/* Stats line with problematic toggle */}
      <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground px-1">
        <span>Найдено: <strong className="text-foreground">{filteredDeals.length}</strong></span>
        {problematicCount > 0 && (
          <div className="flex items-center gap-2">
            <Switch 
              checked={showProblematic}
              onCheckedChange={setShowProblematic}
              id="show-problematic"
            />
            <Label htmlFor="show-problematic" className="text-sm cursor-pointer">
              Показать проблемные ({problematicCount})
            </Label>
          </div>
        )}
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
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(deal.order_number);
                          toast.success("Номер скопирован");
                        }}
                        className="text-xs text-muted-foreground font-mono mt-0.5 hover:text-primary flex items-center gap-1 transition-colors"
                        title="Скопировать номер"
                      >
                        {deal.order_number}
                      </button>
                    </TableCell>
                    <TableCell 
                      onClick={(e) => {
                        e.stopPropagation();
                        if (profile) {
                          // Use profile.id for navigation (works for both archived and active contacts)
                          navigate(`/admin/contacts?contact=${profile.id}&from=deals`);
                        }
                      }}
                      className={profile ? "cursor-pointer hover:text-primary" : ""}
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
      {canEdit && (
        <BulkActionsBar
          selectedCount={selectedCount}
          onClearSelection={clearSelection}
          onBulkDelete={() => setShowDeleteDialog(true)}
          onBulkEdit={() => setShowBulkEditDialog(true)}
          totalCount={sortedDeals.length}
          entityName="сделок"
          onSelectAll={selectAll}
        />
      )}

      {/* Bulk Edit Dialog */}
      <BulkEditDealsDialog
        open={showBulkEditDialog}
        onOpenChange={setShowBulkEditDialog}
        selectedIds={Array.from(selectedDealIds)}
        onSuccess={() => {
          clearSelection();
          setShowBulkEditDialog(false);
          queryClient.invalidateQueries({ queryKey: ["admin-deals"] });
        }}
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

      {/* Archive Cleanup Dialog */}
      <ArchiveCleanupDialog 
        open={showArchiveCleanupDialog} 
        onOpenChange={setShowArchiveCleanupDialog} 
      />
    </div>
  );
}
