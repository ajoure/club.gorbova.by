import { useState, useMemo, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { RefreshCw, Search, CreditCard, AlertTriangle, CheckCircle, XCircle, Clock, Filter, Send, Mail, GripVertical, ArrowUp, ArrowDown, ArrowUpDown, Power, MoreHorizontal, Wrench, Loader2, FileText } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { format, isToday, isPast, isBefore, addDays, subDays, startOfDay, endOfDay } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useTableSort } from "@/hooks/useTableSort";
import { SortDirection } from "@/components/ui/sortable-table-head";
import { toast } from "sonner";
import { ContactDetailSheet } from "@/components/admin/ContactDetailSheet";
import { NotificationStatusIndicators, NotificationLegend, type NotificationLog } from "./NotificationStatusIndicators";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ColumnSettings, ColumnConfig } from "@/components/admin/ColumnSettings";
import { usePermissions } from "@/hooks/usePermissions";
import { BackfillSnapshotTool } from "./BackfillSnapshotTool";
import { Backfill2026OrdersTool } from "./Backfill2026OrdersTool";
import { FixPaymentsIntegrityTool } from "./FixPaymentsIntegrityTool";
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

// Timezone for all date calculations
const MINSK_TZ = 'Europe/Minsk';

// PATCH-6: Staff emails - excluded from metrics, reminders, and access changes
const STAFF_EMAILS = [
  'a.bruylo@ajoure.by',
  'nrokhmistrov@gmail.com',
  'ceo@ajoure.by',
  'irenessa@yandex.ru',
];

type FilterType = 'all' | 'due_today' | 'due_week' | 'overdue' | 'no_card' | 'no_token' | 'pm_inactive' | 'max_attempts' | 'no_charge_date' | 'in_grace' | 'expired_reentry' | 'bepaid';

const FILTER_OPTIONS: { value: FilterType; label: string; icon?: any }[] = [
  { value: 'all', label: 'Все' },
  { value: 'due_today', label: 'К списанию сегодня', icon: Clock },
  { value: 'due_week', label: 'К списанию за неделю' },
  { value: 'overdue', label: 'Просрочено', icon: AlertTriangle },
  { value: 'in_grace', label: 'В grace (72ч)', icon: Clock },
  { value: 'expired_reentry', label: 'Удалённые', icon: XCircle },
  { value: 'no_charge_date', label: 'Нет даты списания', icon: AlertTriangle },
  { value: 'no_card', label: 'Без карты', icon: CreditCard },
  { value: 'no_token', label: 'Без токена' },
  { value: 'pm_inactive', label: 'PM неактивен' },
  { value: 'max_attempts', label: 'Макс. попыток' },
  { value: 'bepaid', label: 'BePaid подписки', icon: CreditCard },
];

// Relevant event types for notification indicators
const RELEVANT_TG_EVENT_TYPES = [
  'subscription_reminder_7d',
  'subscription_reminder_3d',
  'subscription_reminder_1d',
  'subscription_no_card_warning',
  // Grace period events
  'grace_started',
  'grace_24h_left',
  'grace_48h_left',
  'grace_expired',
];

// Column configuration
const DEFAULT_COLUMNS: ColumnConfig[] = [
  { key: "checkbox", label: "", visible: true, width: 40, order: 0 },
  { key: "contact", label: "Контакт", visible: true, width: 160, order: 1 },
  { key: "product", label: "Продукт", visible: true, width: 130, order: 2 },
  { key: "billing_type", label: "Биллинг", visible: true, width: 70, order: 3 },
  { key: "amount", label: "Сумма", visible: true, width: 90, order: 4 },
  { key: "next_charge", label: "К списанию", visible: true, width: 100, order: 5 },
  { key: "access_end", label: "Доступ до", visible: true, width: 90, order: 6 },
  { key: "grace_remaining", label: "Grace", visible: true, width: 80, order: 7 },
  { key: "attempts", label: "Попытки", visible: true, width: 70, order: 8 },
  { key: "card", label: "Карта", visible: true, width: 50, order: 9 },
  { key: "pm", label: "PM", visible: true, width: 80, order: 10 },
  { key: "last_attempt", label: "Last Attempt", visible: true, width: 100, order: 11 },
  { key: "tg_status", label: "TG 7/3/1", visible: true, width: 70, order: 12 },
  { key: "email_status", label: "Email 7/3/1", visible: true, width: 70, order: 13 },
];

const STORAGE_KEY = 'admin_auto_renewals_columns_v1';

// Columns that should NOT be sortable
const NON_SORTABLE_COLUMNS = new Set(['checkbox', 'card', 'tg_status', 'email_status']);

// Sortable resizable header component with sorting support
interface SortableResizableHeaderProps {
  column: ColumnConfig;
  onResize: (key: string, width: number) => void;
  onSort?: (key: string) => void;
  sortKey?: string | null;
  sortDirection?: SortDirection;
  children: React.ReactNode;
}

function SortableResizableHeader({ 
  column, 
  onResize, 
  onSort,
  sortKey,
  sortDirection,
  children 
}: SortableResizableHeaderProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: column.key });
  
  const isSortable = onSort && !NON_SORTABLE_COLUMNS.has(column.key);
  const isActive = sortKey === column.key;
  
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
  
  const handleLabelClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isSortable && onSort) {
      onSort(column.key);
    }
  };
  
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    width: column.width,
    minWidth: 50,
    position: 'relative' as const,
    opacity: isDragging ? 0.5 : 1,
  };
  
  // Non-draggable columns (checkbox)
  if (column.key === 'checkbox') {
    return (
      <TableHead style={{ width: column.width, minWidth: 40 }}>
        {children}
      </TableHead>
    );
  }
  
  return (
    <TableHead ref={setNodeRef} style={style}>
      <div className="flex items-center gap-1">
        {/* Drag handle - only drag via grip */}
        <div 
          {...attributes} 
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-0.5 hover:bg-muted rounded opacity-50 hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="w-3 h-3" />
        </div>
        {/* Clickable label area for sorting */}
        <div 
          className={cn(
            "flex-1 truncate flex items-center gap-1",
            isSortable && "cursor-pointer hover:text-foreground"
          )}
          onClick={handleLabelClick}
        >
          <span className="truncate">{children}</span>
          {/* Sort indicator */}
          {isSortable && (
            isActive && sortDirection ? (
              sortDirection === 'asc' ? (
                <ArrowUp className="h-3 w-3 shrink-0" />
              ) : (
                <ArrowDown className="h-3 w-3 shrink-0" />
              )
            ) : (
              <ArrowUpDown className="h-3 w-3 shrink-0 opacity-30" />
            )
          )}
        </div>
      </div>
      {/* Resize handle */}
      <div
        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/50 active:bg-primary transition-colors"
        onMouseDown={handleMouseDown}
      />
    </TableHead>
  );
}

