import { useState, useMemo, useCallback, useEffect } from "react";
import { getDealDisplayName, getShortDisplayName } from "@/lib/deals/getDealDisplayName";
import { getCategoryBadge } from "@/lib/deals/getCategoryBadge";
import { ProductCategoryBadge } from "@/components/ui/ProductCategoryBadge";
import { useNavigate, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  Trash2,
  Link2,
  Tag,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { exportToExcel, exportToCSV, ExportColumn } from "@/utils/exportTableData";
import { copyToClipboard, getDealUrl } from "@/utils/clipboardUtils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DealDetailSheet } from "@/components/admin/DealDetailSheet";
import { ContactDetailSheet } from "@/components/admin/ContactDetailSheet";
import { QuickFilters, ActiveFilter, FilterField, FilterPreset, applyFilters } from "@/components/admin/QuickFilters";
import { useDragSelect } from "@/hooks/useDragSelect";
import { SelectionBox } from "@/components/admin/SelectionBox";
import { BulkActionsBar } from "@/components/admin/BulkActionsBar";
import { BulkEditDealsDialog } from "@/components/admin/BulkEditDealsDialog";
import { BulkExtendAccessDialog } from "@/components/admin/BulkExtendAccessDialog";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useTableSort } from "@/hooks/useTableSort";
import { usePermissions } from "@/hooks/usePermissions";
import { PeriodSelector, DateFilter } from "@/components/ui/period-selector";
import { ArchiveCleanupDialog } from "@/components/admin/ArchiveCleanupDialog";
import { GlassFilterPanel } from "@/components/admin/GlassFilterPanel";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

const PAGE_SIZE = 100;

/** Profile shape from JOIN or fallback query */
interface ResolvedProfile {
  id: string;
  user_id: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
}

/** Resolve profile: JOIN first, then fallback map */
function resolveDealProfile(
  deal: any,
  fallbackMap: Map<string, ResolvedProfile> | undefined
): ResolvedProfile | null {
  if (deal.profiles && typeof deal.profiles === 'object' && deal.profiles.id) {
    return deal.profiles as ResolvedProfile;
  }
  if (deal.user_id && fallbackMap) {
    return fallbackMap.get(deal.user_id) || null;
  }
  return null;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  draft: { label: "Черновик", color: "bg-muted text-muted-foreground", icon: Clock },
  pending: { label: "Ожидает оплаты", color: "bg-amber-500/20 text-amber-600", icon: Clock },
  paid: { label: "Оплачен", color: "bg-green-500/20 text-green-600", icon: CheckCircle },
  partial: { label: "Частично оплачен", color: "bg-blue-500/20 text-blue-600", icon: AlertTriangle },
  canceled: { label: "Отменён", color: "bg-red-500/20 text-red-600", icon: XCircle },
  cancelled: { label: "Отменён", color: "bg-red-500/20 text-red-600", icon: XCircle },
  refunded: { label: "Возврат", color: "bg-red-500/20 text-red-600", icon: XCircle },
  failed: { label: "Ошибка", color: "bg-red-500/20 text-red-600", icon: XCircle },
  expired: { label: "Истёк", color: "bg-muted text-muted-foreground", icon: XCircle },
  needs_mapping: { label: "Требует маппинга", color: "bg-orange-500/20 text-orange-600", icon: AlertTriangle },
};

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] || { label: status, color: "bg-muted text-muted-foreground", icon: AlertTriangle };
}

const IMPORT_SOURCES = ['bepaid_archive_import', 'getcourse_historical', 'csv_active_import'] as const;

/** Extract payer name from latest payment (immutable sort) */
function getLatestPayerName(deal: any): string | null {
  const payments = (deal.payments_v2 as any[]) || [];
  if (payments.length === 0) return null;
  const latest = payments.reduce((best: any, p: any) => {
    const bestTs = new Date(best.paid_at || best.created_at || 0).getTime();
    const pTs = new Date(p.paid_at || p.created_at || 0).getTime();
    return pTs > bestTs ? p : best;
  });
  return latest?.card_holder || (latest?.meta as any)?.payer_name || null;
}

/**
 * Build server-side query with filters applied BEFORE pagination.
 * Returns a Supabase query builder with all filters applied.
 */
