import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
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
  HelpCircle,
  Settings,
  GripVertical,
  User,
  Handshake,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, differenceInDays } from "date-fns";
import { ru } from "date-fns/locale";
import { useHasRole } from "@/hooks/useHasRole";
import { ContactDetailSheet } from "@/components/admin/ContactDetailSheet";
import { LinkSubscriptionContactDialog } from "./LinkSubscriptionContactDialog";
import { UnlinkSubscriptionContactDialog } from "./UnlinkSubscriptionContactDialog";
import { LinkSubscriptionDealDialog } from "./LinkSubscriptionDealDialog";
import { UnlinkSubscriptionDealDialog } from "./UnlinkSubscriptionDealDialog";
import { cn } from "@/lib/utils";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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
  snapshot_state?: string;
  snapshot_at?: string;
  cancellation_capability?: 'can_cancel_now' | 'cannot_cancel_until_paid' | 'unknown';
  needs_support?: boolean;
  details_missing?: boolean;
  // PATCH-T4: New linked data fields
  linked_order_id?: string | null;
  linked_order_number?: string | null;
  linked_payment_id?: string | null;
  linked_provider_payment_id?: string | null; // PATCH-U4: bePaid UID
  canceled_at?: string | null;
}

interface SubscriptionStats {
  total: number;
  active: number;
  trial: number;
  pending?: number;
  canceled?: number;
  cancelled?: number;
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

interface DebugInfo {
  creds_source?: 'integration_instance_only' | 'none';
  integration_status?: string | null;
  shop_id_present?: boolean;
  secret_present?: boolean;
  hosts_tried?: string[];
  paths_tried?: string[];
  api_list_count?: number;
  db_records_count?: number;  // PATCH-U3: DB-first count
  db_enriched_count?: number; // PATCH-U3: DB-enriched count
  list_attempts?: Array<{ host: string; path: string; status: number; items_count?: number }>;
  provider_subscriptions_count?: number;
  details_fetched_count?: number;
  details_failed_count?: number;
  detail_errors_by_status?: Record<number, number>;
  upserted_count?: number; // PATCH-U3: saved to DB
  result_count?: number;
}

// Column configuration for DnD + visibility
interface ColumnConfig {
  key: string;
  label: string;
  visible: boolean;
  width: number;
  order: number;
}

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { key: "checkbox", label: "", visible: true, width: 40, order: 0 },
  { key: "id", label: "ID подписки", visible: true, width: 130, order: 1 },
  { key: "status", label: "Статус", visible: true, width: 100, order: 2 },
  { key: "customer", label: "Клиент", visible: true, width: 160, order: 3 },
  { key: "plan", label: "План", visible: true, width: 150, order: 4 },
  { key: "amount", label: "Сумма", visible: true, width: 90, order: 5 },
  { key: "next_billing", label: "Списание", visible: true, width: 110, order: 6 },
  { key: "card", label: "Карта", visible: true, width: 100, order: 7 },
  { key: "payment_id", label: "ID платежа", visible: true, width: 130, order: 8 }, // PATCH-U2: visible by default
  { key: "deal", label: "Сделка", visible: true, width: 100, order: 9 },
  { key: "created", label: "Создано", visible: false, width: 100, order: 10 },
  { key: "canceled_at", label: "Отменено", visible: false, width: 100, order: 11 },
  { key: "connection", label: "Связь", visible: true, width: 100, order: 12 },
  { key: "actions", label: "", visible: true, width: 100, order: 13 },
];

const COLUMNS_STORAGE_KEY = 'admin_bepaid_subscriptions_columns_v3'; // PATCH-U2: reset columns
const PAYLOAD_STORAGE_KEY = 'admin_bepaid_subscriptions_last_payload_v1'; // PATCH-U1: persist data

// Russian status labels dictionary
const STATUS_LABELS: Record<string, string> = {
  active: 'Активна',
  trial: 'Пробный период',
  pending: 'Ожидает подтверждения',
  past_due: 'Просрочена',
  canceled: 'Отменена',
  terminated: 'Завершена',
  paused: 'Приостановлена',
  unknown: 'Неизвестно',
  legacy: 'Устаревшая',
  redirecting: 'Перенаправление',
  failed: 'Ошибка',
  expired: 'Истекла',
  suspended: 'Заблокирована',
};

type StatusFilter = "all" | "active" | "trial" | "canceled" | "past_due" | "pending";
type LinkFilter = "all" | "linked" | "orphan" | "urgent" | "needs_support";
type SortField = "created_at" | "next_billing_at" | "plan_amount" | "status";
type SortDir = "asc" | "desc";

function normalizeStatus(status: string): string {
  if (status === 'cancelled') return 'canceled';
  return status;
}

