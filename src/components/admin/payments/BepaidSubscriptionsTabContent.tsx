import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  Loader2,
  RefreshCw,
  Ban,
  Search,
  ExternalLink,
  Copy,
  Check,
  Link2,
  Link2Off,
  AlertTriangle,
  Database,
  Calendar,
  Play,
  RotateCcw,
  Unlink,
  ShieldAlert,
  Info,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, differenceInDays } from "date-fns";
import { ru } from "date-fns/locale";
import { useHasRole } from "@/hooks/useHasRole";

interface BepaidSubscription {
  id: string;
  status: string;
  plan_title: string;
  plan_amount: number;
  plan_currency: string;
  customer_email: string;
  customer_name: string;
  card_last4: string;
  card_brand: string;
  created_at: string;
  next_billing_at: string;
  linked_subscription_id: string | null;
  linked_user_id: string | null;
  linked_profile_name: string | null;
  is_orphan: boolean;
  // Extended fields from snapshot
  snapshot_state?: string;
  snapshot_at?: string;
  cancellation_capability?: 'can_cancel_now' | 'cannot_cancel_until_paid' | 'unknown';
  needs_support?: boolean;
  // PATCH-H: Flag for missing details from provider
  details_missing?: boolean;
}

interface SubscriptionStats {
  total: number;
  active: number;
  trial: number;
  canceled?: number;   // Correct spelling
  cancelled?: number;  // Backward compatibility
  orphans: number;
  linked: number;
}

interface ReconcileResult {
  success: boolean;
  dry_run: boolean;
  distinct_sbs_ids_total: number;
  missing_provider_subscriptions_count: number;
  already_present: number;
  inserted: number;
  would_insert: number;
  linked_to_subscription_v2: number;
  still_unlinked: number;
  still_missing_after_execute?: number;
  sample_ids: string[];
}

// PATCH-H: Updated Debug info interface with all fields
interface DebugInfo {
  creds_source?: 'integration_instance' | 'env_vars';
  integration_status?: string | null;
  statuses_tried?: string[];
  api_list_count?: number;
  provider_subscriptions_count?: number;
  details_fetched_count?: number;
  details_failed_count?: number;
  result_count?: number;
}

// Normalized status filter - always use 'canceled'
type StatusFilter = "all" | "active" | "trial" | "canceled" | "past_due";
type LinkFilter = "all" | "linked" | "orphan" | "urgent" | "needs_support";
type SortField = "created_at" | "next_billing_at" | "plan_amount" | "status";
type SortDir = "asc" | "desc";

// Normalize status: cancelled → canceled
function normalizeStatus(status: string): string {
  if (status === 'cancelled') return 'canceled';
  return status;
}

