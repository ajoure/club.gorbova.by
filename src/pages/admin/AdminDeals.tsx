import { useState, useMemo, useCallback, useEffect } from "react";
import { getDealDisplayName, getShortDisplayName } from "@/lib/deals/getDealDisplayName";
import { useModuleDisplayMeta } from "@/hooks/useModuleDisplayMeta";
import { getCategoryBadge } from "@/lib/deals/getCategoryBadge";
import { ProductCategoryBadge } from "@/components/ui/ProductCategoryBadge";
import { useNavigate, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { useQuery, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useDealsBulkDelete } from "@/hooks/useDealsBulkDelete";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  List,
  Kanban,
  ChevronDown,
  Plus,
  SlidersHorizontal,
  X,
  Pencil,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { exportToExcel, exportToCSV, ExportColumn } from "@/utils/exportTableData";
import { copyToClipboard, getDealUrl } from "@/utils/clipboardUtils";
import { getEffectiveDealDate } from "@/utils/getEffectiveDealDate";
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
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePipelines } from "@/hooks/usePipelines";
import { usePipelineStages } from "@/hooks/usePipelineStages";
import { DealsKanbanBoard } from "@/components/admin/deals/DealsKanbanBoard";
import { PipelineManagementPopover } from "@/components/admin/deals/PipelineManagementPopover";
import { DealsFiltersBar } from "@/components/admin/deals/DealsFiltersBar";
import { useDealsFilters, type DealsExtraFilters } from "@/hooks/useDealsFilters";
import { applyExtraDealFilters } from "@/utils/applyExtraDealFilters";

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
  tariffIds?: string[],
  pipelineId?: string | null,
  isDefaultPipeline?: boolean,
  extraFilters?: DealsExtraFilters,
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
      pipeline_id,
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

  // Tariff filter
  if (tariffIds && tariffIds.length > 0) {
    query = query.in("tariff_id", tariffIds);
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

  // Pipeline filter
  if (pipelineId) {
    if (isDefaultPipeline) {
      query = query.or(`pipeline_id.eq.${pipelineId},pipeline_id.is.null`);
    } else {
      query = query.eq("pipeline_id", pipelineId);
    }
  }

  // Apply canonical extra filters (status, created range, price, stage,
  // exact contact, advanced source/provider/recon, synthetic exclusion)
  if (extraFilters) {
    query = applyExtraDealFilters(query, extraFilters);
  }

  return query;
}