// Sortable resizable header component
function SortableResizableHeader({ 
  column, 
  onResize, 
  children 
}: { 
  column: ColumnConfig; 
  onResize: (key: string, width: number) => void; 
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: column.key });
  
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = column.width;
    
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(50, startWidth + delta);
      onResize(column.key, newWidth);
    };
    
    const handleMouseUp = () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };
  
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    width: column.width,
    minWidth: 50,
    position: 'relative' as const,
    opacity: isDragging ? 0.5 : 1,
  };
  
  // Non-draggable columns
  if (column.key === 'checkbox' || column.key === 'actions') {
    return (
      <TableHead className="py-2 px-2" style={{ width: column.width, minWidth: 50 }}>
        {children}
      </TableHead>
    );
  }
  
  return (
    <TableHead ref={setNodeRef} style={style} className="py-2 px-2">
      <div className="flex items-center gap-1">
        <div 
          {...attributes} 
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-0.5 hover:bg-muted rounded opacity-50 hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="w-3 h-3" />
        </div>
        <div className="flex-1 truncate text-xs font-medium">{children}</div>
      </div>
      <div
        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/50 active:bg-primary transition-colors"
        onMouseDown={handleMouseDown}
      />
    </TableHead>
  );
}

export function BepaidSubscriptionsTabContent() {
  // Default filter is now "active"
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [linkFilter, setLinkFilter] = useState<LinkFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("next_billing_at");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showReconcileDialog, setShowReconcileDialog] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<ReconcileResult | null>(null);
  
  const [showEmergencyUnlinkDialog, setShowEmergencyUnlinkDialog] = useState(false);
  const [emergencyUnlinkConfirm, setEmergencyUnlinkConfirm] = useState("");
  const [targetEmergencyUnlinkId, setTargetEmergencyUnlinkId] = useState<string | null>(null);
  
  const [refreshingSnapshotIds, setRefreshingSnapshotIds] = useState<Set<string>>(new Set());
  
  // Contact sheet state
  const [contactSheetOpen, setContactSheetOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<any>(null);
  
  // PATCH-T3: Dialogs for linking contacts and deals
  const [linkContactOpen, setLinkContactOpen] = useState(false);
  const [unlinkContactOpen, setUnlinkContactOpen] = useState(false);
  const [linkDealOpen, setLinkDealOpen] = useState(false);
  const [unlinkDealOpen, setUnlinkDealOpen] = useState(false);
  const [selectedSubscription, setSelectedSubscription] = useState<BepaidSubscription | null>(null);
  
  // Columns state with localStorage
  const [columns, setColumns] = useState<ColumnConfig[]>(() => {
    const saved = localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (saved) {
      try { return JSON.parse(saved); } catch { return DEFAULT_COLUMNS; }
    }
    return DEFAULT_COLUMNS;
  });
  
  useEffect(() => {
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(columns));
  }, [columns]);
  
  const queryClient = useQueryClient();
  const { hasRole: isSuperAdmin } = useHasRole('superadmin');
  
  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  
  const sortedVisibleColumns = useMemo(() => 
    [...columns].filter(c => c.visible).sort((a, b) => a.order - b.order),
    [columns]
  );

  // PATCH-U1: Load cached data from localStorage for instant display after F5
  const getCachedPayload = () => {
    try {
      const cached = localStorage.getItem(PAYLOAD_STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed?.subscriptions && Array.isArray(parsed.subscriptions)) {
          return parsed;
        }
      }
    } catch {}
    return null;
  };

  // PATCH-T6 + PATCH-U1: Improved caching with localStorage persist
  const { data, isLoading, refetch, isRefetching, error: fetchError } = useQuery({
    queryKey: ["bepaid-subscriptions-admin"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("bepaid-list-subscriptions");
      
      if (error) throw new Error(error.message || 'Ошибка Edge-функции');
      if (data?.error) throw new Error(data.error);
      if (!data || !Array.isArray(data.subscriptions)) {
        throw new Error('Некорректный ответ: subscriptions[] отсутствует');
      }
      
      const subs = (data.subscriptions || []).map((s: BepaidSubscription) => ({
        ...s,
        status: normalizeStatus(s.status),
        snapshot_state: s.snapshot_state ? normalizeStatus(s.snapshot_state) : undefined,
      }));
      
      const result = { 
        subscriptions: subs, 
        stats: data.stats as SubscriptionStats,
        debug: data.debug as DebugInfo | undefined,
      };
      
      // PATCH-U1: Save to localStorage for instant display after F5
      try {
        localStorage.setItem(PAYLOAD_STORAGE_KEY, JSON.stringify(result));
      } catch {}
      
      return result;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 24 * 60 * 60 * 1000, // 24 hours cache retention
    refetchOnWindowFocus: false,
    placeholderData: getCachedPayload, // PATCH-U1: Show cached data immediately
  });

  const subscriptions = data?.subscriptions || [];
  const debugInfo = data?.debug;
  
  const rawStats = data?.stats || { total: 0, active: 0, trial: 0, pending: 0, canceled: 0, cancelled: 0, orphans: 0, linked: 0 };
  const canceledCount = rawStats.canceled ?? rawStats.cancelled ?? 0;
  const pendingCount = rawStats.pending ?? 0;

  const urgentCount = useMemo(() => {
    return subscriptions.filter((s: BepaidSubscription) => {
      if (!s.next_billing_at || s.status === 'canceled') return false;
      const daysUntil = differenceInDays(new Date(s.next_billing_at), new Date());
      return daysUntil <= 7 && daysUntil >= 0 && s.is_orphan;
    }).length;
  }, [subscriptions]);

  const needsSupportCount = useMemo(() => {
    return subscriptions.filter((s: BepaidSubscription) => s.needs_support).length;
  }, [subscriptions]);

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
          const order: Record<string, number> = { active: 0, trial: 1, pending: 2, past_due: 3, canceled: 4 };
          aVal = order[a.status] ?? 5;
          bVal = order[b.status] ?? 5;
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

  // Mutations
  const reconcileMutation = useMutation({
    mutationFn: async (execute: boolean) => {
      const { data, error } = await supabase.functions.invoke("admin-reconcile-bepaid-legacy", {
        body: { dry_run: !execute, limit: 500 },
      });
      if (error) throw error;
      return data as ReconcileResult;
    },
    onSuccess: (data) => {
      setReconcileResult(data);
      if (!data.dry_run) {
        toast.success(`Синхронизация завершена: ${data.inserted} записей создано`);
        queryClient.invalidateQueries({ queryKey: ["bepaid-subscriptions-admin"] });
      }
    },
    onError: (e: any) => {
      toast.error("Ошибка синхронизации: " + e.message);
    },
  });

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
        const failedReasons = data.failed.map((f: any) => f.reason_code || f.error || 'неизвестно').join(', ');
        toast.error(`Не удалось отменить ${data.failed.length}: ${failedReasons}`);
      }
      
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

  const refreshSnapshotMutation = useMutation({
    mutationFn: async (subscriptionId: string) => {
      const { data, error } = await supabase.functions.invoke("bepaid-get-subscription-details", {
        body: { subscription_id: subscriptionId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      const stateLabel = STATUS_LABELS[data.snapshot?.state] || data.snapshot?.state || 'неизвестно';
      toast.success(`Статус обновлён: ${stateLabel}`);
      queryClient.invalidateQueries({ queryKey: ["bepaid-subscriptions-admin"] });
    },
    onError: (e: any) => {
      toast.error("Ошибка обновления: " + e.message);
    },
  });

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

  // PATCH-T5: Simplified emergency unlink (no UNLINK input required)
  const handleEmergencyUnlink = async () => {
    if (!targetEmergencyUnlinkId) return;
    
    try {
      const { data, error } = await supabase.functions.invoke('admin-bepaid-emergency-unlink', {
        body: { 
          provider_subscription_id: targetEmergencyUnlinkId,
          confirm_text: "UNLINK" // Always pass UNLINK since we use simple confirmation
        }
      });
      
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      
      toast.success('Подписка отвязана');
      setShowEmergencyUnlinkDialog(false);
      setEmergencyUnlinkConfirm("");
      setTargetEmergencyUnlinkId(null);
      queryClient.invalidateQueries({ queryKey: ["bepaid-subscriptions-admin"] });
    } catch (e: any) {
      toast.error('Ошибка отвязки: ' + e.message);
    }
  };

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
      return format(new Date(dateStr), "dd.MM.yy", { locale: ru });
    } catch {
      return dateStr;
    }
  };

  const getDaysUntilCharge = (dateStr: string | undefined) => {
    if (!dateStr) return null;
    try {
      return differenceInDays(new Date(dateStr), new Date());
    } catch {
      return null;
    }
  };

  const getStatusBadge = (status: string) => {
    const label = STATUS_LABELS[status] || status;
    switch (status) {
      case "active":
        return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-xs">{label}</Badge>;
      case "trial":
        return <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs">{label}</Badge>;
      case "pending":
        return <Badge className="bg-purple-500/10 text-purple-600 border-purple-500/20 text-xs">{label}</Badge>;
      case "past_due":
        return <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-xs">{label}</Badge>;
      case "canceled":
      case "terminated":
        return <Badge variant="secondary" className="text-xs">{label}</Badge>;
      default:
        return <Badge variant="outline" className="text-xs">{label}</Badge>;
    }
  };
  
  // PATCH-T1: Fixed contact sheet - search by user_id, not profile.id
  const openContactSheet = async (userId: string) => {
    try {
      // First try by user_id (the correct field)
      const { data: contact, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      
      if (error) throw error;
      
      if (!contact) {
        // Fallback: try by profile.id
        const { data: byId } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", userId)
          .maybeSingle();
          
        if (byId) {
          setSelectedContact(byId);
          setContactSheetOpen(true);
          return;
        }
        throw new Error("Контакт не найден");
      }
      
      setSelectedContact(contact);
      setContactSheetOpen(true);
    } catch (e) {
      console.error("Failed to load contact:", e);
      toast.error("Не удалось загрузить контакт");
    }
  };
  
  // DnD handlers
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    
    const oldIndex = columns.findIndex(c => c.key === active.id);
    const newIndex = columns.findIndex(c => c.key === over.id);
    
    const reordered = arrayMove(columns, oldIndex, newIndex).map((col, index) => ({
      ...col,
      order: index,
    }));
    
    setColumns(reordered);
  };
  
  const handleResize = (key: string, width: number) => {
    setColumns(columns.map(c => c.key === key ? { ...c, width } : c));
  };
  
  const toggleColumnVisibility = (key: string) => {
    setColumns(columns.map(c => c.key === key ? { ...c, visible: !c.visible } : c));
  };
  
  // Render cell based on column key
  const renderCell = (sub: BepaidSubscription, columnKey: string) => {
    const daysUntil = getDaysUntilCharge(sub.next_billing_at);
    const isUrgent = daysUntil !== null && daysUntil <= 7 && daysUntil >= 0 && sub.is_orphan;
    const isRefreshingSnapshot = refreshingSnapshotIds.has(sub.id);
    
    switch (columnKey) {
      case 'checkbox':
        return (
          <Checkbox
            checked={selectedIds.has(sub.id)}
            onCheckedChange={() => handleSelectOne(sub.id)}
            disabled={sub.status === "canceled"}
          />
        );
        
      case 'id':
        return (
          <div>
            <button
              onClick={() => copyId(sub.id)}
              className="font-mono text-xs hover:text-primary flex items-center gap-1"
              title="Скопировать ID"
            >
              {sub.id.slice(0, 12)}...
              {copiedId === sub.id ? (
                <Check className="h-3 w-3 text-emerald-500" />
              ) : (
                <Copy className="h-3 w-3 opacity-50" />
              )}
            </button>
            {sub.needs_support && (
              <Badge variant="destructive" className="mt-0.5 text-[10px] py-0">
                Помощь
              </Badge>
            )}
            {sub.details_missing && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="mt-0.5 text-[10px] py-0 text-amber-600 border-amber-500/30 cursor-help">
                    Нет деталей
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs text-xs">
                  bePaid API не вернул информацию по этой подписке.
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        );
        
      case 'status':
        return (
          <div>
            {getStatusBadge(sub.status)}
            {sub.snapshot_state && sub.snapshot_state !== sub.status && (
              <div className="text-[10px] text-muted-foreground mt-0.5">
                bePaid: {STATUS_LABELS[sub.snapshot_state] || sub.snapshot_state}
              </div>
            )}
          </div>
        );
        
      case 'customer':
        return (
          <div>
            {sub.linked_user_id ? (
              <button
                onClick={() => openContactSheet(sub.linked_user_id!)}
                className="text-xs font-medium hover:underline hover:text-primary text-left truncate block max-w-[150px]"
              >
                {sub.linked_profile_name || sub.customer_name || sub.customer_email || "—"}
              </button>
            ) : (
              <span className="text-xs truncate block max-w-[150px]">
                {sub.customer_name || sub.customer_email || "—"}
              </span>
            )}
            {sub.customer_name && sub.customer_email && !sub.linked_user_id && (
              <div className="text-[10px] text-muted-foreground truncate max-w-[150px]">{sub.customer_email}</div>
            )}
          </div>
        );
        
      case 'plan':
        return (
          <span className="text-xs truncate block max-w-[140px]" title={sub.plan_title}>
            {sub.plan_title || "—"}
          </span>
        );
        
      case 'amount':
        return (
          <span className="text-xs font-medium tabular-nums">
            {sub.plan_amount.toFixed(2)} {sub.plan_currency}
          </span>
        );
        
      case 'next_billing':
        return sub.next_billing_at ? (
          <div className="flex items-center gap-1">
            <Calendar className="h-3 w-3 text-muted-foreground" />
            <span className={cn("text-xs", isUrgent && "text-amber-600 font-medium")}>
              {formatDate(sub.next_billing_at)}
            </span>
            {isUrgent && daysUntil !== null && (
              <span className="text-[10px] text-amber-600">({daysUntil}д)</span>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        );
        
      case 'card':
        return sub.card_last4 ? (
          <span className="text-xs text-muted-foreground">
            {sub.card_brand} •••• {sub.card_last4}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        );
        
      case 'created':
        return (
          <span className="text-xs text-muted-foreground">
            {formatDate(sub.created_at)}
          </span>
        );
        
      // PATCH-T4: New columns
      case 'payment_id':
        return sub.linked_payment_id ? (
          <button
            onClick={() => copyId(sub.linked_payment_id!)}
            className="font-mono text-xs hover:text-primary flex items-center gap-1"
            title="Скопировать ID платежа"
          >
            {sub.linked_payment_id.slice(0, 8)}...
            {copiedId === sub.linked_payment_id ? (
              <Check className="h-3 w-3 text-emerald-500" />
            ) : (
              <Copy className="h-3 w-3 opacity-50" />
            )}
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        );
        
      case 'deal':
        return sub.linked_order_id ? (
          <button
            onClick={() => copyId(sub.linked_order_id!)}
            className="text-xs font-medium hover:underline hover:text-primary"
          >
            {sub.linked_order_number || sub.linked_order_id.slice(0, 8)}
          </button>
        ) : (
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-6 px-2"
            onClick={() => { 
              setSelectedSubscription(sub); 
              setLinkDealOpen(true); 
            }}
          >
            <Plus className="h-3 w-3" />
          </Button>
        );
        
      case 'canceled_at':
        return sub.canceled_at ? (
          <span className="text-xs text-muted-foreground">
            {formatDate(sub.canceled_at)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        );
        
      case 'connection':
        return sub.is_orphan ? (
          <Badge variant="outline" className="text-[10px] text-destructive border-destructive/30">
            <Link2Off className="h-2.5 w-2.5 mr-1" />
            Сирота
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-500/30">
            <Link2 className="h-2.5 w-2.5 mr-1" />
            Связана
          </Badge>
        );
        
      // PATCH-T2: Fixed bePaid URL + PATCH-T3: Added actions dropdown
      case 'actions':
        return (
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => window.open(`https://admin.bepaid.by/subscriptions/${sub.id}`, '_blank')}
                >
                  <ExternalLink className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Открыть в bePaid</TooltipContent>
            </Tooltip>
            
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => handleRefreshSnapshot(sub.id)}
                  disabled={isRefreshingSnapshot}
                >
                  {isRefreshingSnapshot ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3 w-3" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Обновить статус</TooltipContent>
            </Tooltip>
            
            {/* Actions dropdown menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6">
                  <MoreHorizontal className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => { setSelectedSubscription(sub); setLinkContactOpen(true); }}>
                  <User className="h-3 w-3 mr-2" />
                  {sub.linked_user_id ? "Перепривязать контакт" : "Привязать контакт"}
                </DropdownMenuItem>
                {sub.linked_user_id && (
                  <DropdownMenuItem onClick={() => { setSelectedSubscription(sub); setUnlinkContactOpen(true); }}>
                    <Unlink className="h-3 w-3 mr-2" />
                    Отвязать контакт
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => { setSelectedSubscription(sub); setLinkDealOpen(true); }}>
                  <Handshake className="h-3 w-3 mr-2" />
                  {sub.linked_order_id ? "Перепривязать сделку" : "Привязать сделку"}
                </DropdownMenuItem>
                {sub.linked_order_id && (
                  <DropdownMenuItem onClick={() => { setSelectedSubscription(sub); setUnlinkDealOpen(true); }}>
                    <Unlink className="h-3 w-3 mr-2" />
                    Отвязать сделку
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                {!sub.is_orphan && (
                  canUnlink(sub) ? (
                    <DropdownMenuItem 
                      onClick={() => {
                        setTargetEmergencyUnlinkId(sub.id);
                        setShowEmergencyUnlinkDialog(true);
                      }}
                    >
                      <Unlink className="h-3 w-3 mr-2" />
                      Отвязать подписку
                    </DropdownMenuItem>
                  ) : isSuperAdmin ? (
                    <DropdownMenuItem 
                      className="text-destructive"
                      onClick={() => {
                        setTargetEmergencyUnlinkId(sub.id);
                        setShowEmergencyUnlinkDialog(true);
                      }}
                    >
                      <ShieldAlert className="h-3 w-3 mr-2" />
                      Аварийная отвязка
                    </DropdownMenuItem>
                  ) : null
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
        
      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      {/* Clickable stats row - glassmorphism style */}
      <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-card/20 backdrop-blur-md border border-border/20">
        <button
          onClick={() => setStatusFilter("all")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-all cursor-pointer",
            statusFilter === "all" 
              ? "bg-muted/80 ring-2 ring-primary/30" 
              : "bg-muted/50 hover:bg-muted/70"
          )}
        >
          <span className="font-semibold">{rawStats.total}</span>
          <span className="text-muted-foreground text-xs">всего</span>
        </button>
        
        <button
          onClick={() => setStatusFilter("active")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-all cursor-pointer",
            statusFilter === "active" 
              ? "bg-emerald-500/20 text-emerald-600 ring-2 ring-emerald-500/30" 
              : "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"
          )}
        >
          <span className="font-semibold">{rawStats.active}</span>
          <span className="text-xs">активных</span>
        </button>
        
        <button
          onClick={() => setStatusFilter("trial")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-all cursor-pointer",
            statusFilter === "trial" 
              ? "bg-blue-500/20 text-blue-600 ring-2 ring-blue-500/30" 
              : "bg-blue-500/10 text-blue-600 hover:bg-blue-500/20"
          )}
        >
          <span className="font-semibold">{rawStats.trial}</span>
          <span className="text-xs">пробных</span>
        </button>
        
        {pendingCount > 0 && (
          <button
            onClick={() => setStatusFilter("pending")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-all cursor-pointer",
              statusFilter === "pending" 
                ? "bg-purple-500/20 text-purple-600 ring-2 ring-purple-500/30" 
                : "bg-purple-500/10 text-purple-600 hover:bg-purple-500/20"
            )}
          >
            <span className="font-semibold">{pendingCount}</span>
            <span className="text-xs">ожидает</span>
          </button>
        )}
        
        {canceledCount > 0 && (
          <button
            onClick={() => setStatusFilter("canceled")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-all cursor-pointer",
              statusFilter === "canceled" 
                ? "bg-muted/60 ring-2 ring-muted-foreground/30" 
                : "bg-muted/30 hover:bg-muted/50 text-muted-foreground"
            )}
          >
            <span className="font-semibold">{canceledCount}</span>
            <span className="text-xs">отменённых</span>
          </button>
        )}
        
        {rawStats.orphans > 0 && (
          <button
            onClick={() => setLinkFilter(linkFilter === "orphan" ? "all" : "orphan")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-all cursor-pointer",
              linkFilter === "orphan" 
                ? "bg-red-500/20 text-red-600 ring-2 ring-red-500/30" 
                : "bg-red-500/10 text-red-600 hover:bg-red-500/20"
            )}
          >
            <span className="font-semibold">{rawStats.orphans}</span>
            <span className="text-xs">сирот</span>
          </button>
        )}
        
        {urgentCount > 0 && (
          <button
            onClick={() => setLinkFilter(linkFilter === "urgent" ? "all" : "urgent")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-all cursor-pointer",
              linkFilter === "urgent" 
                ? "bg-amber-500/20 text-amber-600 ring-2 ring-amber-500/30" 
                : "bg-amber-500/10 text-amber-600 hover:bg-amber-500/20"
            )}
          >
            <AlertTriangle className="h-3 w-3" />
            <span className="font-semibold">{urgentCount}</span>
            <span className="text-xs">≤7 дней</span>
          </button>
        )}
        
        {needsSupportCount > 0 && (
          <button
            onClick={() => setLinkFilter(linkFilter === "needs_support" ? "all" : "needs_support")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-all cursor-pointer",
              linkFilter === "needs_support" 
                ? "bg-amber-500/20 text-amber-600 ring-2 ring-amber-500/30" 
                : "bg-amber-500/10 text-amber-600 hover:bg-amber-500/20"
            )}
          >
            <HelpCircle className="h-3 w-3" />
            <span className="font-semibold">{needsSupportCount}</span>
            <span className="text-xs">помощь</span>
          </button>
        )}
      </div>

      {/* Toolbar - glassmorphism */}
      <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-card/20 backdrop-blur-md border border-border/20">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-40 h-8 bg-background/50"
          />
        </div>
        
        <Select value={linkFilter} onValueChange={(v) => setLinkFilter(v as LinkFilter)}>
          <SelectTrigger className="w-36 h-8 bg-background/50">
            <SelectValue placeholder="Связь" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="linked">Связанные</SelectItem>
            <SelectItem value="orphan">Сироты</SelectItem>
            <SelectItem value="urgent">Срочные (≤7д)</SelectItem>
            <SelectItem value="needs_support">Нужна помощь</SelectItem>
          </SelectContent>
        </Select>
        
        <Select value={`${sortField}-${sortDir}`} onValueChange={(v) => {
          const [field, dir] = v.split("-") as [SortField, SortDir];
          setSortField(field);
          setSortDir(dir);
        }}>
          <SelectTrigger className="w-40 h-8 bg-background/50">
            <SelectValue placeholder="Сортировка" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="next_billing_at-asc">Списание ↑</SelectItem>
            <SelectItem value="next_billing_at-desc">Списание ↓</SelectItem>
            <SelectItem value="created_at-desc">Создано ↓</SelectItem>
            <SelectItem value="created_at-asc">Создано ↑</SelectItem>
            <SelectItem value="plan_amount-desc">Сумма ↓</SelectItem>
            <SelectItem value="plan_amount-asc">Сумма ↑</SelectItem>
          </SelectContent>
        </Select>
        
        {/* Column visibility dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 bg-background/50">
              <Settings className="h-3.5 w-3.5 mr-1" />
              Колонки
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {columns.filter(c => c.key !== 'checkbox' && c.key !== 'actions').map(col => (
              <DropdownMenuCheckboxItem
                key={col.key}
                checked={col.visible}
                onCheckedChange={() => toggleColumnVisibility(col.key)}
              >
                {col.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        
        <div className="flex-1" />
        
        {/* Debug info */}
        {debugInfo && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Info className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 text-xs space-y-2">
              <div className="font-medium mb-2">Диагностика интеграции</div>
              <div className="space-y-1">
                <div><span className="text-muted-foreground">Источник:</span> {debugInfo.creds_source === 'integration_instance_only' ? 'Интеграция' : 'Не настроено'}</div>
                <div><span className="text-muted-foreground">Shop ID:</span> {debugInfo.shop_id_present ? '✓' : '✗'}</div>
                <div><span className="text-muted-foreground">Secret:</span> {debugInfo.secret_present ? '✓' : '✗'}</div>
              </div>
              <div className="border-t pt-2 space-y-1">
                <div><span className="text-muted-foreground">API:</span> {debugInfo.api_list_count ?? 0}</div>
                <div><span className="text-muted-foreground">БД записей:</span> {debugInfo.db_records_count ?? debugInfo.provider_subscriptions_count ?? 0}</div>
                <div><span className="text-muted-foreground">Из БД:</span> {debugInfo.db_enriched_count ?? 0}</div>
                <div><span className="text-muted-foreground">Детали:</span> {debugInfo.details_fetched_count ?? 0} / {debugInfo.details_failed_count ?? 0}</div>
                <div><span className="text-muted-foreground">Сохранено:</span> {debugInfo.upserted_count ?? 0}</div>
              </div>
            </PopoverContent>
          </Popover>
        )}
        
        <Tooltip>
          <TooltipTrigger asChild>
            <Button 
              variant="outline" 
              size="sm"
              className="h-8 bg-background/50"
              onClick={() => {
                setReconcileResult(null);
                setShowReconcileDialog(true);
                reconcileMutation.mutate(false);
              }}
              disabled={reconcileMutation.isPending}
            >
              {reconcileMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Database className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Синхронизация</TooltipContent>
        </Tooltip>
        
        <Button 
          variant="outline" 
          size="sm"
          className="h-8 bg-background/50"
          onClick={() => refetch()}
          disabled={isRefetching}
        >
          {isRefetching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Bulk actions */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-muted/50 backdrop-blur-md rounded-xl border border-border/20">
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
            Отменить
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

      {/* Error banner */}
      {fetchError && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl">
          <div className="flex items-center gap-2 text-destructive font-medium">
            <AlertTriangle className="h-4 w-4" />
            Ошибка загрузки подписок
          </div>
          <div className="text-sm text-muted-foreground mt-1">
            {(fetchError as Error).message || 'Неизвестная ошибка'}
          </div>
        </div>
      )}

      {/* Table - glassmorphism with horizontal scroll */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : fetchError ? (
        <div className="text-center py-12 text-muted-foreground">
          Не удалось загрузить подписки.
        </div>
      ) : filteredSubscriptions.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground rounded-xl bg-card/20 backdrop-blur-md border border-border/20">
          {subscriptions.length === 0 
            ? "Подписки не найдены" 
            : "Нет подписок по выбранным фильтрам"}
        </div>
      ) : (
        <div className="rounded-xl border border-border/30 bg-card/30 backdrop-blur-xl overflow-hidden">
          <div className="overflow-x-auto">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <Table className="min-w-[900px]">
                <TableHeader>
                  <SortableContext items={sortedVisibleColumns.map(c => c.key)} strategy={horizontalListSortingStrategy}>
                    <TableRow className="hover:bg-transparent">
                      {sortedVisibleColumns.map(col => (
                        <SortableResizableHeader key={col.key} column={col} onResize={handleResize}>
                          {col.key === 'checkbox' ? (
                            <Checkbox
                              checked={selectedIds.size === filteredSubscriptions.filter((s: BepaidSubscription) => s.status !== 'canceled').length && filteredSubscriptions.length > 0}
                              onCheckedChange={handleSelectAll}
                            />
                          ) : col.label}
                        </SortableResizableHeader>
                      ))}
                    </TableRow>
                  </SortableContext>
                </TableHeader>
                <TableBody>
                  {filteredSubscriptions.map((sub: BepaidSubscription) => {
                    const daysUntil = getDaysUntilCharge(sub.next_billing_at);
                    const isUrgent = daysUntil !== null && daysUntil <= 7 && daysUntil >= 0 && sub.is_orphan;
                    
                    return (
                      <TableRow 
                        key={sub.id} 
                        className={cn(
                          "h-10 hover:bg-muted/30 transition-colors",
                          isUrgent && "bg-amber-500/5 border-l-2 border-l-amber-500",
                          sub.is_orphan && !isUrgent && "bg-red-500/5"
                        )}
                      >
                        {sortedVisibleColumns.map(col => (
                          <TableCell key={col.key} className="py-1.5 px-2" style={{ width: col.width }}>
                            {renderCell(sub, col.key)}
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </DndContext>
          </div>
          <div className="px-3 py-2 text-xs text-muted-foreground border-t border-border/20 bg-muted/20">
            Показано {filteredSubscriptions.length} из {subscriptions.length}
          </div>
        </div>
      )}

      {/* Contact Detail Sheet */}
      <ContactDetailSheet
        contact={selectedContact}
        open={contactSheetOpen}
        onOpenChange={setContactSheetOpen}
      />

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
                ⚠️ Автоматические списания прекратятся. При отказе bePaid подписка будет помечена «Нужна помощь».
              </p>
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
              Отменить {selectedIds.size}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* PATCH-T5: Simplified Emergency Unlink dialog - no UNLINK input */}
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
                : "Аварийная отвязка"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {!canUnlink(filteredSubscriptions.find(s => s.id === targetEmergencyUnlinkId) || {} as BepaidSubscription) && (
                  <div className="p-3 bg-destructive/10 border border-destructive/20 rounded text-destructive text-sm">
                    <p className="font-medium">⚠️ Подписка НЕ отменена в bePaid!</p>
                    <p className="mt-1">Автосписания могут продолжаться.</p>
                  </div>
                )}
                <p>Вы уверены, что хотите отвязать подписку от системы?</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleEmergencyUnlink}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <Unlink className="h-4 w-4 mr-2" />
              Да, отвязать
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reconcile dialog */}
      <AlertDialog open={showReconcileDialog} onOpenChange={setShowReconcileDialog}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Синхронизация старых подписок
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <div className="text-sm text-muted-foreground">
                  Находит подписки bePaid из старых заказов и создаёт записи в системе. 
                  Деньги <strong>НЕ</strong> списываются.
                </div>
                
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
                        <div className="text-xs text-muted-foreground">Найдено</div>
                      </div>
                      <div className="p-2 bg-muted rounded">
                        <div className="font-medium">{reconcileResult.already_present}</div>
                        <div className="text-xs text-muted-foreground">Уже есть</div>
                      </div>
                      <div className="p-2 bg-emerald-500/10 rounded border border-emerald-500/20">
                        <div className="font-medium text-emerald-600">
                          {reconcileResult.dry_run ? reconcileResult.would_insert : reconcileResult.inserted}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {reconcileResult.dry_run ? "Будет создано" : "Создано"}
                        </div>
                      </div>
                      <div className="p-2 bg-amber-500/10 rounded border border-amber-500/20">
                        <div className="font-medium text-amber-600">{reconcileResult.still_unlinked}</div>
                        <div className="text-xs text-muted-foreground">Сироты</div>
                      </div>
                    </div>

                    {reconcileResult.dry_run && reconcileResult.would_insert > 0 && (
                      <div className="p-2 bg-amber-500/10 rounded border border-amber-500/20 text-sm">
                        ⚠️ Предварительный просмотр. Нажмите «Выполнить».
                      </div>
                    )}

                    {!reconcileResult.dry_run && (
                      <div className="p-2 bg-emerald-500/10 rounded border border-emerald-500/20 text-sm">
                        ✅ Создано {reconcileResult.inserted} записей.
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

      {/* Subscription-specific dialogs for linking contacts/deals */}
      {selectedSubscription && (
        <LinkSubscriptionContactDialog
          open={linkContactOpen}
          onOpenChange={setLinkContactOpen}
          subscriptionId={selectedSubscription.id}
          customerEmail={selectedSubscription.customer_email}
          cardLast4={selectedSubscription.card_last4}
          cardBrand={selectedSubscription.card_brand}
          onSuccess={() => {
            setLinkContactOpen(false);
            setSelectedSubscription(null);
            queryClient.invalidateQueries({ queryKey: ["bepaid-subscriptions-admin"] });
          }}
        />
      )}

      {selectedSubscription && selectedSubscription.linked_user_id && (
        <UnlinkSubscriptionContactDialog
          open={unlinkContactOpen}
          onOpenChange={setUnlinkContactOpen}
          subscriptionId={selectedSubscription.id}
          profileId={selectedSubscription.linked_user_id}
          profileName={selectedSubscription.linked_profile_name}
          onSuccess={() => {
            setUnlinkContactOpen(false);
            setSelectedSubscription(null);
            queryClient.invalidateQueries({ queryKey: ["bepaid-subscriptions-admin"] });
          }}
        />
      )}

      {selectedSubscription && (
        <LinkSubscriptionDealDialog
          open={linkDealOpen}
          onOpenChange={setLinkDealOpen}
          subscriptionId={selectedSubscription.id}
          amount={selectedSubscription.plan_amount}
          currency={selectedSubscription.plan_currency}
          profileId={selectedSubscription.linked_user_id}
          onSuccess={() => {
            setLinkDealOpen(false);
            setSelectedSubscription(null);
            queryClient.invalidateQueries({ queryKey: ["bepaid-subscriptions-admin"] });
          }}
        />
      )}

      {selectedSubscription && selectedSubscription.linked_order_id && (
        <UnlinkSubscriptionDealDialog
          open={unlinkDealOpen}
          onOpenChange={setUnlinkDealOpen}
          subscriptionId={selectedSubscription.id}
          orderId={selectedSubscription.linked_order_id}
          orderNumber={selectedSubscription.linked_order_number}
          onSuccess={() => {
            setUnlinkDealOpen(false);
            setSelectedSubscription(null);
            queryClient.invalidateQueries({ queryKey: ["bepaid-subscriptions-admin"] });
          }}
        />
      )}
    </div>
  );
}