export function BepaidSubscriptionsTabContent() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [linkFilter, setLinkFilter] = useState<LinkFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("next_billing_at");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showReconcileDialog, setShowReconcileDialog] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<ReconcileResult | null>(null);
  
  // Emergency unlink state
  const [showEmergencyUnlinkDialog, setShowEmergencyUnlinkDialog] = useState(false);
  const [emergencyUnlinkConfirm, setEmergencyUnlinkConfirm] = useState("");
  const [targetEmergencyUnlinkId, setTargetEmergencyUnlinkId] = useState<string | null>(null);
  
  // Refresh snapshot state
  const [refreshingSnapshotIds, setRefreshingSnapshotIds] = useState<Set<string>>(new Set());
  
  const queryClient = useQueryClient();
  const { hasRole: isSuperAdmin } = useHasRole('superadmin');

  // PATCH-E: Fetch subscriptions with proper error handling
  const { data, isLoading, refetch, isRefetching, error: fetchError } = useQuery({
    queryKey: ["bepaid-subscriptions-admin"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("bepaid-list-subscriptions");
      
      // PATCH-E: Transport error
      if (error) throw new Error(error.message || 'Edge function error');
      
      // PATCH-E: Edge payload error (even if 200)
      if (data?.error) throw new Error(data.error);
      
      // PATCH-E: Strict shape validation
      if (!data || !Array.isArray(data.subscriptions)) {
        throw new Error('Invalid response: subscriptions[] missing');
      }
      
      // Normalize status for all subscriptions
      const subs = (data.subscriptions || []).map((s: BepaidSubscription) => ({
        ...s,
        status: normalizeStatus(s.status),
        snapshot_state: s.snapshot_state ? normalizeStatus(s.snapshot_state) : undefined,
      }));
      
      return { 
        subscriptions: subs, 
        stats: data.stats as SubscriptionStats,
        debug: data.debug as DebugInfo | undefined,
      };
    },
    staleTime: 60000,
  });

  const subscriptions = data?.subscriptions || [];
  const debugInfo = data?.debug;
  
  // PATCH-A: Backward compatible stats - use canceled ?? cancelled
  const rawStats = data?.stats || { total: 0, active: 0, trial: 0, canceled: 0, cancelled: 0, orphans: 0, linked: 0 };
  const canceledCount = rawStats.canceled ?? rawStats.cancelled ?? 0;

  // Calculate urgent subscriptions (next charge within 7 days)
  const urgentCount = useMemo(() => {
    return subscriptions.filter((s: BepaidSubscription) => {
      if (!s.next_billing_at || s.status === 'canceled') return false;
      const daysUntil = differenceInDays(new Date(s.next_billing_at), new Date());
      return daysUntil <= 7 && daysUntil >= 0 && s.is_orphan;
    }).length;
  }, [subscriptions]);

  // Count needs_support
  const needsSupportCount = useMemo(() => {
    return subscriptions.filter((s: BepaidSubscription) => s.needs_support).length;
  }, [subscriptions]);

  // Filter and sort subscriptions
  const filteredSubscriptions = useMemo(() => {
    let result = [...subscriptions];
    
    if (statusFilter !== "all") {
      result = result.filter((s: BepaidSubscription) => s.status === statusFilter);
    }
    
    if (linkFilter === "linked") {
      result = result.filter((s: BepaidSubscription) => !s.is_orphan);
    } else if (linkFilter === "orphan") {
      result = result.filter((s: BepaidSubscription) => s.is_orphan);
    } else if (linkFilter === "urgent") {
      result = result.filter((s: BepaidSubscription) => {
        if (!s.next_billing_at || s.status === 'canceled') return false;
        const daysUntil = differenceInDays(new Date(s.next_billing_at), new Date());
        return daysUntil <= 7 && daysUntil >= 0;
      });
    } else if (linkFilter === "needs_support") {
      result = result.filter((s: BepaidSubscription) => s.needs_support);
    }
    
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((s: BepaidSubscription) => 
        s.id.toLowerCase().includes(q) ||
        s.plan_title.toLowerCase().includes(q) ||
        s.customer_email.toLowerCase().includes(q) ||
        s.customer_name.toLowerCase().includes(q) ||
        s.linked_profile_name?.toLowerCase().includes(q)
      );
    }
    
    result.sort((a: BepaidSubscription, b: BepaidSubscription) => {
      let aVal: any, bVal: any;
      
      switch (sortField) {
        case "created_at":
          aVal = a.created_at || "";
          bVal = b.created_at || "";
          break;
        case "next_billing_at":
          aVal = a.next_billing_at || "9999";
          bVal = b.next_billing_at || "9999";
          break;
        case "plan_amount":
          aVal = a.plan_amount;
          bVal = b.plan_amount;
          break;
        case "status":
          // Use 'canceled' in order map
          const order: Record<string, number> = { active: 0, trial: 1, past_due: 2, canceled: 3 };
          aVal = order[a.status] ?? 4;
          bVal = order[b.status] ?? 4;
          break;
      }
      
      if (sortDir === "asc") {
        return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      } else {
        return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
      }
    });
    
    return result;
  }, [subscriptions, statusFilter, linkFilter, searchQuery, sortField, sortDir]);

  // Reconcile mutation (dry-run)
  const reconcileMutation = useMutation({
    mutationFn: async (execute: boolean) => {
      const { data, error } = await supabase.functions.invoke("admin-reconcile-bepaid-legacy", {
        body: { dry_run: !execute, limit: 500 },
      });
      if (error) throw error;
      return data as ReconcileResult;
    },
    onSuccess: (data, execute) => {
      setReconcileResult(data);
      if (!data.dry_run) {
        toast.success(`Reconcile завершён: ${data.inserted} записей создано`);
        queryClient.invalidateQueries({ queryKey: ["bepaid-subscriptions-admin"] });
      }
    },
    onError: (e: any) => {
      toast.error("Ошибка reconcile: " + e.message);
    },
  });

  // Cancel mutation
  const cancelMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { data, error } = await supabase.functions.invoke("bepaid-cancel-subscriptions", {
        body: { subscription_ids: ids },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async (data) => {
      const canceledIds = data.canceled || data.cancelled || [];
      toast.success(`Отменено: ${canceledIds.length} из ${data.total_requested}`);
      
      if (data.failed?.length > 0) {
        const failedReasons = data.failed.map((f: any) => f.reason_code || f.error || 'unknown').join(', ');
        toast.error(`Не удалось отменить ${data.failed.length}: ${failedReasons}`);
      }
      
      // PATCH-B: Auto-refresh snapshot for canceled subscriptions
      if (canceledIds.length > 0) {
        await refreshSnapshotsForIds(canceledIds);
      }
      
      setSelectedIds(new Set());
      setShowCancelDialog(false);
      queryClient.invalidateQueries({ queryKey: ["bepaid-subscriptions-admin"] });
    },
    onError: (e: any) => {
      toast.error("Ошибка отмены: " + e.message);
    },
  });

  // Refresh snapshot mutation
  const refreshSnapshotMutation = useMutation({
    mutationFn: async (subscriptionId: string) => {
      const { data, error } = await supabase.functions.invoke("bepaid-get-subscription-details", {
        body: { subscription_id: subscriptionId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Snapshot обновлён: ${data.snapshot?.state || 'unknown'}`);
      queryClient.invalidateQueries({ queryKey: ["bepaid-subscriptions-admin"] });
    },
    onError: (e: any) => {
      toast.error("Ошибка обновления snapshot: " + e.message);
    },
  });

  // Helper to refresh snapshots for multiple IDs
  const refreshSnapshotsForIds = async (ids: string[]) => {
    for (const id of ids) {
      try {
        await supabase.functions.invoke("bepaid-get-subscription-details", {
          body: { subscription_id: id },
        });
      } catch (e) {
        console.error(`Failed to refresh snapshot for ${id}:`, e);
      }
    }
  };

  // Handle single snapshot refresh
  const handleRefreshSnapshot = async (id: string) => {
    setRefreshingSnapshotIds(prev => new Set([...prev, id]));
    try {
      await refreshSnapshotMutation.mutateAsync(id);
    } finally {
      setRefreshingSnapshotIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  // PATCH-B: Emergency Unlink via Edge Function (no direct DB calls)
  const handleEmergencyUnlink = async () => {
    if (!targetEmergencyUnlinkId || emergencyUnlinkConfirm !== "UNLINK") return;
    
    try {
      const { data, error } = await supabase.functions.invoke('admin-bepaid-emergency-unlink', {
        body: { 
          provider_subscription_id: targetEmergencyUnlinkId,
          confirm_text: emergencyUnlinkConfirm
        }
      });
      
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      
      toast.success('Подписка аварийно отвязана');
      setShowEmergencyUnlinkDialog(false);
      setEmergencyUnlinkConfirm("");
      setTargetEmergencyUnlinkId(null);
      queryClient.invalidateQueries({ queryKey: ["bepaid-subscriptions-admin"] });
    } catch (e: any) {
      toast.error('Ошибка отвязки: ' + e.message);
    }
  };

  // Check if unlink is allowed (only if canceled/terminated)
  const canUnlink = (sub: BepaidSubscription): boolean => {
    const state = sub.snapshot_state || sub.status;
    return state === 'canceled' || state === 'terminated';
  };

  const handleSelectAll = () => {
    if (selectedIds.size === filteredSubscriptions.filter((s: BepaidSubscription) => s.status !== 'canceled').length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredSubscriptions.filter((s: BepaidSubscription) => s.status !== 'canceled').map((s: BepaidSubscription) => s.id)));
    }
  };

  const handleSelectOne = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatDate = (dateStr: string | undefined) => {
    if (!dateStr) return "—";
    try {
      return format(new Date(dateStr), "dd.MM.yy HH:mm", { locale: ru });
    } catch {
      return dateStr;
    }
  };

  const getDaysUntilCharge = (dateStr: string | undefined) => {
    if (!dateStr) return null;
    try {
      const days = differenceInDays(new Date(dateStr), new Date());
      return days;
    } catch {
      return null;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Активна</Badge>;
      case "trial":
        return <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20">Trial</Badge>;
      case "past_due":
        return <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">Просрочена</Badge>;
      case "canceled":
        return <Badge variant="secondary">Отменена</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-4">
      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-7 gap-3">
        <Card className="p-3">
          <div className="text-2xl font-bold">{rawStats.total}</div>
          <div className="text-xs text-muted-foreground">Всего</div>
        </Card>
        <Card className="p-3">
          <div className="text-2xl font-bold text-emerald-600">{rawStats.active}</div>
          <div className="text-xs text-muted-foreground">Активных</div>
        </Card>
        <Card className="p-3">
          <div className="text-2xl font-bold text-blue-600">{rawStats.trial}</div>
          <div className="text-xs text-muted-foreground">Trial</div>
        </Card>
        <Card className="p-3">
          <div className="text-2xl font-bold text-muted-foreground">{canceledCount}</div>
          <div className="text-xs text-muted-foreground">Отменённых</div>
        </Card>
        <Card className="p-3">
          <div className="text-2xl font-bold text-red-600">{rawStats.orphans}</div>
          <div className="text-xs text-muted-foreground">Сирот</div>
        </Card>
        <Card className="p-3">
          <div className="text-2xl font-bold text-emerald-600">{rawStats.linked}</div>
          <div className="text-xs text-muted-foreground">Связанных</div>
        </Card>
        {(urgentCount > 0 || needsSupportCount > 0) && (
          <Card className="p-3 border-amber-500/50 bg-amber-500/5">
            <div className="text-2xl font-bold text-amber-600">
              {urgentCount > 0 ? urgentCount : needsSupportCount}
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> 
              {urgentCount > 0 ? '≤7 дней' : 'Needs support'}
            </div>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ExternalLink className="h-5 w-5" />
                Подписки bePaid
              </CardTitle>
              <CardDescription className="mt-1">
                Управление provider-managed подписками
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {/* PATCH-H: Updated debug info popover */}
              {debugInfo && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <Info className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 text-xs space-y-1">
                    <div className="font-medium mb-2">Диагностика</div>
                    <div><span className="text-muted-foreground">Источник creds:</span> {debugInfo.creds_source || 'N/A'}</div>
                    <div><span className="text-muted-foreground">Статус интеграции:</span> {debugInfo.integration_status || 'N/A'}</div>
                    <div><span className="text-muted-foreground">API list:</span> {debugInfo.api_list_count ?? 'N/A'}</div>
                    <div><span className="text-muted-foreground">В provider_subscriptions:</span> {debugInfo.provider_subscriptions_count ?? 'N/A'}</div>
                    <div><span className="text-muted-foreground">Details получены:</span> {debugInfo.details_fetched_count ?? 'N/A'}</div>
                    <div><span className="text-muted-foreground">Details failed:</span> {debugInfo.details_failed_count ?? 'N/A'}</div>
                    <div><span className="text-muted-foreground">Итого результат:</span> {debugInfo.result_count ?? 0}</div>
                  </PopoverContent>
                </Popover>
              )}
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => {
                  setReconcileResult(null);
                  setShowReconcileDialog(true);
                  reconcileMutation.mutate(false);
                }}
                disabled={reconcileMutation.isPending}
              >
                {reconcileMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Database className="h-4 w-4 mr-2" />
                )}
                Reconcile Legacy
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => refetch()}
                disabled={isRefetching}
              >
                {isRefetching ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Обновить
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Поиск..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-48 h-8"
              />
            </div>
            
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="w-32 h-8">
                <SelectValue placeholder="Статус" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все статусы</SelectItem>
                <SelectItem value="active">Активные</SelectItem>
                <SelectItem value="trial">Trial</SelectItem>
                <SelectItem value="past_due">Просроченные</SelectItem>
                <SelectItem value="canceled">Отменённые</SelectItem>
              </SelectContent>
            </Select>
            
            <Select value={linkFilter} onValueChange={(v) => setLinkFilter(v as LinkFilter)}>
              <SelectTrigger className="w-36 h-8">
                <SelectValue placeholder="Связь" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все</SelectItem>
                <SelectItem value="linked">Связанные</SelectItem>
                <SelectItem value="orphan">Сироты</SelectItem>
                <SelectItem value="urgent">Срочные (≤7д)</SelectItem>
                <SelectItem value="needs_support">Needs support</SelectItem>
              </SelectContent>
            </Select>
            
            <Select value={`${sortField}-${sortDir}`} onValueChange={(v) => {
              const [field, dir] = v.split("-") as [SortField, SortDir];
              setSortField(field);
              setSortDir(dir);
            }}>
              <SelectTrigger className="w-44 h-8">
                <SelectValue placeholder="Сортировка" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="next_billing_at-asc">След. списание ↑</SelectItem>
                <SelectItem value="next_billing_at-desc">След. списание ↓</SelectItem>
                <SelectItem value="created_at-desc">Дата создания ↓</SelectItem>
                <SelectItem value="created_at-asc">Дата создания ↑</SelectItem>
                <SelectItem value="plan_amount-desc">Сумма ↓</SelectItem>
                <SelectItem value="plan_amount-asc">Сумма ↑</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Bulk actions */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
              <span className="text-sm">
                Выбрано: <strong>{selectedIds.size}</strong>
              </span>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowCancelDialog(true)}
                disabled={cancelMutation.isPending}
              >
                {cancelMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Ban className="h-4 w-4 mr-2" />
                )}
                Отменить выбранные
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedIds(new Set())}
              >
                Сбросить
              </Button>
            </div>
          )}

          {/* PATCH-E: Error banner */}
          {fetchError && (
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
              <div className="flex items-center gap-2 text-destructive font-medium">
                <AlertTriangle className="h-4 w-4" />
                Ошибка загрузки подписок
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {(fetchError as Error).message || 'Неизвестная ошибка'}
              </div>
            </div>
          )}

          {/* Table */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : fetchError ? (
            <div className="text-center py-12 text-muted-foreground">
              Не удалось загрузить подписки. Попробуйте обновить страницу.
            </div>
          ) : filteredSubscriptions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {subscriptions.length === 0 
                ? "Подписки не найдены" 
                : "Нет подписок по выбранным фильтрам"}
            </div>
          ) : (
            <ScrollArea className="h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={selectedIds.size === filteredSubscriptions.filter((s: BepaidSubscription) => s.status !== 'canceled').length && filteredSubscriptions.length > 0}
                        onCheckedChange={handleSelectAll}
                      />
                    </TableHead>
                    <TableHead>ID</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Клиент</TableHead>
                    <TableHead>План / Сумма</TableHead>
                    <TableHead>След. списание</TableHead>
                    <TableHead>Связь</TableHead>
                    <TableHead>Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSubscriptions.map((sub: BepaidSubscription) => {
                    const daysUntil = getDaysUntilCharge(sub.next_billing_at);
                    const isUrgent = daysUntil !== null && daysUntil <= 7 && daysUntil >= 0 && sub.is_orphan;
                    const isRefreshingSnapshot = refreshingSnapshotIds.has(sub.id);
                    
                    return (
                      <TableRow 
                        key={sub.id} 
                        className={isUrgent ? "bg-amber-500/5 border-l-2 border-l-amber-500" : sub.is_orphan ? "bg-red-500/5" : ""}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.has(sub.id)}
                            onCheckedChange={() => handleSelectOne(sub.id)}
                            disabled={sub.status === "canceled"}
                          />
                        </TableCell>
                        <TableCell>
                          <button
                            onClick={() => copyId(sub.id)}
                            className="font-mono text-xs hover:text-primary flex items-center gap-1"
                            title="Скопировать ID"
                          >
                            {sub.id.slice(0, 16)}...
                            {copiedId === sub.id ? (
                              <Check className="h-3 w-3 text-emerald-500" />
                            ) : (
                              <Copy className="h-3 w-3 opacity-50" />
                            )}
                          </button>
                          {sub.needs_support && (
                            <Badge variant="destructive" className="mt-1 text-xs">
                              Needs support
                            </Badge>
                          )}
                          {/* PATCH-H: Show badge for records without API details */}
                          {sub.details_missing && (
                            <Badge variant="outline" className="mt-1 text-xs text-amber-600 border-amber-500/30">
                              Нет деталей
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {getStatusBadge(sub.status)}
                          {sub.snapshot_state && sub.snapshot_state !== sub.status && (
                            <div className="text-xs text-muted-foreground mt-1">
                              bePaid: {sub.snapshot_state}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm font-medium">
                            {sub.customer_name || sub.customer_email || "—"}
                          </div>
                          {sub.customer_name && sub.customer_email && (
                            <div className="text-xs text-muted-foreground">{sub.customer_email}</div>
                          )}
                          {sub.card_last4 && (
                            <div className="text-xs text-muted-foreground">
                              {sub.card_brand} •••• {sub.card_last4}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">{sub.plan_title}</div>
                          <div className="text-sm font-medium">
                            {sub.plan_amount.toFixed(2)} {sub.plan_currency}
                          </div>
                        </TableCell>
                        <TableCell>
                          {sub.next_billing_at ? (
                            <div className="flex items-center gap-1">
                              <Calendar className="h-3 w-3 text-muted-foreground" />
                              <span className={`text-xs ${isUrgent ? 'text-amber-600 font-medium' : ''}`}>
                                {formatDate(sub.next_billing_at)}
                              </span>
                              {daysUntil !== null && daysUntil <= 7 && (
                                <Badge variant={daysUntil <= 3 ? "destructive" : "outline"} className="ml-1 text-xs">
                                  {daysUntil}д
                                </Badge>
                              )}
                            </div>
                          ) : "—"}
                        </TableCell>
                        <TableCell>
                          {sub.is_orphan ? (
                            <Badge variant="destructive" className="flex items-center gap-1 w-fit">
                              <Link2Off className="h-3 w-3" />
                              Сирота
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="flex items-center gap-1 w-fit bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                              <Link2 className="h-3 w-3" />
                              {sub.linked_profile_name || "Связана"}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {/* Refresh Snapshot */}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => handleRefreshSnapshot(sub.id)}
                              disabled={isRefreshingSnapshot}
                              title="Обновить статус (snapshot)"
                            >
                              {isRefreshingSnapshot ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RotateCcw className="h-3.5 w-3.5" />
                              )}
                            </Button>
                            
                            {/* Cancel */}
                            {sub.status !== 'canceled' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => {
                                  setSelectedIds(new Set([sub.id]));
                                  setShowCancelDialog(true);
                                }}
                                title="Отменить подписку"
                              >
                                <Ban className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            
                            {/* Unlink - disabled until canceled */}
                            {!sub.is_orphan && (
                              <>
                                {canUnlink(sub) ? (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={() => {
                                      setTargetEmergencyUnlinkId(sub.id);
                                      setShowEmergencyUnlinkDialog(true);
                                    }}
                                    title="Отвязать (доступно после отмены)"
                                  >
                                    <Unlink className="h-3.5 w-3.5" />
                                  </Button>
                                ) : (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 opacity-30 cursor-not-allowed"
                                    disabled
                                    title="Сначала отмените подписку, затем отвязывайте"
                                  >
                                    <Unlink className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                              </>
                            )}
                            
                            {/* Emergency Unlink - super_admin only for non-canceled */}
                            {!sub.is_orphan && !canUnlink(sub) && isSuperAdmin && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => {
                                  setTargetEmergencyUnlinkId(sub.id);
                                  setShowEmergencyUnlinkDialog(true);
                                }}
                                title="Аварийное отвязывание (super_admin)"
                              >
                                <ShieldAlert className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Cancel confirmation dialog */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Отменить подписки?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                Вы собираетесь отменить <strong>{selectedIds.size}</strong> подписок в bePaid.
              </p>
              <p className="text-amber-600">
                ⚠️ Автоматические списания прекратятся. Если bePaid откажет в отмене 
                (например, при past_due), подписка останется активной и будет помечена "needs_support".
              </p>
              <p>После успешной отмены snapshot будет автоматически обновлён.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelMutation.isPending}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => cancelMutation.mutate([...selectedIds])}
              disabled={cancelMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {cancelMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Ban className="h-4 w-4 mr-2" />
              )}
              Отменить {selectedIds.size} подписок
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Emergency Unlink dialog */}
      <AlertDialog open={showEmergencyUnlinkDialog} onOpenChange={(open) => {
        if (!open) {
          setEmergencyUnlinkConfirm("");
          setTargetEmergencyUnlinkId(null);
        }
        setShowEmergencyUnlinkDialog(open);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="h-5 w-5" />
              {canUnlink(filteredSubscriptions.find(s => s.id === targetEmergencyUnlinkId) || {} as BepaidSubscription) 
                ? "Отвязать подписку?" 
                : "АВАРИЙНОЕ отвязывание"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {!canUnlink(filteredSubscriptions.find(s => s.id === targetEmergencyUnlinkId) || {} as BepaidSubscription) && (
                  <div className="p-3 bg-destructive/10 border border-destructive/20 rounded text-destructive">
                    <p className="font-medium">⚠️ ВНИМАНИЕ: Подписка НЕ отменена в bePaid!</p>
                    <p className="text-sm mt-1">
                      Автосписания могут продолжаться. Используйте это только если Cancel невозможен 
                      и вы понимаете последствия.
                    </p>
                  </div>
                )}
                <p>
                  Введите <strong>UNLINK</strong> для подтверждения:
                </p>
                <Input 
                  value={emergencyUnlinkConfirm}
                  onChange={(e) => setEmergencyUnlinkConfirm(e.target.value.toUpperCase())}
                  placeholder="UNLINK"
                  className="font-mono"
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <Button 
              variant="destructive"
              disabled={emergencyUnlinkConfirm !== "UNLINK"}
              onClick={handleEmergencyUnlink}
            >
              <Unlink className="h-4 w-4 mr-2" />
              Отвязать
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reconcile dialog */}
      <AlertDialog open={showReconcileDialog} onOpenChange={setShowReconcileDialog}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Reconcile Legacy Subscriptions
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {reconcileMutation.isPending && !reconcileResult && (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-6 w-6 animate-spin" />
                    <span className="ml-2">Анализ...</span>
                  </div>
                )}
                
                {reconcileResult && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="p-2 bg-muted rounded">
                        <div className="font-medium">{reconcileResult.distinct_sbs_ids_total}</div>
                        <div className="text-xs text-muted-foreground">Всего в orders.meta</div>
                      </div>
                      <div className="p-2 bg-muted rounded">
                        <div className="font-medium">{reconcileResult.missing_provider_subscriptions_count}</div>
                        <div className="text-xs text-muted-foreground">Отсутствует в provider_subs</div>
                      </div>
                      <div className="p-2 bg-muted rounded">
                        <div className="font-medium">{reconcileResult.already_present}</div>
                        <div className="text-xs text-muted-foreground">Уже есть</div>
                      </div>
                      <div className="p-2 bg-muted rounded">
                        <div className="font-medium text-emerald-600">
                          {reconcileResult.dry_run ? reconcileResult.would_insert : reconcileResult.inserted}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {reconcileResult.dry_run ? "Будет создано" : "Создано"}
                        </div>
                      </div>
                      <div className="p-2 bg-muted rounded">
                        <div className="font-medium text-blue-600">{reconcileResult.linked_to_subscription_v2}</div>
                        <div className="text-xs text-muted-foreground">Со связью</div>
                      </div>
                      <div className="p-2 bg-muted rounded">
                        <div className="font-medium text-amber-600">{reconcileResult.still_unlinked}</div>
                        <div className="text-xs text-muted-foreground">Без связи</div>
                      </div>
                    </div>

                    {reconcileResult.still_missing_after_execute !== undefined && !reconcileResult.dry_run && (
                      <div className={`p-2 rounded text-sm ${reconcileResult.still_missing_after_execute === 0 ? 'bg-emerald-500/10' : 'bg-amber-500/10'}`}>
                        Осталось missing: <strong>{reconcileResult.still_missing_after_execute}</strong>
                      </div>
                    )}

                    {reconcileResult.sample_ids.length > 0 && (
                      <div className="text-xs">
                        <div className="font-medium mb-1">Примеры ID:</div>
                        <div className="font-mono text-muted-foreground break-all">
                          {reconcileResult.sample_ids.slice(0, 5).join(', ')}
                          {reconcileResult.sample_ids.length > 5 && '...'}
                        </div>
                      </div>
                    )}

                    {reconcileResult.dry_run && reconcileResult.would_insert > 0 && (
                      <div className="p-2 bg-amber-500/10 rounded border border-amber-500/20 text-sm">
                        ⚠️ Это dry-run. Нажмите "Выполнить" чтобы создать записи.
                        {!isSuperAdmin && (
                          <div className="text-xs text-muted-foreground mt-1">
                            Execute доступен только для super_admin.
                          </div>
                        )}
                      </div>
                    )}

                    {!reconcileResult.dry_run && (
                      <div className="p-2 bg-emerald-500/10 rounded border border-emerald-500/20 text-sm">
                        ✅ Reconcile выполнен. Создано {reconcileResult.inserted} записей.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Закрыть</AlertDialogCancel>
            {reconcileResult?.dry_run && reconcileResult.would_insert > 0 && isSuperAdmin && (
              <Button
                onClick={() => reconcileMutation.mutate(true)}
                disabled={reconcileMutation.isPending}
              >
                {reconcileMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Выполнить
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