export default function AdminDeals() {
  const navigate = useNavigate();
  const { canWrite, isSuperAdmin } = usePermissions();
  const canEdit = canWrite("deals") || isSuperAdmin();

  const [search, setSearch] = useState("");
  const [activePreset, setActivePreset] = useState("all");
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showBulkEditDialog, setShowBulkEditDialog] = useState(false);
  const [showBulkExtendDialog, setShowBulkExtendDialog] = useState(false);
  const [showArchiveCleanupDialog, setShowArchiveCleanupDialog] = useState(false);
  const [displayLimit, setDisplayLimit] = useState(PAGE_SIZE);

  // View mode & filters from URL
  const [searchParams, setSearchParams] = useSearchParams();
  const viewMode = (searchParams.get("view") === "board" ? "board" : "list") as "list" | "board";
  const selectedPipelineId = searchParams.get("pipeline") || null;
  const selectedProductId = searchParams.get("product") || null;
  const selectedTariffIds = useMemo(() => {
    const raw = searchParams.get("tariffs");
    if (!raw) return [] as string[];
    return raw.split(",").filter(Boolean);
  }, [searchParams]);

  // dateFilter from URL
  const dateFilter = useMemo<DateFilter>(() => {
    const from = searchParams.get("date_from") || undefined;
    const to = searchParams.get("date_to") || undefined;
    return { from, to };
  }, [searchParams]);
  const setDateFilter = useCallback((df: DateFilter) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (df.from) next.set("date_from", df.from);
      else next.delete("date_from");
      if (df.to) next.set("date_to", df.to);
      else next.delete("date_to");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setViewMode = useCallback((mode: "list" | "board") => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("view", mode);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setSelectedPipelineId = useCallback((id: string | null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set("pipeline", id);
      else next.delete("pipeline");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setSelectedProductId = useCallback((id: string | null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set("product", id);
      else next.delete("product");
      // Clear tariffs when product changes
      next.delete("tariffs");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setSelectedTariffIds = useCallback((ids: string[]) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (ids.length > 0) next.set("tariffs", ids.join(","));
      else next.delete("tariffs");
      return next;
    }, { replace: true });
  }, [setSearchParams]);


  // Canonical extra filters (URL-synced)
  const { filters: extraFilters, updateFilters: updateExtraFilters, resetExtraFilters, activeCount: extraActiveCount } = useDealsFilters();

  // Pipelines
  const { pipelines, isLoading: pipelinesLoading, createPipeline: createPipelineFn, renamePipeline: renamePipelineFn, deletePipeline: deletePipelineFn, reorderPipelines: reorderPipelinesFn } = usePipelines();
  const activePipelineId = selectedPipelineId || pipelines.find((p) => p.is_default)?.id || pipelines[0]?.id || null;
  const { stages: activePipelineStages = [] } = usePipelineStages(activePipelineId);

  // Deal counts per pipeline (for delete guards)
  const { data: pipelineDealCounts } = useQuery({
    queryKey: ["pipeline-deal-counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders_v2")
        .select("pipeline_id")
        .not("pipeline_id", "is", null);
      if (error) throw error;
      const counts = new Map<string, number>();
      (data || []).forEach((d: any) => {
        counts.set(d.pipeline_id, (counts.get(d.pipeline_id) || 0) + 1);
      });
      return counts;
    },
    staleTime: 30_000,
  });

  // Bound pipeline IDs (for delete guards)
  const { data: boundPipelineIds } = useQuery({
    queryKey: ["pipeline-bindings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_pipeline_product_bindings")
        .select("pipeline_id");
      if (error) throw error;
      return new Set((data || []).map((d: any) => d.pipeline_id));
    },
    staleTime: 30_000,
  });

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
      pipeline_id: r.pipeline_id,
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
    queryKey: ["admin-deals", activePreset, debouncedSearch, selectedProductId, selectedTariffIds, dateFilter, activePipelineId, extraFilters],
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
        // Client-side tariff filter for RPC results
        let filtered = selectedTariffIds.length > 0
          ? rows.filter((r: any) => selectedTariffIds.includes(r.tariff_id))
          : rows;
        // Client-side pipeline filter for RPC results (RPC doesn't support pipeline param)
        if (activePipelineId) {
          const isDefault = activePipeline?.is_default;
          filtered = filtered.filter((r: any) => {
            if (isDefault) return r.pipeline_id === activePipelineId || !r.pipeline_id;
            return r.pipeline_id === activePipelineId;
          });
        }
        // Client-side extra filters for RPC results (mirror server-side semantics)
        if (extraFilters.statuses.length > 0) {
          const set = new Set(extraFilters.statuses);
          filtered = filtered.filter((r: any) => set.has(r.status));
        }
        if (extraFilters.createdFrom) {
          const ts = new Date(`${extraFilters.createdFrom}T00:00:00Z`).getTime();
          filtered = filtered.filter((r: any) => new Date(r.created_at).getTime() >= ts);
        }
        if (extraFilters.createdTo) {
          const ts = new Date(`${extraFilters.createdTo}T23:59:59Z`).getTime();
          filtered = filtered.filter((r: any) => new Date(r.created_at).getTime() <= ts);
        }
        if (extraFilters.priceMin != null) filtered = filtered.filter((r: any) => Number(r.final_price ?? 0) >= extraFilters.priceMin!);
        if (extraFilters.priceMax != null) filtered = filtered.filter((r: any) => Number(r.final_price ?? 0) <= extraFilters.priceMax!);
        if (extraFilters.stageId) filtered = filtered.filter((r: any) => r.pipeline_stage_id === extraFilters.stageId);
        if (extraFilters.contactProfileId) filtered = filtered.filter((r: any) => r.profile_id === extraFilters.contactProfileId);
        else if (extraFilters.contactEmail) filtered = filtered.filter((r: any) => r.customer_email === extraFilters.contactEmail);
        if (extraFilters.source) filtered = filtered.filter((r: any) => r.meta?.source === extraFilters.source);
        if (extraFilters.provider) filtered = filtered.filter((r: any) => r.meta?.payment_provider === extraFilters.provider);
        if (extraFilters.reconcileSource) filtered = filtered.filter((r: any) => r.reconcile_source === extraFilters.reconcileSource);
        if (!extraFilters.includeSynthetic) filtered = filtered.filter((r: any) => r.meta?.source !== "rule_engine");
        return {
          rows: filtered,
          nextOffset: rows.length === PAGE_SIZE ? pageParam + PAGE_SIZE : undefined,
        };
      }

      // Default mode → lightweight PostgREST query (no name search needed)
      const query = buildDealsQuery(activePreset, debouncedSearch, selectedProductId, dateFilter, selectedTariffIds, activePipelineId, activePipeline?.is_default, extraFilters);
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

  const { data: moduleMetaMap } = useModuleDisplayMeta(allDeals);

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

  // Fetch tariffs for filter (depends on selected product)
  const { data: tariffs } = useQuery({
    queryKey: ["tariffs-filter", selectedProductId],
    queryFn: async () => {
      let q = supabase.from("tariffs").select("id, name, product_id");
      if (selectedProductId) q = q.eq("product_id", selectedProductId);
      const { data } = await q.order("name");
      return data || [];
    },
    enabled: !!selectedProductId,
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

  // Access map: order_id → { access_until: string, source: 'subscription'|'entitlement'|'trial' }
  const dealIdsForAccess = useMemo(() => allDeals.map((d: any) => d.id), [allDeals]);
  const { data: accessMap } = useQuery({
    queryKey: ["deals-access-map", dealIdsForAccess.length, dealIdsForAccess.slice(0, 5).join(",")],
    queryFn: async () => {
      const map = new Map<string, { access_until: string | null; source: string }>();
      if (dealIdsForAccess.length === 0) return map;
      const CHUNK = 200;
      for (let i = 0; i < dealIdsForAccess.length; i += CHUNK) {
        const chunk = dealIdsForAccess.slice(i, i + CHUNK);
        const [subsRes, entRes] = await Promise.all([
          supabase
            .from("subscriptions_v2")
            .select("order_id, access_end_at, status")
            .in("order_id", chunk),
          supabase
            .from("entitlements")
            .select("order_id, expires_at")
            .in("order_id", chunk),
        ]);
        (subsRes.data || []).forEach((s: any) => {
          if (!s.access_end_at) return;
          const cur = map.get(s.order_id);
          if (!cur || (cur.access_until && new Date(s.access_end_at) > new Date(cur.access_until))) {
            map.set(s.order_id, { access_until: s.access_end_at, source: "subscription" });
          }
        });
        (entRes.data || []).forEach((e: any) => {
          if (!e.expires_at) return;
          const cur = map.get(e.order_id);
          if (!cur || (cur.access_until && new Date(e.expires_at) > new Date(cur.access_until))) {
            map.set(e.order_id, { access_until: e.expires_at, source: cur?.source || "entitlement" });
          }
        });
      }
      return map;
    },
    enabled: dealIdsForAccess.length > 0,
    staleTime: 60_000,
  });

  // Get field value for sorting
  const getDealFieldValue = useCallback((deal: any, fieldKey: string): any => {
    switch (fieldKey) {
      case "contact_name":
        const profile = resolveDealProfile(deal, fallbackProfilesMap);
        const payerName = getLatestPayerName(deal);
        return profile?.full_name || payerName || deal.customer_email || "";
      case "product_name":
        return getDealDisplayName({ productsV2: deal.products_v2 as any, purchaseSnapshot: deal.purchase_snapshot, moduleProduct: moduleMetaMap?.get(deal.id)?.moduleProduct }) || "";
      case "tariff_name":
        return (deal.tariffs as any)?.name || "";
      case "deal_date":
        return getEffectiveDealDate(deal);
      case "final_price": {
        // Принудительно number — иначе строки сравниваются лексикографически
        const v = deal.final_price;
        if (v == null || v === "") return null;
        const n = typeof v === "number" ? v : Number(v);
        return Number.isFinite(n) ? n : null;
      }
      case "trial_end_at": {
        // Колонка «Доступ до» — сортируем по фактической дате окончания доступа
        const accessUntil = accessMap?.get(deal.id)?.access_until || deal.trial_end_at;
        return accessUntil ? new Date(accessUntil) : null;
      }
      default:
        return deal[fieldKey];
    }
  }, [fallbackProfilesMap, moduleMetaMap, accessMap]);

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
      moduleProduct: moduleMetaMap?.get(d.id)?.moduleProduct,
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
    { header: "Доступ до", getValue: (d) => {
      const accessUntil = accessMap?.get(d.id)?.access_until || d.trial_end_at;
      return accessUntil ? format(new Date(accessUntil), "dd.MM.yyyy") : "";
    } },
  ], [fallbackProfilesMap, moduleMetaMap, accessMap]);

  // Sorting on loaded data
  const { sortedData: sortedDeals, sortKey, sortDirection, handleSort } = useTableSort({
    data: allDeals,
    defaultSortKey: "deal_date",
    defaultSortDirection: "desc",
    getFieldValue: getDealFieldValue,
  });

  // Когда пользователь сортирует по нестандартному ключу (не дефолтный deal_date desc) —
  // автозагружаем все страницы, иначе сортировка применяется только к первой странице.
  const isCustomSort = sortKey !== null && !(sortKey === "deal_date" && sortDirection === "desc");
  useEffect(() => {
    if (isCustomSort && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [isCustomSort, hasNextPage, isFetchingNextPage, fetchNextPage, allDeals.length]);

  // Visible deals — limited to displayLimit. При активной сортировке показываем всё загруженное.
  const visibleDeals = useMemo(
    () => isCustomSort ? sortedDeals : sortedDeals.slice(0, displayLimit),
    [sortedDeals, displayLimit, isCustomSort],
  );

  // Preset tab definitions with server-side counts
  const DEAL_PRESETS: FilterPreset[] = useMemo(() => [
    { id: "all", label: "Все", filters: [], count: tabCounts?.all },
    { id: "trial", label: "Триал", filters: [], count: tabCounts?.trial },
    { id: "canceled", label: "Отменённые", filters: [], count: tabCounts?.canceled },
    { id: "imported", label: "Импортированные", filters: [], count: tabCounts?.imported },
  ], [tabCounts]);

  const selectedDeal = allDeals.find(d => d.id === selectedDealId);

  // Fallback: fetch deal by ID when not found in allDeals (board view — different data source)
  const { data: fallbackDeal } = useQuery({
    queryKey: ["admin-deal-fallback", selectedDealId],
    queryFn: async () => {
      if (!selectedDealId) return null;
      const { data, error } = await supabase
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
          pipeline_id,
          user_id,
          profile_id,
          reconcile_source,
          purchase_snapshot,
          meta,
          products_v2(id, name, code, category),
          tariffs(id, name),
          profiles:profile_id(id, user_id, full_name, email, phone, avatar_url),
          payments_v2(id, status, paid_at, created_at, card_holder, meta)
        `)
        .eq("id", selectedDealId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!selectedDealId && !selectedDeal,
    staleTime: 30_000,
  });

  const resolvedDeal = selectedDeal || fallbackDeal;

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

  // Bulk delete — shared hook (same flow as kanban)
  const deleteMutation = useDealsBulkDelete({
    onSuccess: () => clearSelection(),
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

  // Create pipeline dialog state
  const [showCreatePipelineDialog, setShowCreatePipelineDialog] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState("");
  const [isCreatingPipeline, setIsCreatingPipeline] = useState(false);

  // Rename pipeline state
  const [renamePipelineTarget, setRenamePipelineTarget] = useState<{ id: string; name: string } | null>(null);
  const [renamePipelineValue, setRenamePipelineValue] = useState("");
  const [isRenamingPipeline, setIsRenamingPipeline] = useState(false);

  // Delete pipeline state
  const [deletePipelineTarget, setDeletePipelineTarget] = useState<{ id: string; name: string } | null>(null);
  const [isDeletingPipeline, setIsDeletingPipeline] = useState(false);

  const handleCreatePipeline = async () => {
    if (!newPipelineName.trim()) return;
    setIsCreatingPipeline(true);
    try {
      const p = await createPipelineFn(newPipelineName.trim());
      setSelectedPipelineId(p.id);
      setShowCreatePipelineDialog(false);
      setNewPipelineName("");
    } catch {
      // error handled by mutation
    } finally {
      setIsCreatingPipeline(false);
    }
  };

  const handleRenamePipeline = async () => {
    if (!renamePipelineTarget || !renamePipelineValue.trim()) return;
    setIsRenamingPipeline(true);
    try {
      await renamePipelineFn({ id: renamePipelineTarget.id, name: renamePipelineValue.trim() });
      setRenamePipelineTarget(null);
      setRenamePipelineValue("");
    } catch {
      // error handled by mutation
    } finally {
      setIsRenamingPipeline(false);
    }
  };

  const handleDeletePipeline = async () => {
    if (!deletePipelineTarget) return;
    setIsDeletingPipeline(true);
    try {
      await deletePipelineFn(deletePipelineTarget.id);
      // If we deleted the active pipeline, switch to default
      if (selectedPipelineId === deletePipelineTarget.id) {
        setSelectedPipelineId(null);
      }
      setDeletePipelineTarget(null);
    } catch {
      // error handled by mutation (includes guard for non-empty pipelines)
    } finally {
      setIsDeletingPipeline(false);
    }
  };

  // Filter popover search state
  const [productSearch, setProductSearch] = useState("");

  const filteredProducts = useMemo(() => {
    if (!products) return [];
    if (!productSearch.trim()) return products;
    const s = productSearch.toLowerCase();
    return products.filter((p) => p.name.toLowerCase().includes(s));
  }, [products, productSearch]);

  const activePipeline = pipelines.find((p) => p.id === activePipelineId);

  return (
    <div className="space-y-2">
      {/* Compact toolbar — single row */}
      <div className="flex items-center gap-2 px-1 pt-1 flex-wrap">
        {/* View mode toggle */}
        <div className="inline-flex p-0.5 rounded-full bg-muted/40 backdrop-blur-md border border-border/20">
          <button
            onClick={() => setViewMode("list")}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-200 ${
              viewMode === "list"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <List className="h-3.5 w-3.5" />
            Список
          </button>
          <button
            onClick={() => setViewMode("board")}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-200 ${
              viewMode === "board"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Kanban className="h-3.5 w-3.5" />
            Воронка
          </button>
        </div>

        {/* Pipeline selector (both modes) */}
        {pipelines.length > 0 && activePipelineId && (
          <PipelineManagementPopover
            pipelines={pipelines}
            activePipelineId={activePipelineId}
            onSelect={(id) => setSelectedPipelineId(id)}
            onRename={(p) => {
              setRenamePipelineTarget(p);
              setRenamePipelineValue(p.name);
            }}
            onDelete={(p) => setDeletePipelineTarget(p)}
            onCreate={() => setShowCreatePipelineDialog(true)}
            onReorder={reorderPipelinesFn}
            canEdit={canEdit}
            dealCounts={pipelineDealCounts}
            boundPipelineIds={boundPipelineIds}
          />
        )}

        {/* Preset tabs (list mode only) */}
        {viewMode === "list" && (
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
        )}

        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Поиск по номеру, email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-7 text-xs"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-form-type="other"
            data-lpignore="true"
            data-1p-ignore
          />
        </div>

        {/* Unified filter popover */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant={(selectedProductId || selectedTariffIds.length > 0) ? "default" : "outline"}
              size="sm"
              className="h-7 gap-1.5 text-xs"
            >
              <SlidersHorizontal className="h-3 w-3" />
              <span>Фильтры</span>
              {(selectedProductId || selectedTariffIds.length > 0) && (
                <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[10px] font-semibold rounded-full">
                  {(selectedProductId ? 1 : 0) + (selectedTariffIds.length > 0 ? 1 : 0)}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-0" sideOffset={6}>
            <div className="p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">Фильтры</span>
                {(selectedProductId || selectedTariffIds.length > 0) && (
                  <button
                    onClick={() => { setSelectedProductId(null); setSelectedTariffIds([]); }}
                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Сбросить
                  </button>
                )}
              </div>

              {/* Product filter */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground">Продукт</label>
                <Input
                  placeholder="Найти продукт..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className="h-7 text-xs"
                />
                <div className="max-h-36 overflow-y-auto space-y-0.5">
                  <button
                    onClick={() => setSelectedProductId(null)}
                    className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                      !selectedProductId ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-foreground"
                    }`}
                  >
                    Все продукты
                  </button>
                  {filteredProducts.map((product) => (
                    <button
                      key={product.id}
                      onClick={() => setSelectedProductId(product.id)}
                      className={`w-full text-left px-2 py-1.5 rounded text-xs truncate transition-colors ${
                        selectedProductId === product.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-foreground"
                      }`}
                    >
                      {product.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tariff filter — only when product selected */}
              {selectedProductId && tariffs && tariffs.length > 0 && (
                <div className="space-y-1.5 border-t border-border/30 pt-3">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-medium text-muted-foreground">
                      Тарифы
                      {selectedTariffIds.length > 0 && (
                        <span className="ml-1 text-primary">({selectedTariffIds.length})</span>
                      )}
                    </label>
                    {selectedTariffIds.length > 0 && (
                      <button
                        onClick={() => setSelectedTariffIds([])}
                        className="text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        Очистить
                      </button>
                    )}
                  </div>
                  <div className="max-h-36 overflow-y-auto space-y-0.5">
                    {tariffs.map((t) => {
                      const isSelected = selectedTariffIds.includes(t.id);
                      return (
                        <button
                          key={t.id}
                          onClick={() => {
                            if (isSelected) {
                              setSelectedTariffIds(selectedTariffIds.filter(id => id !== t.id));
                            } else {
                              setSelectedTariffIds([...selectedTariffIds, t.id]);
                            }
                          }}
                          className={`w-full flex items-center gap-2 text-left px-2 py-1.5 rounded text-xs transition-colors ${
                            isSelected ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-foreground"
                          }`}
                        >
                          <div className={`w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center ${
                            isSelected ? "bg-primary border-primary" : "border-border"
                          }`}>
                            {isSelected && <CheckCircle className="h-2.5 w-2.5 text-primary-foreground" />}
                          </div>
                          <span className="truncate">{t.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {selectedProductId && (!tariffs || tariffs.length === 0) && (
                <div className="text-[11px] text-muted-foreground/60 border-t border-border/30 pt-3">
                  Нет тарифов для этого продукта
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* Period + actions */}
        <div className="flex items-center gap-1.5 ml-auto">
          <PeriodSelector value={dateFilter} onChange={setDateFilter} />
          <DealsFiltersBar
            filters={extraFilters}
            onChange={updateExtraFilters}
            onReset={resetExtraFilters}
            activeCount={extraActiveCount}
            pipelineStages={activePipelineStages}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={allDeals.length === 0}>
                <Download className="h-3.5 w-3.5" />
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
          <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => {
            queryClient.invalidateQueries({ queryKey: ["admin-deals"] });
            queryClient.invalidateQueries({ queryKey: ["admin-deals-tab-counts"] });
            queryClient.invalidateQueries({ queryKey: ["deals-fallback-profiles"] });
            queryClient.invalidateQueries({ queryKey: ["deals-board"] });
            toast.success("Данные обновлены");
          }}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          {isSuperAdmin() && tabCounts && tabCounts.imported > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowArchiveCleanupDialog(true)}
              className="text-destructive hover:text-destructive h-7 text-xs gap-1"
            >
              <Trash2 className="h-3 w-3" />
              <span className="hidden sm:inline">Архив</span>
            </Button>
          )}
        </div>
      </div>

      {/* Board View */}
      {viewMode === "board" && activePipelineId && (
        <DealsKanbanBoard
          pipelineId={activePipelineId}
          pipelineName={activePipeline?.name}
          isDefaultPipeline={activePipeline?.is_default}
          search={debouncedSearch}
          productId={selectedProductId}
          tariffIds={selectedTariffIds}
          dateFrom={dateFilter.from}
          dateTo={dateFilter.to}
          extraFilters={extraFilters}
          onOpenDeal={(id) => setSelectedDealId(id)}
        />
      )}

      {/* List View - Stats line */}
      {viewMode === "list" && (
      <div className="flex items-center gap-4 text-sm text-muted-foreground px-1">
        <span>
          Показано: <strong className="text-foreground">{Math.min(displayLimit, allDeals.length)}</strong>
          {totalCount !== undefined && (
            <> из <strong className="text-foreground">{totalCount}</strong></>
          )}
        </span>
      </div>
      )}

      {/* Create Pipeline Dialog */}
      <Dialog open={showCreatePipelineDialog} onOpenChange={setShowCreatePipelineDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Создать воронку</DialogTitle>
            <DialogDescription>
              Введите название для новой воронки продаж
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Input
              value={newPipelineName}
              onChange={(e) => setNewPipelineName(e.target.value)}
              placeholder="Название воронки..."
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreatePipeline();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setShowCreatePipelineDialog(false); setNewPipelineName(""); }}>
              Отмена
            </Button>
            <Button onClick={handleCreatePipeline} disabled={!newPipelineName.trim() || isCreatingPipeline}>
              {isCreatingPipeline && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Создать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Pipeline Dialog */}
      <Dialog open={!!renamePipelineTarget} onOpenChange={(open) => !open && setRenamePipelineTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Переименовать воронку</DialogTitle>
            <DialogDescription>
              Введите новое название для воронки «{renamePipelineTarget?.name}»
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Input
              value={renamePipelineValue}
              onChange={(e) => setRenamePipelineValue(e.target.value)}
              placeholder="Новое название..."
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenamePipeline();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setRenamePipelineTarget(null); setRenamePipelineValue(""); }}>
              Отмена
            </Button>
            <Button onClick={handleRenamePipeline} disabled={!renamePipelineValue.trim() || isRenamingPipeline}>
              {isRenamingPipeline && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Pipeline Dialog */}
      <AlertDialog open={!!deletePipelineTarget} onOpenChange={(open) => !open && setDeletePipelineTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить воронку «{deletePipelineTarget?.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Воронка будет удалена вместе со всеми стадиями. Если в воронке есть сделки или привязки к продуктам, удаление будет заблокировано.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingPipeline}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeletePipeline}
              disabled={isDeletingPipeline}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingPipeline && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {viewMode === "list" && (
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
                              moduleProduct: moduleMetaMap?.get(deal.id)?.moduleProduct,
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
                      ) : deal.status === "paid" ? (
                        <div className="flex items-center gap-1.5 text-sm">
                          <CheckCircle className="h-3 w-3 text-green-600" />
                          <span className="text-muted-foreground">Оплачено</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const accessInfo = accessMap?.get(deal.id);
                        const accessUntil = accessInfo?.access_until || deal.trial_end_at;
                        if (!accessUntil) {
                          return <span className="text-muted-foreground">—</span>;
                        }
                        return (
                          <div className="text-sm">
                            {format(new Date(accessUntil), "dd.MM.yy")}
                            {accessInfo?.source === "subscription" && (
                              <div className="text-[10px] text-muted-foreground">подписка</div>
                            )}
                          </div>
                        );
                      })()}
                    </TableCell>
                  </TableRow>
                );
            })}
            </TableBody>
          </Table>
          </div>
        )}
      </GlassCard>
      )}

      {/* Show More button — reuses Contacts pattern (list mode only) */}
      {viewMode === "list" && (() => {
        const loadedCount = Math.min(displayLimit, allDeals.length);
        const filtersBeyondTabCounts = !!activePipelineId || selectedTariffIds.length > 0;

        // Условия скрытия:
        // 1. Сервер сказал «больше нет» И мы уже показали всё загруженное
        if (!hasNextPage && displayLimit >= allDeals.length) return null;

        // Реальный остаток считаем только когда totalCount достоверный
        // (без фильтров pipeline/tariff, которые не учтены в tabCounts).
        const totalReliable = !filtersBeyondTabCounts && typeof totalCount === "number";
        const remaining = totalReliable ? Math.max(0, (totalCount as number) - loadedCount) : null;
        const nextBatch = remaining != null ? Math.min(PAGE_SIZE, remaining) : PAGE_SIZE;

        // Если totalCount достоверен и остатка нет, и сервер тоже исчерпан — скрываем
        if (totalReliable && remaining === 0 && !hasNextPage) return null;

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
              ) : remaining != null && remaining > 0 ? (
                <>Показать ещё {nextBatch}{remaining > nextBatch ? ` (осталось ${remaining})` : ""}</>
              ) : (
                <>Показать ещё</>
              )}
            </Button>
          </div>
        );
      })()}

      {/* Deal Detail Sheet */}
      <DealDetailSheet
        deal={resolvedDeal || null}
        profile={resolvedDeal ? resolveDealProfile(resolvedDeal, fallbackProfilesMap) : null}
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