function buildDealsQuery(
  activePreset: string,
  debouncedSearch: string,
  selectedProductId: string | null,
  dateFilter: DateFilter,
) {
  // Lightweight select: only columns used in the table row
  let query = supabase
    .from("orders_v2")
    .select(`
      id,
      order_number,
      status,
      deal_date,
      created_at,
      customer_email,
      customer_phone,
      final_price,
      currency,
      discount_percent,
      is_trial,
      trial_end_at,
      product_id,
      tariff_id,
      user_id,
      profile_id,
      reconcile_source,
      purchase_snapshot,
      meta,
      products_v2(id, name, code, category),
      tariffs(id, name),
      profiles:profile_id(id, user_id, full_name, email, phone, avatar_url),
      payments_v2(id, status, paid_at, created_at, card_holder, meta)
    `);

  // Server-side preset filters
  if (activePreset === "trial") {
    query = query.eq("is_trial", true);
  } else if (activePreset === "canceled") {
    query = query.in("status", ["canceled", "refunded"]);
  } else if (activePreset === "imported") {
    query = query.in("reconcile_source", [...IMPORT_SOURCES]);
  }

  // Product filter
  if (selectedProductId) {
    query = query.eq("product_id", selectedProductId);
  }

  // Date filter
  if (dateFilter.from) {
    query = query.gte("deal_date", `${dateFilter.from}T00:00:00Z`);
  }
  if (dateFilter.to) {
    query = query.lte("deal_date", `${dateFilter.to}T23:59:59Z`);
  }

  // Server-side search — applied on DB, not on client
  if (debouncedSearch) {
    const s = debouncedSearch.trim();
    query = query.or(
      `order_number.ilike.%${s}%,customer_email.ilike.%${s}%,customer_phone.ilike.%${s}%`
    );
  }

  return query;
}