interface AutoRenewal {
  id: string;
  user_id: string;
  order_id: string | null;
  next_charge_at: string | null;
  access_end_at: string;
  status: string;
  charge_attempts: number;
  payment_method_id: string | null;
  has_payment_token: boolean;
  meta: any;
  product_name: string | null;
  tariff_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  profile_id: string | null;
  pm_status: string | null;
  pm_last4: string | null;
  pm_brand: string | null;
  order_final_price: number | null;
  order_currency: string | null;
  // PATCH-2: Filter flag
  is_subscription: boolean;
  // PATCH-3: Trial detection
  is_trial: boolean;
  tariff_original_price: number | null;
  tariff_trial_price: number | null;
  // PATCH-6: Staff/comped detection
  is_staff: boolean;
  is_comped: boolean;
  pricing_source: 'meta' | 'order' | 'tariff_fallback';
  // PATCH: Grace period fields
  grace_period_status: string | null;
  grace_period_started_at: string | null;
  grace_period_ends_at: string | null;
  // PATCH-7: Billing type (provider-managed subscriptions)
  billing_type: 'mit' | 'provider_managed';
  // PATCH 3.1: BePaid flag from provider_subscriptions (source of truth)
  is_bepaid: boolean;
}

// Helper to get charge amount with priority (PATCH-3: Trial handling, PATCH-6: Staff/comped)
function getChargeAmount(renewal: AutoRenewal): { amount: number; currency: string; source: string } {
  // PATCH-6: Staff subscriptions always show 0 BYN
  if (renewal.is_staff) {
    return { amount: 0, currency: 'BYN', source: 'staff_comped' };
  }
  
  // PATCH-6: Comped subscriptions (last price = 0)
  if (renewal.is_comped) {
    return { amount: 0, currency: 'BYN', source: 'comped' };
  }
  
  // 1. Meta override (highest priority - manually set)
  const metaAmount = renewal.meta?.recurring_amount;
  if (metaAmount && Number(metaAmount) > 0) {
    return { 
      amount: Number(metaAmount), 
      currency: renewal.meta?.recurring_currency || 'BYN',
      source: 'meta'
    };
  }
  
  // 2. PATCH-3: Trial subscription → use tariff.original_price (NOT order.final_price = 1 BYN)
  if (renewal.is_trial || renewal.status === 'trial') {
    const originalPrice = renewal.tariff_original_price;
    if (originalPrice && Number(originalPrice) > 0) {
      return { amount: Number(originalPrice), currency: 'BYN', source: 'tariff_trial' };
    }
  }
  
  // 3. Regular order price (last factual price from order)
  if (renewal.order_final_price && Number(renewal.order_final_price) > 0) {
    return { 
      amount: Number(renewal.order_final_price), 
      currency: renewal.order_currency || 'BYN',
      source: 'order'
    };
  }
  
  // 4. Fallback to tariff.original_price (log this case)
  const originalPrice = renewal.tariff_original_price;
  if (originalPrice && Number(originalPrice) > 0) {
    return { amount: Number(originalPrice), currency: 'BYN', source: 'tariff_fallback' };
  }
  
  return { amount: 0, currency: 'BYN', source: 'unknown' };
}

// Format amount with 2 decimals + currency code
function formatAmount(amount: number, currency: string = 'BYN'): string {
  if (amount <= 0) return '—';
  return `${amount.toFixed(2)} ${currency}`;
}

// Check if date is today in Minsk timezone
function isTodayMinsk(date: Date): boolean {
  const nowMinsk = toZonedTime(new Date(), MINSK_TZ);
  const dateMinsk = toZonedTime(date, MINSK_TZ);
  return (
    dateMinsk.getFullYear() === nowMinsk.getFullYear() &&
    dateMinsk.getMonth() === nowMinsk.getMonth() &&
    dateMinsk.getDate() === nowMinsk.getDate()
  );
}

// Check if date is past in Minsk timezone
function isPastMinsk(date: Date): boolean {
  const nowMinsk = toZonedTime(new Date(), MINSK_TZ);
  const dateMinsk = toZonedTime(date, MINSK_TZ);
  // Compare start of day
  const todayStart = startOfDay(nowMinsk);
  const dateStart = startOfDay(dateMinsk);
  return dateStart < todayStart;
}

export function AutoRenewalsTabContent() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [contactSheetOpen, setContactSheetOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<any>(null);
  
  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  // Backfill snapshot tool dialog state
  const [backfillDialogOpen, setBackfillDialogOpen] = useState(false);
  
  // Backfill 2026 orders tool dialog state
  const [backfill2026DialogOpen, setBackfill2026DialogOpen] = useState(false);
  
  // Fix Payments Integrity tool dialog state
  const [fixIntegrityDialogOpen, setFixIntegrityDialogOpen] = useState(false);
  
  // Column state with localStorage persistence
  const [columns, setColumns] = useState<ColumnConfig[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return DEFAULT_COLUMNS.map(dc => {
          const savedCol = parsed.find((p: ColumnConfig) => p.key === dc.key);
          return savedCol ? { ...dc, ...savedCol } : dc;
        });
      } catch { return DEFAULT_COLUMNS; }
    }
    return DEFAULT_COLUMNS;
  });
  
  // Save to localStorage on change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(columns));
  }, [columns]);
  
  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  
  // Sorted visible columns
  const sortedColumns = useMemo(() => 
    [...columns].filter(c => c.visible).sort((a, b) => a.order - b.order),
    [columns]
  );
  
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    
    const oldIndex = columns.findIndex(c => c.key === active.id);
    const newIndex = columns.findIndex(c => c.key === over.id);
    
    const reordered = arrayMove(columns, oldIndex, newIndex).map((col, i) => ({ ...col, order: i }));
    setColumns(reordered);
  };
  
  const handleResize = (key: string, width: number) => {
    setColumns(prev => prev.map(c => c.key === key ? { ...c, width } : c));
  };

  // Main query for subscriptions
  const { data: renewals, isLoading, refetch } = useQuery({
    queryKey: ['auto-renewals'],
    queryFn: async () => {
      // Use the safe view that excludes payment_token for security
      const { data, error } = await supabase
        .from('subscriptions_v2_safe')
        .select(`
          id,
          user_id,
          order_id,
          next_charge_at,
          access_end_at,
          status,
          charge_attempts,
          payment_method_id,
          has_payment_token,
          meta,
          is_trial,
          tariff_id,
          billing_type,
          grace_period_status,
          grace_period_started_at,
          grace_period_ends_at,
          tariffs (
            name,
            original_price,
            trial_price,
            products_v2 (name, category),
            tariff_offers (requires_card_tokenization)
          ),
          payment_methods (status, last4, brand),
          orders_v2 (final_price, currency)
        `)
        .eq('auto_renew', true)
        .in('status', ['active', 'trial', 'past_due'])
        .order('next_charge_at', { ascending: true, nullsFirst: false })
        .limit(500);
      
      if (error) throw error;

      // PATCH 3.1: Fetch active provider_subscriptions to determine BePaid status (source of truth)
      const { data: providerSubs } = await supabase
        .from('provider_subscriptions')
        .select('id, subscription_v2_id, provider_subscription_id, user_id, profile_id, amount_cents, currency, next_charge_at, card_brand, card_last4, raw_data, state')
        .eq('state', 'active');

      // Build lookup: subscription_v2_id → provider_subscription record
      const linkedPsMap = new Map<string, any>();
      const orphanPs: any[] = [];
      for (const ps of (providerSubs || [])) {
        if (ps.subscription_v2_id) {
          linkedPsMap.set(ps.subscription_v2_id, ps);
        } else {
          orphanPs.push(ps);
        }
      }

      // Fetch profiles separately (include orphan PS user_ids)
      const orphanUserIds = orphanPs.map(ps => ps.user_id).filter(Boolean);
      const allUserIds = [...new Set([...(data || []).map(s => s.user_id), ...orphanUserIds])];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, user_id, full_name, email')
        .in('user_id', allUserIds);

      const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);
      // PATCH 3.1: Also build profile map by profile_id for orphans
      const profileByIdMap = new Map(profiles?.map(p => [p.id, p]) || []);

      const mappedSubs = (data || []).map((sub): AutoRenewal => {
        const tariff = sub.tariffs as any;
        const product = tariff?.products_v2 as any;
        const pm = sub.payment_methods as any;
        const profile = profileMap.get(sub.user_id);
        const order = sub.orders_v2 as any;
        
        // FIX-2: Normalize tariff_offers to array (Supabase may return object instead of array)
        const rawOffers = tariff?.tariff_offers;
        const tariffOffers = Array.isArray(rawOffers) 
          ? rawOffers 
          : (rawOffers ? [rawOffers] : []);
        
        // Determine if this is a subscription (not one-time)
        // Check tariff_offers for requires_card_tokenization
        const isSubscription = 
          tariffOffers.some((o: any) => o?.requires_card_tokenization === true) ||
          product?.category === 'subscription';

        // PATCH-6: Detect staff by email
        const email = profile?.email?.toLowerCase() || '';
        const isStaff = STAFF_EMAILS.includes(email);
        
        // PATCH-6: Detect comped (last factual price = 0)
        const orderPrice = order?.final_price;
        const isComped = !isStaff && orderPrice !== null && Number(orderPrice) === 0;
        
        // PATCH-6: Determine pricing source
        const metaObj = sub.meta as Record<string, unknown> | null;
        let pricingSource: 'meta' | 'order' | 'tariff_fallback' = 'tariff_fallback';
        if (metaObj?.recurring_amount && Number(metaObj.recurring_amount) > 0) {
          pricingSource = 'meta';
        } else if (order?.final_price && Number(order.final_price) > 0) {
          pricingSource = 'order';
        }

        return {
          id: sub.id,
          user_id: sub.user_id,
          order_id: sub.order_id,
          next_charge_at: sub.next_charge_at,
          access_end_at: sub.access_end_at,
          status: sub.status,
          charge_attempts: sub.charge_attempts || 0,
          payment_method_id: sub.payment_method_id,
          has_payment_token: (sub as any).has_payment_token ?? false,
          meta: sub.meta,
          product_name: product?.name || null,
          tariff_name: tariff?.name || null,
          contact_name: profile?.full_name || null,
          contact_email: profile?.email || null,
          profile_id: profile?.id || null,
          pm_status: pm?.status || null,
          pm_last4: pm?.last4 || null,
          pm_brand: pm?.brand || null,
          order_final_price: order?.final_price || null,
          order_currency: order?.currency || null,
          // PATCH-2: subscription filter
          is_subscription: isSubscription,
          // PATCH-3: Trial detection
          is_trial: sub.is_trial || sub.status === 'trial',
          tariff_original_price: tariff?.original_price || null,
          tariff_trial_price: tariff?.trial_price || null,
          // PATCH-6: Staff/comped detection
          is_staff: isStaff,
          is_comped: isComped,
          pricing_source: pricingSource,
          // PATCH: Grace period fields
          grace_period_status: (sub as any).grace_period_status || null,
          grace_period_started_at: (sub as any).grace_period_started_at || null,
          grace_period_ends_at: (sub as any).grace_period_ends_at || null,
          // PATCH-7: Billing type
          billing_type: (sub as any).billing_type || 'mit',
          // PATCH 3.1: BePaid flag — ONLY from provider_subscriptions active records (source of truth)
          is_bepaid: linkedPsMap.has(sub.id),
        };
      });

      // PATCH-2: Filter out non-subscription (one-time) products
      const filteredSubs = mappedSubs.filter(sub => sub.is_subscription);

      // PATCH P0.9.6: Dedup by user_id+product_name — keep only the "best" (latest access_end_at, NULL=∞)
      const dedupedSubs = filteredSubs.reduce((acc: AutoRenewal[], sub) => {
        const key = `${sub.user_id}::${sub.product_name || sub.tariff_name || 'unknown'}`;
        const existing = acc.find(s => `${s.user_id}::${s.product_name || s.tariff_name || 'unknown'}` === key);
        if (!existing) {
          acc.push(sub);
        } else {
          // Compare: NULL access_end_at = infinity (best)
          const existingEnd = existing.access_end_at ? new Date(existing.access_end_at).getTime() : Infinity;
          const newEnd = sub.access_end_at ? new Date(sub.access_end_at).getTime() : Infinity;
          if (newEnd > existingEnd) {
            const idx = acc.indexOf(existing);
            acc[idx] = sub;
          }
        }
        return acc;
      }, []);

      // PATCH 3.1: Append orphan provider_subscriptions (active, not linked to subscriptions_v2)
      for (const ps of orphanPs) {
        const profile = ps.user_id ? profileMap.get(ps.user_id) : (ps.profile_id ? profileByIdMap.get(ps.profile_id) : null);
        const planTitle = ps.raw_data?.plan?.title || ps.raw_data?.plan?.name || null;
        const amountByn = (ps.amount_cents || 0) / 100;
        
        dedupedSubs.push({
          id: ps.id, // use provider_subscriptions UUID
          user_id: ps.user_id || '',
          order_id: null,
          next_charge_at: ps.next_charge_at || null,
          access_end_at: ps.next_charge_at || '',
          status: 'active',
          charge_attempts: 0,
          payment_method_id: null,
          has_payment_token: false,
          meta: { provider_subscription_id: ps.provider_subscription_id },
          product_name: planTitle,
          tariff_name: planTitle,
          contact_name: profile?.full_name || null,
          contact_email: profile?.email || null,
          profile_id: profile?.id || ps.profile_id || null,
          pm_status: null,
          pm_last4: ps.card_last4 || null,
          pm_brand: ps.card_brand || null,
          order_final_price: amountByn,
          order_currency: ps.currency || 'BYN',
          is_subscription: true,
          is_trial: false,
          tariff_original_price: amountByn,
          tariff_trial_price: null,
          is_staff: false,
          is_comped: false,
          pricing_source: 'order',
          grace_period_status: null,
          grace_period_started_at: null,
          grace_period_ends_at: null,
          billing_type: 'provider_managed',
          is_bepaid: true,
        });
      }

      return dedupedSubs;
    },
    refetchInterval: 60000,
  });

  // Extract subscription IDs for batch notification query
  const subscriptionIds = useMemo(() => 
    (renewals || []).map(r => r.id), 
    [renewals]
  );

  // Batch query for Telegram notification logs (last 30 days)
  const { data: tgLogs } = useQuery({
    queryKey: ['auto-renewals-tg-logs', subscriptionIds],
    queryFn: async () => {
      if (subscriptionIds.length === 0) return [];
      
      const thirtyDaysAgo = subDays(new Date(), 30).toISOString();
      
      // Query telegram_logs with relevant event_types only
      const { data, error } = await supabase
        .from('telegram_logs')
        .select('user_id, meta, event_type, status, error_message, created_at')
        .in('action', ['SEND_REMINDER', 'SEND_NO_CARD_WARNING'])
        .in('event_type', RELEVANT_TG_EVENT_TYPES)
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('Failed to fetch TG logs:', error);
        return [];
      }

      // Transform to include subscription_id from meta and normalize
      return (data || []).map(log => ({
        subscription_id: (log.meta as any)?.subscription_id || '',
        event_type: log.event_type || '',
        status: log.status || '',
        reason: (log.meta as any)?.reason || null,
        error_message: log.error_message || null,
        created_at: log.created_at,
      })).filter(l => subscriptionIds.includes(l.subscription_id));
    },
    enabled: subscriptionIds.length > 0,
    staleTime: 30000,
  });

  // Batch query for Email notification logs (last 30 days)
  const { data: emailLogs } = useQuery({
    queryKey: ['auto-renewals-email-logs', subscriptionIds],
    queryFn: async () => {
      if (subscriptionIds.length === 0) return [];
      
      const thirtyDaysAgo = subDays(new Date(), 30).toISOString();
      
      // Query email_logs for outgoing emails with subscription context
      const { data, error } = await supabase
        .from('email_logs')
        .select('user_id, meta, status, error_message, created_at')
        .eq('direction', 'outgoing')
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('Failed to fetch email logs:', error);
        return [];
      }

      // Transform and filter by subscription_ids
      return (data || []).map(log => ({
        subscription_id: (log.meta as any)?.subscription_id || '',
        event_type: (log.meta as any)?.event_type || '',
        status: log.status || '',
        reason: (log.meta as any)?.reason || null,
        error_message: log.error_message || null,
        created_at: log.created_at,
      })).filter(l => 
        subscriptionIds.includes(l.subscription_id) && 
        l.event_type?.startsWith('subscription_reminder_')
      );
    },
    enabled: subscriptionIds.length > 0,
    staleTime: 30000,
  });

  const filteredRenewals = useMemo(() => {
    if (!renewals) return [];
    
    let result = renewals;
    
    // Apply filter - using Minsk timezone
    const nowMinsk = toZonedTime(new Date(), MINSK_TZ);
    const weekFromNow = addDays(nowMinsk, 7);
    
    switch (filter) {
      case 'due_today':
        result = result.filter(r => r.next_charge_at && isTodayMinsk(new Date(r.next_charge_at)));
        break;
      case 'due_week':
        result = result.filter(r => {
          if (!r.next_charge_at) return false;
          const dateMinsk = toZonedTime(new Date(r.next_charge_at), MINSK_TZ);
          return isBefore(dateMinsk, weekFromNow);
        });
        break;
      case 'overdue':
        result = result.filter(r => r.next_charge_at && isPastMinsk(new Date(r.next_charge_at)));
        break;
      // PATCH-6: New filter for NULL next_charge_at
      case 'no_charge_date':
        result = result.filter(r => !r.next_charge_at);
        break;
      case 'no_card':
        // AR-P0.9.6: exclude provider_managed (card not needed)
        result = result.filter(r => !r.payment_method_id && r.billing_type !== 'provider_managed');
        break;
      case 'no_token':
        // AR-P0.9.6: exclude provider_managed (token managed by provider)
        result = result.filter(r => !r.has_payment_token && r.billing_type !== 'provider_managed');
        break;
      case 'pm_inactive':
        result = result.filter(r => r.pm_status && r.pm_status !== 'active');
        break;
      case 'max_attempts':
        result = result.filter(r => r.charge_attempts >= 3);
        break;
      case 'in_grace':
        result = result.filter(r => r.grace_period_status === 'in_grace');
        break;
      case 'expired_reentry':
        result = result.filter(r => r.grace_period_status === 'expired_reentry');
        break;
      case 'bepaid':
        // PATCH 3.1: filter by is_bepaid (source of truth from provider_subscriptions)
        result = result.filter(r => r.is_bepaid);
        break;
    }
    
    // Apply search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(r => 
        r.contact_name?.toLowerCase().includes(query) ||
        r.contact_email?.toLowerCase().includes(query) ||
        r.product_name?.toLowerCase().includes(query)
      );
    }
    
    return result;
  }, [renewals, filter, searchQuery]);

  // Sorting logic using useTableSort hook
  const getFieldValue = useCallback((r: AutoRenewal, key: string) => {
    switch (key) {
      case 'contact':
        return (r.contact_name || r.contact_email || '').toLowerCase();
      case 'product':
        return (r.product_name || r.tariff_name || '').toLowerCase();
      case 'amount':
        return getChargeAmount(r).amount || 0;
      case 'next_charge':
        return r.next_charge_at ? new Date(r.next_charge_at).getTime() : null;
      case 'access_end':
        return r.access_end_at ? new Date(r.access_end_at).getTime() : null;
      case 'attempts':
        return r.charge_attempts ?? 0;
      case 'pm':
        return `${r.pm_status || 'zzz'}-${r.pm_last4 || ''}`;
      case 'last_attempt':
        return r.meta?.last_charge_attempt_at ? new Date(r.meta.last_charge_attempt_at).getTime() : null;
      default:
        return null;
    }
  }, []);

  const { sortedData, sortKey, sortDirection, handleSort } = useTableSort({
    data: filteredRenewals,
    getFieldValue,
  });

  // Stats with amounts - PATCH-6: Exclude staff and NULL next_charge_at from due/overdue metrics
  const stats = useMemo(() => {
    if (!renewals) return null;
    
    // PATCH-6: For due/overdue metrics, exclude staff and NULL next_charge_at
    const eligibleForMetrics = renewals.filter(r => r.next_charge_at && !r.is_staff);
    
    const dueTodayList = eligibleForMetrics.filter(r => isTodayMinsk(new Date(r.next_charge_at!)));
    const overdueList = eligibleForMetrics.filter(r => isPastMinsk(new Date(r.next_charge_at!)));
    // AR-P0.9.6: exclude BePaid from "no card" stat (PATCH 3.1: use is_bepaid)
    const noCardList = renewals.filter(r => !r.payment_method_id && !r.is_bepaid);
    
    // PATCH-6: Count subscriptions with NULL next_charge_at
    const noChargeDateList = renewals.filter(r => !r.next_charge_at);
    
    const sumAmount = (list: AutoRenewal[]) => 
      list.reduce((sum, r) => sum + getChargeAmount(r).amount, 0);
    
    // PATCH 3.1: MIT/BePaid split using is_bepaid (source of truth)
    const bepaidTotal = renewals.filter(r => r.is_bepaid).length;
    const mitTotal = renewals.length - bepaidTotal;
    const mitDueToday = dueTodayList.filter(r => !r.is_bepaid).length;
    const bepaidDueToday = dueTodayList.filter(r => r.is_bepaid).length;

    return {
      total: { count: renewals.length, sum: sumAmount(renewals) },
      dueToday: { count: dueTodayList.length, sum: sumAmount(dueTodayList) },
      overdue: { count: overdueList.length, sum: sumAmount(overdueList) },
      noCard: { count: noCardList.length, sum: sumAmount(noCardList) },
      noChargeDate: { count: noChargeDateList.length, sum: 0 },
      // AR-P0.9.7: split counts
      bepaidTotal,
      mitTotal,
      mitDueToday,
      bepaidDueToday,
    };
  }, [renewals]);

  // Clickable stat card handler
  const handleStatClick = (value: FilterType) => {
    setFilter(value);
    setSelectedIds(new Set());
    // Scroll to table
    requestAnimationFrame(() => {
      document.querySelector('[data-auto-renewals-table]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const getChargeStatus = (renewal: AutoRenewal) => {
    if (!renewal.next_charge_at) return { label: 'Нет даты', variant: 'secondary' as const };
    
    const date = new Date(renewal.next_charge_at);
    if (isTodayMinsk(date)) return { label: 'Сегодня', variant: 'default' as const, className: 'bg-blue-500' };
    if (isPastMinsk(date)) return { label: 'Просрочено', variant: 'destructive' as const };
    return { label: format(date, 'dd.MM.yy', { locale: ru }), variant: 'outline' as const };
  };

  const openContactSheet = async (profileId: string) => {
    try {
      const { data: contact, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", profileId)
        .single();
      
      if (error) throw error;
      
      setSelectedContact(contact);
      setContactSheetOpen(true);
    } catch (e) {
      console.error("Failed to load contact:", e);
      toast.error("Не удалось загрузить контакт");
    }
  };

  const getLastAttempt = (meta: any) => {
    if (!meta?.last_charge_attempt_at) return null;
    return {
      at: meta.last_charge_attempt_at,
      success: meta.last_charge_attempt_success,
      error: meta.last_charge_attempt_error,
    };
  };
  
  // Selection handlers
  const toggleSelectAll = () => {
    if (selectedIds.size === sortedData.length && sortedData.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedData.map(r => r.id)));
    }
  };

  const toggleItem = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  
  // PATCH-4: Batch disable auto-renew handler
  const { hasPermission } = usePermissions();
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchPreview, setBatchPreview] = useState<any[]>([]);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  // FIX-4: Store remaining count from server response (not local calculation)
  const [batchRemaining, setBatchRemaining] = useState<number>(0);
  
  // PATCH-5: Fix club billing dates modal state
  const [fixBillingDialogOpen, setFixBillingDialogOpen] = useState(false);
  const [fixDryRunResult, setFixDryRunResult] = useState<any>(null);
  const [fixLoading, setFixLoading] = useState(false);
  const [fixExecuteLoading, setFixExecuteLoading] = useState(false);

  const handleBatchDisable = async (dryRun: boolean) => {
    if (selectedIds.size === 0) return;
    
    setBatchLoading(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const response = await supabase.functions.invoke('admin-batch-disable-auto-renew', {
        body: { 
          subscription_ids: Array.from(selectedIds), 
          dry_run: dryRun,
          reason: 'admin_manual_disable'
        }
      });
      
      if (response.error) throw new Error(response.error.message);
      
      if (dryRun) {
        setBatchPreview(response.data.subscriptions || []);
        // FIX-4: Use remaining from server response instead of local calc
        setBatchRemaining(response.data.remaining ?? 0);
        setBatchDialogOpen(true);
      } else {
        toast.success(response.data.message || `Отключено: ${response.data.count}`);
        setSelectedIds(new Set());
        setBatchDialogOpen(false);
        refetch();
      }
    } catch (err: any) {
      toast.error(err.message || 'Ошибка batch операции');
    } finally {
      setBatchLoading(false);
    }
  };

  // PATCH-5: Fix club billing dates handlers
  const handleFixDryRun = async () => {
    setFixLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Не авторизован');
      
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-fix-club-billing-dates`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ dry_run: true, limit: 200 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Dry run failed');
      setFixDryRunResult(data);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setFixLoading(false);
    }
  };

  const handleFixExecute = async () => {
    if (!fixDryRunResult?.preview_hash) {
      toast.error('Сначала выполните dry-run');
      return;
    }
    setFixExecuteLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Не авторизован');
      
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-fix-club-billing-dates`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ 
          dry_run: false, 
          limit: 200, 
          preview_hash: fixDryRunResult.preview_hash 
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Execute failed');
      toast.success(`Исправлено ${data.results?.updated || 0} подписок`);
      setFixBillingDialogOpen(false);
      setFixDryRunResult(null);
      refetch();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setFixExecuteLoading(false);
    }
  };
  
  // Render cell content based on column key
  const renderCell = (columnKey: string, renewal: AutoRenewal) => {
    const chargeStatus = getChargeStatus(renewal);
    const lastAttempt = getLastAttempt(renewal.meta);
    const charge = getChargeAmount(renewal);
    
    switch (columnKey) {
      case 'checkbox':
        return (
          <Checkbox 
            checked={selectedIds.has(renewal.id)}
            onCheckedChange={() => toggleItem(renewal.id)}
            onClick={(e) => e.stopPropagation()}
          />
        );
      case 'contact':
        return (
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-sm truncate max-w-[130px]">
                {renewal.contact_name || 'Без имени'}
              </span>
              {/* PATCH-6: Staff badge */}
              {renewal.is_staff && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-purple-100 text-purple-700">
                  Staff
                </Badge>
              )}
              {/* PATCH-6: Comped badge (if not staff) */}
              {!renewal.is_staff && renewal.is_comped && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-green-100 text-green-700">
                  Comped
                </Badge>
              )}
            </div>
            <span className="text-xs text-muted-foreground truncate max-w-[150px]">
              {renewal.contact_email}
            </span>
          </div>
        );
      case 'product':
        return (
          <div className="flex flex-col">
            <span className="text-sm truncate max-w-[120px]">
              {renewal.product_name || '—'}
            </span>
            {renewal.tariff_name && (
              <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                {renewal.tariff_name}
              </span>
            )}
          </div>
        );
      case 'billing_type':
        return (
          <Badge 
            variant={renewal.billing_type === 'provider_managed' ? 'secondary' : 'outline'}
            className={cn(
              'text-[10px] px-1.5',
              renewal.billing_type === 'provider_managed' 
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' 
                : ''
            )}
          >
            {renewal.billing_type === 'provider_managed' ? '🔄 bePaid' : '💳 MIT'}
          </Badge>
        );
      case 'amount':
        return (
          <span className="text-sm font-mono">
            {formatAmount(charge.amount, charge.currency)}
          </span>
        );
      case 'next_charge':
        return (
          <Badge 
            variant={chargeStatus.variant} 
            className={cn('text-xs', chargeStatus.className)}
          >
            {chargeStatus.label}
          </Badge>
        );
      case 'access_end':
        return (
          <span className="text-xs text-muted-foreground">
            {format(new Date(renewal.access_end_at), 'dd.MM.yy', { locale: ru })}
          </span>
        );
      case 'attempts':
        return (
          <Badge 
            variant={renewal.charge_attempts >= 3 ? 'destructive' : 'secondary'}
            className="text-xs"
          >
            {renewal.charge_attempts}/3
          </Badge>
        );
      case 'card':
        // AR-P0.9.6: provider_managed doesn't need a local card
        if (renewal.billing_type === 'provider_managed') {
          return (
            <Badge variant="outline" className="text-[10px] mx-auto border-blue-400 text-blue-600">
              bePaid
            </Badge>
          );
        }
        return renewal.payment_method_id ? (
          <CheckCircle className="h-4 w-4 text-green-600 mx-auto" />
        ) : (
          <XCircle className="h-4 w-4 text-muted-foreground mx-auto" />
        );
      case 'pm':
        // AR-P0.9.6: provider_managed shows "bePaid" instead of dash
        if (renewal.billing_type === 'provider_managed') {
          return (
            <Badge variant="outline" className="text-[10px] border-blue-400 text-blue-600">
              bePaid
            </Badge>
          );
        }
        return renewal.pm_status ? (
          <Badge 
            variant={renewal.pm_status === 'active' ? 'default' : 'secondary'}
            className={cn(
              'text-[10px]',
              renewal.pm_status === 'active' && 'bg-green-600'
            )}
          >
            {renewal.pm_last4 && `•${renewal.pm_last4} `}
            {renewal.pm_status}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        );
      case 'last_attempt':
        return lastAttempt ? (
          <div className="flex items-center gap-1">
            {lastAttempt.success ? (
              <CheckCircle className="h-3 w-3 text-green-600" />
            ) : (
              <AlertTriangle className="h-3 w-3 text-red-600" />
            )}
            <span className={cn(
              'text-[10px] truncate max-w-[80px]',
              lastAttempt.success ? 'text-green-600' : 'text-red-600'
            )}>
              {lastAttempt.success ? 'OK' : lastAttempt.error?.slice(0, 20)}
            </span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        );
      case 'tg_status':
        // PATCH-6: Don't show indicators for NULL next_charge_at
        if (!renewal.next_charge_at) {
          return <span className="text-muted-foreground text-xs">—</span>;
        }
        return (
          <NotificationStatusIndicators
            subscriptionId={renewal.id}
            channel="telegram"
            logs={tgLogs || []}
            onOpenContact={() => renewal.profile_id && openContactSheet(renewal.profile_id)}
          />
        );
      case 'email_status':
        // PATCH-6: Don't show indicators for NULL next_charge_at
        if (!renewal.next_charge_at) {
          return <span className="text-muted-foreground text-xs">—</span>;
        }
        return (
          <NotificationStatusIndicators
            subscriptionId={renewal.id}
            channel="email"
            logs={emailLogs || []}
            onOpenContact={() => renewal.profile_id && openContactSheet(renewal.profile_id)}
          />
        );
      default:
        return null;
    }
  };

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Stats with amounts - PATCH-5: Fixed borders and removed "на сумму" */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card 
              className={cn(
                "p-3 cursor-pointer border-2 border-transparent transition-all hover:border-primary/50",
                filter === 'all' && "border-primary bg-primary/5"
              )}
              onClick={() => handleStatClick('all')}
              role="button"
              aria-pressed={filter === 'all'}
            >
              <div className="text-2xl font-bold">{stats.total.count}</div>
              <div className="text-xs text-muted-foreground">Всего подписок</div>
              <div className="text-sm font-medium mt-1">
                {stats.total.sum.toFixed(2)} BYN
              </div>
              {stats.bepaidTotal > 0 && (
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  MIT: {stats.mitTotal} · BePaid: {stats.bepaidTotal}
                </div>
              )}
            </Card>
            <Card 
              className={cn(
                "p-3 cursor-pointer border-2 border-transparent transition-all hover:border-blue-500/50",
                filter === 'due_today' && "border-blue-500 bg-blue-500/5"
              )}
              onClick={() => handleStatClick('due_today')}
              role="button"
              aria-pressed={filter === 'due_today'}
            >
              <div className="text-2xl font-bold text-blue-600">{stats.dueToday.count}</div>
              <div className="text-xs text-muted-foreground">К списанию сегодня</div>
              <div className="text-sm font-medium text-blue-600 mt-1">
                {stats.dueToday.sum.toFixed(2)} BYN
              </div>
              {(stats.mitDueToday > 0 || stats.bepaidDueToday > 0) && (
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  MIT: {stats.mitDueToday} · BePaid: {stats.bepaidDueToday}
                </div>
              )}
            </Card>
            <Card 
              className={cn(
                "p-3 cursor-pointer border-2 border-transparent transition-all hover:border-red-500/50",
                filter === 'overdue' && "border-red-500 bg-red-500/5"
              )}
              onClick={() => handleStatClick('overdue')}
              role="button"
              aria-pressed={filter === 'overdue'}
            >
              <div className="text-2xl font-bold text-red-600">{stats.overdue.count}</div>
              <div className="text-xs text-muted-foreground">Просрочено</div>
              <div className="text-sm font-medium text-red-600 mt-1">
                {stats.overdue.sum.toFixed(2)} BYN
              </div>
            </Card>
            <Card 
              className={cn(
                "p-3 cursor-pointer border-2 border-transparent transition-all hover:border-amber-500/50",
                filter === 'no_card' && "border-amber-500 bg-amber-500/5"
              )}
              onClick={() => handleStatClick('no_card')}
              role="button"
              aria-pressed={filter === 'no_card'}
            >
              <div className="text-2xl font-bold text-amber-600">{stats.noCard.count}</div>
              <div className="text-xs text-muted-foreground">Без карты</div>
              <div className="text-sm font-medium text-amber-600 mt-1">
                {stats.noCard.sum.toFixed(2)} BYN
              </div>
            </Card>
          </div>
        )}

        {/* PATCH-4: Batch actions panel */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg border">
            <span className="text-sm font-medium">
              Выбрано: {selectedIds.size} из {sortedData.length}
            </span>
            
            <Dialog open={batchDialogOpen} onOpenChange={setBatchDialogOpen}>
              <DialogTrigger asChild>
                <Button 
                  variant="outline" 
                  size="sm"
                  disabled={batchLoading || !hasPermission('subscriptions.edit')}
                  onClick={() => handleBatchDisable(true)}
                >
                  <Power className="h-4 w-4 mr-1" />
                  Отключить автопродление
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Отключить автопродление</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 py-4">
                  <p className="text-sm text-muted-foreground">
                    Будет отключено автопродление для {selectedIds.size} подписок:
                  </p>
                  <ul className="text-sm max-h-40 overflow-auto space-y-1">
                    {batchPreview.map((sub: any) => (
                      <li key={sub.id} className="flex justify-between">
                        <span className="truncate">{sub.contact}</span>
                        <span className="text-muted-foreground truncate ml-2">{sub.product}</span>
                      </li>
                    ))}
                    {/* FIX-4: Use batchRemaining from server response */}
                    {batchRemaining > 0 && (
                      <li className="text-muted-foreground">...и ещё {batchRemaining}</li>
                    )}
                  </ul>
                </div>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">Отмена</Button>
                  </DialogClose>
                  <Button 
                    variant="destructive" 
                    onClick={() => handleBatchDisable(false)}
                    disabled={batchLoading}
                  >
                    {batchLoading ? 'Обработка...' : 'Подтвердить'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}

        {/* Filters + Column Settings */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск по имени, email, продукту..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          
          <Select value={filter} onValueChange={(v) => setFilter(v as FilterType)}>
            <SelectTrigger className="w-[180px] h-9">
              <Filter className="h-3.5 w-3.5 mr-2" />
              <SelectValue placeholder="Фильтр" />
            </SelectTrigger>
            <SelectContent>
              {FILTER_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button variant="outline" size="sm" onClick={() => refetch()} className="h-9">
            <RefreshCw className="h-4 w-4 mr-1" />
            Обновить
          </Button>

          {/* PATCH-5: Tools dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-background">
              <DropdownMenuLabel className="text-xs">Инструменты</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                onClick={() => setFixBillingDialogOpen(true)}
                disabled={!hasPermission('subscriptions.edit')}
              >
                <Wrench className="h-4 w-4 mr-2" />
                Fix club billing dates
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => setBackfillDialogOpen(true)}
                disabled={!hasPermission('subscriptions.edit')}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Backfill recurring_snapshot
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => setBackfill2026DialogOpen(true)}
                disabled={!hasPermission('subscriptions.edit')}
              >
                <FileText className="h-4 w-4 mr-2" />
                Backfill Orders 2026+
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => setFixIntegrityDialogOpen(true)}
                disabled={!hasPermission('subscriptions.edit')}
              >
                <Wrench className="h-4 w-4 mr-2" />
                Fix Integrity (2026+)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          
          <ColumnSettings 
            columns={columns} 
            onChange={setColumns}
            onReset={() => {
              setColumns(DEFAULT_COLUMNS);
              localStorage.removeItem(STORAGE_KEY);
            }}
          />
        </div>

        {/* Legend for notification indicators */}
        <NotificationLegend />

        {/* Table with DnD */}
        <Card data-auto-renewals-table>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3, 4, 5].map(i => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : sortedData.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                Нет подписок с автопродлением
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={sortedColumns.map(c => c.key)} strategy={horizontalListSortingStrategy}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {sortedColumns.map(col => (
                          <SortableResizableHeader 
                            key={col.key} 
                            column={col} 
                            onResize={handleResize}
                            onSort={handleSort}
                            sortKey={sortKey}
                            sortDirection={sortDirection}
                          >
                            {col.key === 'checkbox' ? (
                              <Checkbox 
                                checked={selectedIds.size === sortedData.length && sortedData.length > 0}
                                onCheckedChange={toggleSelectAll}
                              />
                            ) : col.key === 'tg_status' ? (
                              <div className="flex flex-col items-center">
                                <Send className="h-3.5 w-3.5 mb-0.5" />
                                <span className="text-[9px]">TG 7/3/1</span>
                              </div>
                            ) : col.key === 'email_status' ? (
                              <div className="flex flex-col items-center">
                                <Mail className="h-3.5 w-3.5 mb-0.5" />
                                <span className="text-[9px]">Email 7/3/1</span>
                              </div>
                            ) : col.label}
                          </SortableResizableHeader>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedData.slice(0, 100).map((renewal) => (
                        <TableRow 
                          key={renewal.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => renewal.profile_id && openContactSheet(renewal.profile_id)}
                          data-state={selectedIds.has(renewal.id) ? 'selected' : undefined}
                        >
                          {sortedColumns.map(col => (
                            <TableCell 
                              key={col.key} 
                              style={{ width: col.width }}
                              className={cn(
                                col.key === 'checkbox' && 'text-center',
                                col.key === 'card' && 'text-center',
                                col.key === 'attempts' && 'text-center',
                              )}
                            >
                              {renderCell(col.key, renewal)}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </SortableContext>
              </DndContext>
            )}
          </CardContent>
        </Card>

        {/* Contact Detail Sheet */}
        <ContactDetailSheet
          contact={selectedContact}
          open={contactSheetOpen}
          onOpenChange={(open) => {
            setContactSheetOpen(open);
            if (!open) {
              refetch();
            }
          }}
        />

        {/* PATCH-5: Fix Club Billing Dates Modal */}
        <Dialog open={fixBillingDialogOpen} onOpenChange={(open) => {
          setFixBillingDialogOpen(open);
          if (!open) setFixDryRunResult(null);
        }}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
            <DialogHeader>
              <DialogTitle>Fix Club Billing Dates</DialogTitle>
            </DialogHeader>
            
            {!fixDryRunResult ? (
              // Step 1: Dry Run
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Найти и исправить проблемные подписки клуба:
                </p>
                <ul className="text-xs text-muted-foreground list-disc list-inside space-y-1">
                  <li>NULL next_charge_at (при auto_renew=true)</li>
                  <li>Год 2027+ в датах (баг +365 дней)</li>
                  <li>Период больше 40 дней (должен быть ~30)</li>
                  <li>Рассинхрон next_charge_at и access_end_at</li>
                </ul>
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  ⚠️ Сотрудники исключены: a.bruylo@ajoure.by, nrokhmistrov@gmail.com, ceo@ajoure.by, irenessa@yandex.ru
                </p>
                <div className="flex gap-2 pt-2">
                  <Button onClick={handleFixDryRun} disabled={fixLoading}>
                    {fixLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Анализ...
                      </>
                    ) : (
                      'Запустить анализ (dry-run)'
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              // Step 2: Preview + Execute
              <div className="space-y-4">
                <div className="grid grid-cols-5 gap-2 text-sm">
                  <div className="p-2 bg-muted rounded text-center">
                    <div className="font-bold text-lg">{fixDryRunResult.stats.total}</div>
                    <div className="text-[10px] text-muted-foreground">Всего</div>
                  </div>
                  <div className="p-2 bg-muted rounded text-center">
                    <div className="font-bold text-lg">{fixDryRunResult.stats.null_next_charge}</div>
                    <div className="text-[10px] text-muted-foreground">NULL charge</div>
                  </div>
                  <div className="p-2 bg-muted rounded text-center">
                    <div className="font-bold text-lg">{fixDryRunResult.stats.year_2027}</div>
                    <div className="text-[10px] text-muted-foreground">2027+</div>
                  </div>
                  <div className="p-2 bg-muted rounded text-center">
                    <div className="font-bold text-lg">{fixDryRunResult.stats.period_too_long}</div>
                    <div className="text-[10px] text-muted-foreground">Period&gt;40d</div>
                  </div>
                  <div className="p-2 bg-muted rounded text-center">
                    <div className="font-bold text-lg">{fixDryRunResult.stats.misaligned}</div>
                    <div className="text-[10px] text-muted-foreground">Misaligned</div>
                  </div>
                </div>
                
                {fixDryRunResult.subscriptions?.length > 0 && (
                  <div className="max-h-60 overflow-auto border rounded">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 sticky top-0">
                        <tr>
                          <th className="text-left p-2">Email</th>
                          <th className="text-left p-2">Проблема</th>
                          <th className="text-left p-2">Было</th>
                          <th className="text-left p-2">Станет</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fixDryRunResult.subscriptions.map((sub: any) => (
                          <tr key={sub.id} className="border-t">
                            <td className="p-2 truncate max-w-[120px]" title={sub.email}>{sub.email}</td>
                            <td className="p-2">
                              <div className="flex flex-wrap gap-1">
                                {sub.problem_type.map((p: string) => (
                                  <Badge key={p} variant="outline" className="text-[9px]">{p}</Badge>
                                ))}
                              </div>
                            </td>
                            <td className="p-2 font-mono text-muted-foreground">
                              {sub.current.next_charge_at?.slice(0, 10) || 'NULL'}
                            </td>
                            <td className="p-2 font-mono text-green-600 dark:text-green-400">
                              {sub.fix_preview.next_charge_at?.slice(0, 10)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                
                <DialogFooter className="gap-2 sm:gap-0">
                  <Button variant="outline" onClick={() => setFixDryRunResult(null)}>
                    Сбросить
                  </Button>
                  <Button 
                    variant="destructive" 
                    onClick={handleFixExecute}
                    disabled={fixExecuteLoading || fixDryRunResult.stats.total === 0}
                  >
                    {fixExecuteLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Выполнение...
                      </>
                    ) : (
                      `Применить (${fixDryRunResult.stats.total} записей)`
                    )}
                  </Button>
                </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>
        
        {/* Backfill recurring_snapshot Tool */}
        <BackfillSnapshotTool 
          open={backfillDialogOpen} 
          onOpenChange={setBackfillDialogOpen} 
        />
        
        {/* Backfill 2026 Orders Tool */}
        <Backfill2026OrdersTool
          open={backfill2026DialogOpen}
          onOpenChange={setBackfill2026DialogOpen}
        />
        
        {/* Fix Payments Integrity Tool */}
        <Dialog open={fixIntegrityDialogOpen} onOpenChange={setFixIntegrityDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Fix Payments Integrity (2026+)</DialogTitle>
            </DialogHeader>
            <FixPaymentsIntegrityTool />
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