export default function AdminDeals() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { canWrite, isSuperAdmin } = usePermissions();
  const canEdit = canWrite("deals") || isSuperAdmin();

  const [search, setSearch] = useState("");
  const [activePreset, setActivePreset] = useState("all");
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showBulkEditDialog, setShowBulkEditDialog] = useState(false);
  const [showBulkExtendDialog, setShowBulkExtendDialog] = useState(false);
  const [showArchiveCleanupDialog, setShowArchiveCleanupDialog] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateFilter>({ from: undefined, to: undefined });
  const [displayLimit, setDisplayLimit] = useState(PAGE_SIZE);

  // Contact sheet state
  const [contactSheetOpen, setContactSheetOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<any>(null);

  const queryClient = useQueryClient();
  const debouncedSearch = useDebouncedValue(search, 200);

  // Reset display limit when filters change
  useEffect(() => {
    setDisplayLimit(PAGE_SIZE);
  }, [activePreset, debouncedSearch, selectedProductId, dateFilter]);

  // Check for deal query param to auto-open deal card
  const dealFromUrl = searchParams.get("deal");
  useEffect(() => {
    if (dealFromUrl) {
      setSelectedDealId(dealFromUrl);
    }
  }, [dealFromUrl]);

  // ─── Server-side tab counts via RPC ───
  const { data: tabCounts } = useQuery({
    queryKey: ["admin-deals-tab-counts", debouncedSearch, selectedProductId, dateFilter],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_deal_tab_counts", {
        p_search: debouncedSearch || null,
        p_product_id: selectedProductId || null,
        p_date_from: dateFilter.from ? `${dateFilter.from}T00:00:00Z` : null,
        p_date_to: dateFilter.to ? `${dateFilter.to}T23:59:59Z` : null,
      });
      if (error) {
        console.error("[AdminDeals] tab counts error:", error);
        return null;
      }
      return data as { all: number; paid: number; pending: number; failed: number; trial: number; canceled: number; imported: number };
    },
    staleTime: 30_000,
  });

  // ─── Transform RPC flat row into nested shape matching PostgREST ───
  function rpcRowToNested(r: any): any {
    return {
      id: r.id,
      order_number: r.order_number,
      status: r.status,
      deal_date: r.deal_date,
      created_at: r.created_at,
      customer_email: r.customer_email,
      customer_phone: r.customer_phone,
      final_price: r.final_price,
      currency: r.currency,
      discount_percent: r.discount_percent,
      is_trial: r.is_trial,
      trial_end_at: r.trial_end_at,
      product_id: r.product_id,
      tariff_id: r.tariff_id,
      user_id: r.user_id,
      profile_id: r.profile_id,
      reconcile_source: r.reconcile_source,
      purchase_snapshot: r.purchase_snapshot,
      meta: r.meta,
      products_v2: r.product_name ? { id: r.product_id, name: r.product_name, code: r.product_code } : null,
      tariffs: r.tariff_name ? { id: r.tariff_id, name: r.tariff_name } : null,
      profiles: r.profile_full_name != null || r.profile_email != null
        ? { id: r.profile_id, user_id: r.profile_user_id, full_name: r.profile_full_name, email: r.profile_email, phone: r.profile_phone, avatar_url: r.profile_avatar_url }
        : null,
      payments_v2: r.latest_payment_id
        ? [{ id: r.latest_payment_id, status: r.latest_payment_status, paid_at: r.latest_payment_paid_at, created_at: r.latest_payment_paid_at, card_holder: r.latest_payment_card_holder, meta: r.latest_payment_meta }]
        : [],
    };
  }

  // ─── Server-side paginated rows via useInfiniteQuery ───
  const isSearchMode = Boolean(debouncedSearch);

  const {
    data: dealsData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: ["admin-deals", activePreset, debouncedSearch, selectedProductId, dateFilter],
    queryFn: async ({ pageParam = 0 }) => {
      // When search is active → use RPC for full-name search across profiles
      if (debouncedSearch) {
        const { data, error } = await supabase.rpc("search_deal_rows", {
          p_search: debouncedSearch.trim(),
          p_product_id: selectedProductId || null,
          p_date_from: dateFilter.from ? `${dateFilter.from}T00:00:00Z` : null,
          p_date_to: dateFilter.to ? `${dateFilter.to}T23:59:59Z` : null,
          p_preset: activePreset || "all",
          p_limit: PAGE_SIZE,
          p_offset: pageParam,
        });
        if (error) throw error;
        const rows = (data || []).map(rpcRowToNested);
        return {
          rows,
          nextOffset: rows.length === PAGE_SIZE ? pageParam + PAGE_SIZE : undefined,
        };
      }

      // Default mode → lightweight PostgREST query (no name search needed)
      const query = buildDealsQuery(activePreset, debouncedSearch, selectedProductId, dateFilter);
      const { data, error } = await query
        .order("deal_date", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false })
        .range(pageParam, pageParam + PAGE_SIZE - 1);

      if (error) throw error;
      return {
        rows: data || [],
        nextOffset: (data?.length || 0) === PAGE_SIZE ? pageParam + PAGE_SIZE : undefined,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    initialPageParam: 0,
  });

  // Flat array of all loaded deals
  const allDeals = useMemo(
    () => dealsData?.pages.flatMap((p) => p.rows) || [],
    [dealsData]
  );

  // Fetch products for filter pills
  const { data: products } = useQuery({
    queryKey: ["products-filter"],
    queryFn: async () => {
      const { data } = await supabase
        .from("products_v2")
        .select("id, name")
        .eq("is_active", true);
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
  });

  // Fallback: fetch profiles ONLY for deals without profile_id but with user_id
  const missingUserIds = useMemo(() => {
    const ids = new Set<string>();
    for (const d of allDeals) {
      if (!d.profile_id && d.user_id) {
        ids.add(d.user_id);
      }
    }
    return Array.from(ids);
  }, [allDeals]);

  const { data: fallbackProfilesMap } = useQuery({
    queryKey: ["deals-fallback-profiles", missingUserIds],
    queryFn: async () => {
      const map = new Map<string, ResolvedProfile>();
      if (missingUserIds.length === 0) return map;
      const CHUNK = 300;
      const addToMap = (profiles: any[] | null) => {
        profiles?.forEach(p => {
          const rp = p as ResolvedProfile;
          if (p.user_id) map.set(p.user_id, rp);
          map.set(p.id, rp);
        });
      };
      for (let i = 0; i < missingUserIds.length; i += CHUNK) {
        const chunk = missingUserIds.slice(i, i + CHUNK);
        const [byUser, byId] = await Promise.all([
          supabase
            .from("profiles")
            .select("id, user_id, full_name, email, phone, avatar_url")
            .in("user_id", chunk),
          supabase
            .from("profiles")
            .select("id, user_id, full_name, email, phone, avatar_url")
            .in("id", chunk),
        ]);
        addToMap(byUser.data);
        addToMap(byId.data);
      }
      return map;
    },
    enabled: missingUserIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  // Get field value for sorting
  const getDealFieldValue = useCallback((deal: any, fieldKey: string): any => {
    switch (fieldKey) {
      case "contact_name":
        const profile = resolveDealProfile(deal, fallbackProfilesMap);
        const payerName = getLatestPayerName(deal);
        return profile?.full_name || payerName || deal.customer_email || "";
      case "product_name":
        return (deal.products_v2 as any)?.name || "";
      case "tariff_name":
        return (deal.tariffs as any)?.name || "";
      default:
        return deal[fieldKey];
    }
  }, [fallbackProfilesMap]);

  // Export columns
  const getDealsExportColumns = useCallback((): ExportColumn<any>[] => [
    { header: "Дата", getValue: (d) => format(new Date(getEffectiveDealDate(d)), "dd.MM.yyyy HH:mm") },
    { header: "Номер", getValue: (d) => d.order_number || "" },
    { header: "Контакт", getValue: (d) => { const p = resolveDealProfile(d, fallbackProfilesMap); return p?.full_name || getLatestPayerName(d) || ""; } },
    { header: "Email", getValue: (d) => { const p = resolveDealProfile(d, fallbackProfilesMap); return d.customer_email || p?.email || ""; } },
    { header: "Телефон", getValue: (d) => { const p = resolveDealProfile(d, fallbackProfilesMap); return p?.phone || ""; } },
    { header: "Продукт", getValue: (d) => getDealDisplayName({
      productsV2: d.products_v2 as any,
      purchaseSnapshot: d.purchase_snapshot,
      fallback: "",
    }) },
    { header: "Категория", getValue: (d) => {
      const cat = (d.products_v2 as any)?.category;
      const badge = cat ? getCategoryBadge(cat) : null;
      return badge?.label || "";
    } },
    { header: "Тариф", getValue: (d) => (d.tariffs as any)?.name || "" },
    { header: "Сумма", getValue: (d) => d.final_price ?? "" },
    { header: "Валюта", getValue: (d) => d.currency || "" },
    { header: "Статус", getValue: (d) => getStatusConfig(d.status).label },
    { header: "Доступ до", getValue: (d) => d.trial_end_at ? format(new Date(d.trial_end_at), "dd.MM.yyyy") : "" },
  ], [fallbackProfilesMap]);

  // Sorting on loaded data
  const { sortedData: sortedDeals, sortKey, sortDirection, handleSort } = useTableSort({
    data: allDeals,
    defaultSortKey: "deal_date",
    defaultSortDirection: "desc",
    getFieldValue: getDealFieldValue,
  });

  // Visible deals — limited to displayLimit
  const visibleDeals = useMemo(() => sortedDeals.slice(0, displayLimit), [sortedDeals, displayLimit]);

  // Preset tab definitions with server-side counts
  const DEAL_PRESETS: FilterPreset[] = useMemo(() => [
    { id: "all", label: "Все", filters: [], count: tabCounts?.all },
    { id: "trial", label: "Триал", filters: [], count: tabCounts?.trial },
    { id: "canceled", label: "Отменённые", filters: [], count: tabCounts?.canceled },
    { id: "imported", label: "Импортированные", filters: [], count: tabCounts?.imported },
  ], [tabCounts]);

  const selectedDeal = allDeals.find(d => d.id === selectedDealId);

  // Drag select
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
    items: visibleDeals,
    getItemId: (deal) => deal.id,
  });

  // Bulk delete mutation (unchanged business logic)
  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      console.log(`[AdminDeals] Starting deletion of ${ids.length} orders:`, ids);
      
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

      for (const order of ordersToDelete || []) {
        if (order.status === "paid") {
          console.log(`[AdminDeals] Canceling GetCourse for order ${order.order_number}`);
          await supabase.functions.invoke("getcourse-cancel-deal", {
            body: { order_id: order.id, reason: "deal_deleted_by_admin" },
          }).catch(e => console.warn("[AdminDeals] GetCourse cancel failed:", e));
        }
      }

      const { data: subscriptions, error: subsQueryError } = await supabase
        .from("subscriptions_v2")
        .select("id")
        .in("order_id", ids);

      if (subsQueryError) {
        console.error("[AdminDeals] Error fetching subscriptions:", subsQueryError);
      }

      const subscriptionIds = subscriptions?.map(s => s.id) || [];
      console.log(`[AdminDeals] Found ${subscriptionIds.length} subscriptions to delete`);

      const uniqueUserIds = [...new Set(ordersToDelete.filter(o => o.user_id).map(o => o.user_id!))];

      if (subscriptionIds.length > 0) {
        // Delete installment_schedules via raw RPC since table may not be in generated types
        const { error: installmentsError } = await (supabase as any)
          .from("installment_schedules")
          .delete()
          .in("subscription_id", subscriptionIds);
        if (installmentsError) {
          console.error("[AdminDeals] Error deleting installments:", installmentsError);
        }

        const { error: subscriptionsError } = await supabase
          .from("subscriptions_v2")
          .delete()
          .in("id", subscriptionIds);
        if (subscriptionsError) {
          console.error("[AdminDeals] Error deleting subscriptions:", subscriptionsError);
          throw new Error(`Ошибка удаления подписок: ${subscriptionsError.message}`);
        }
        console.log(`[AdminDeals] Deleted ${subscriptionIds.length} subscriptions`);
      }

      // Revoke TG access for users that have no other active deals
      for (const order of ordersToDelete) {
        const product = order.products_v2 as any;
        if (product?.telegram_club_id && order.user_id) {
          const { count: otherActiveDeals } = await supabase
            .from("orders_v2")
            .select("*", { count: "exact", head: true })
            .eq("user_id", order.user_id)
            .eq("status", "paid")
            .not("id", "in", `(${ids.join(",")})`);

          const { count: activeSubscriptions } = await supabase
            .from("subscriptions_v2")
            .select("*", { count: "exact", head: true })
            .eq("user_id", order.user_id)
            .eq("status", "active");

          if ((otherActiveDeals || 0) === 0 && (activeSubscriptions || 0) === 0) {
            const { data: prof } = await supabase
              .from("profiles")
              .select("telegram_user_id")
              .eq("user_id", order.user_id)
              .single();

            if (prof?.telegram_user_id) {
              supabase.functions.invoke("telegram-club-access", {
                body: {
                  action: "revoke",
                  telegram_user_id: prof.telegram_user_id,
                  telegram_club_id: product.telegram_club_id,
                  reason: "deal_deleted",
                },
              }).catch(console.error);
            }
          } else {
            console.log(`[AdminDeals] Skipping TG revoke for ${order.order_number}: user has ${otherActiveDeals} other deals, ${activeSubscriptions} active subs`);
          }
        }
      }

      // Delete access ledger entries
      const { error: ledgerError } = await supabase
        .from("access_grant_ledger")
        .delete()
        .in("order_id", ids);
      if (ledgerError) console.error("[AdminDeals] Error deleting ledger entries:", ledgerError);

      // Delete entitlements
      const { error: entError } = await supabase
        .from("entitlements")
        .delete()
        .in("order_id", ids);
      if (entError) console.error("[AdminDeals] Error deleting entitlements:", entError);

      // Delete payments
      const { error: paymentsError } = await supabase
        .from("payments_v2")
        .delete()
        .in("order_id", ids);
      if (paymentsError) {
        console.error("[AdminDeals] Error deleting payments:", paymentsError);
      } else {
        console.log(`[AdminDeals] Deleted payments for orders`);
      }

      // Delete orders
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

      // Send notifications
      for (const userId of uniqueUserIds) {
        supabase.functions.invoke("send-access-revoked-notification", {
          body: { user_id: userId, reason: "deal_deleted" },
        }).catch(console.error);
      }

      return { deleted: ids.length };
    },
    onSuccess: (result) => {
      toast.success(`Удалено ${result.deleted} сделок`);
      clearSelection();
      queryClient.invalidateQueries({ queryKey: ["admin-deals"] });
      queryClient.invalidateQueries({ queryKey: ["admin-deals-tab-counts"] });
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

  const handleTabChange = useCallback((tabId: string) => {
    setActivePreset(tabId);
  }, []);

  // Total count from server-side RPC
  const totalCount = useMemo(() => {
    if (!tabCounts) return undefined;
    switch (activePreset) {
      case "trial": return tabCounts.trial;
      case "canceled": return tabCounts.canceled;
      case "imported": return tabCounts.imported;
      default: return tabCounts.all;
    }
  }, [tabCounts, activePreset]);

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

      {/* Product Pills Filter */}
      {products && products.length > 0 && (
        <GlassFilterPanel className="mx-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Tag className="h-4 w-4 text-muted-foreground shrink-0" />
            <button
              onClick={() => setSelectedProductId(null)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 whitespace-nowrap ${
                !selectedProductId
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              Все продукты
            </button>
            {products.map((product) => {
              const isActive = selectedProductId === product.id;
              return (
                <button
                  key={product.id}
                  onClick={() => setSelectedProductId(isActive ? null : product.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 whitespace-nowrap ${
                    isActive
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  <span>{product.name}</span>
                </button>
              );
            })}
          </div>
        </GlassFilterPanel>
      )}

      {/* Actions row */}
      <div className="flex items-center justify-between flex-wrap gap-3 px-1">
        <div className="flex items-center gap-2 flex-wrap">
          <PeriodSelector value={dateFilter} onChange={setDateFilter} />
          {isSuperAdmin() && tabCounts && tabCounts.imported > 0 && (
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8" disabled={allDeals.length === 0}>
                <Download className="h-3.5 w-3.5 sm:mr-1.5" />
                <span className="hidden sm:inline">Экспорт</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={async () => {
                const cols = getDealsExportColumns();
                await exportToExcel(allDeals, cols, `sdelki_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
                toast.success(`Экспортировано ${allDeals.length} записей`);
              }}>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Excel (.xlsx)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                const cols = getDealsExportColumns();
                exportToCSV(allDeals, cols, `sdelki_${format(new Date(), "yyyy-MM-dd")}.csv`);
                toast.success(`Экспортировано ${allDeals.length} записей`);
              }}>
                <FileText className="h-4 w-4 mr-2" />
                CSV (.csv)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" className="h-8" onClick={() => {
            queryClient.invalidateQueries({ queryKey: ["admin-deals"] });
            queryClient.invalidateQueries({ queryKey: ["admin-deals-tab-counts"] });
            queryClient.invalidateQueries({ queryKey: ["deals-fallback-profiles"] });
            toast.success("Данные обновлены");
          }}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="flex flex-col sm:flex-row gap-3 px-1">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по номеру, email, телефону..."
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

      {/* Stats line */}
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <span>
          Показано: <strong className="text-foreground">{Math.min(displayLimit, allDeals.length)}</strong>
          {totalCount !== undefined && (
            <> из <strong className="text-foreground">{totalCount}</strong></>
          )}
        </span>
      </div>

      {/* Deals Table */}
      <GlassCard className="p-0 overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : !allDeals.length ? (
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
                    checked={visibleDeals.length > 0 && selectedDealIds.size === visibleDeals.length}
                    onCheckedChange={() => selectedDealIds.size === visibleDeals.length ? clearSelection() : selectAll()}
                  />
                </TableHead>
                <SortableTableHead sortKey="deal_date" currentSortKey={sortKey} currentSortDirection={sortDirection} onSort={handleSort}>
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
              {visibleDeals.map((deal) => {
                const profile = resolveDealProfile(deal, fallbackProfilesMap);
                const statusConfig = getStatusConfig(deal.status);
                const StatusIcon = statusConfig.icon;
                const payments = (deal.payments_v2 as any[]) || [];
                const paidPayments = payments.filter(p => p.status === "paid");
                const payerName = getLatestPayerName(deal);

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
                      <div className="flex items-center gap-1">
                        <Checkbox
                          checked={selectedDealIds.has(deal.id)}
                          onCheckedChange={() => toggleSelection(deal.id, true)}
                        />
                        <button
                          className="p-1 hover:bg-muted rounded opacity-50 hover:opacity-100 transition-opacity"
                          onClick={(e) => {
                            e.stopPropagation();
                            copyToClipboard(getDealUrl(deal.id), "Ссылка скопирована");
                          }}
                          title="Скопировать ссылку"
                        >
                          <Link2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-sm">
                        <Calendar className="h-3 w-3 text-muted-foreground" />
                        {format(new Date(getEffectiveDealDate(deal)), "dd.MM.yy")}
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
                        e.preventDefault();
                        e.stopPropagation();
                        if (profile) {
                          setSelectedContact(profile);
                          setContactSheetOpen(true);
                        }
                      }}
                      className={profile ? "cursor-pointer hover:text-primary" : ""}
                    >
                      <div className="flex items-center gap-2">
                        <Avatar className="h-8 w-8 shrink-0">
                          {profile?.avatar_url && <AvatarImage src={profile.avatar_url} alt={profile?.full_name || ""} />}
                          <AvatarFallback className="text-xs">
                            {(profile?.full_name || payerName)?.[0]?.toUpperCase() || deal.customer_email?.[0]?.toUpperCase() || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="font-medium truncate">
                            {profile?.full_name || payerName || deal.customer_email || (deal.customer_phone && !deal.customer_email ? deal.customer_phone : null) || "—"}
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
                          <div className="font-medium flex items-center gap-1.5 flex-wrap">
                            <ProductCategoryBadge category={(deal.products_v2 as any)?.category} />
                            <span>{getShortDisplayName(getDealDisplayName({
                              productsV2: deal.products_v2 as any,
                              purchaseSnapshot: deal.purchase_snapshot,
                            }), (deal.products_v2 as any)?.category)}</span>
                          </div>
                          {deal.tariffs && (
                            <div className="text-xs text-muted-foreground">{(deal.tariffs as any)?.name}</div>
                          )}
                          {(() => {
                            const snapshot = deal.purchase_snapshot as Record<string, any> | null;
                            const meta = deal.meta as Record<string, any> | null;
                            if (meta?.split_status === 'children_created') {
                              return <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300 mt-0.5">📦 Разделена на модули</Badge>;
                            }
                            if (meta?.split_from_order_id) {
                              return <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-300 mt-0.5">📄 Модуль (split)</Badge>;
                            }
                            if (snapshot?.historical_purchase_type === 'module_only_standalone') {
                              return (
                                <>
                                  <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300 mt-0.5">Модульная покупка</Badge>
                                  {!snapshot?.display_purchase_name && (
                                    <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-400 bg-amber-50 mt-0.5">⚠ Historical name missing</Badge>
                                  )}
                                </>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      </div>
                      {deal.is_trial && (
                        <Badge variant="outline" className="text-xs mt-1 text-blue-600 border-blue-500/30">Trial</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="font-medium">
                        {new Intl.NumberFormat("ru-BY", { style: "currency", currency: deal.currency || "BYN" }).format(Number(deal.final_price))}
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

      {/* Show More button — reuses Contacts pattern */}
      {(() => {
        const loadedCount = Math.min(displayLimit, allDeals.length);
        const remaining = (totalCount ?? allDeals.length) - loadedCount;
        if (remaining <= 0 && allDeals.length <= displayLimit && !hasNextPage) return null;
        const showRemaining = allDeals.length > displayLimit 
          ? allDeals.length - displayLimit 
          : remaining;
        if (showRemaining <= 0 && !hasNextPage) return null;
        return (
          <div className="flex justify-center py-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDisplayLimit((prev) => {
                  const next = prev + PAGE_SIZE;
                  if (next >= allDeals.length && hasNextPage) {
                    fetchNextPage();
                  }
                  return next;
                });
              }}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Загрузка...</>
              ) : (
                <>Показать ещё {showRemaining > 0 ? `(${showRemaining > 99 ? "99+" : showRemaining} осталось)` : ""}</>
              )}
            </Button>
          </div>
        );
      })()}

      {/* Deal Detail Sheet */}
      <DealDetailSheet
        deal={selectedDeal || null}
        profile={selectedDeal ? resolveDealProfile(selectedDeal, fallbackProfilesMap) : null}
        open={!!selectedDealId}
        onOpenChange={(open) => !open && setSelectedDealId(null)}
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
          onBulkExtendAccess={() => setShowBulkExtendDialog(true)}
          totalCount={visibleDeals.length}
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
          queryClient.invalidateQueries({ queryKey: ["admin-deals-tab-counts"] });
        }}
      />

      {/* Bulk Extend Access Dialog */}
      <BulkExtendAccessDialog
        open={showBulkExtendDialog}
        onOpenChange={setShowBulkExtendDialog}
        selectedOrderIds={Array.from(selectedDealIds)}
        onSuccess={() => {
          clearSelection();
          setShowBulkExtendDialog(false);
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

      {/* Contact Detail Sheet */}
      <ContactDetailSheet
        contact={selectedContact}
        open={contactSheetOpen}
        onOpenChange={(open) => {
          setContactSheetOpen(open);
          if (!open) {
            setSelectedContact(null);
          }
        }}
      />
    </div>
  );
}
