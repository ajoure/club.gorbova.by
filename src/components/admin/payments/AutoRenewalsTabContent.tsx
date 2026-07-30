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
import { RefreshCw, Search, CreditCard, AlertTriangle, CheckCircle, XCircle, Clock, Filter, Send, Mail, GripVertical, ArrowUp, ArrowDown, ArrowUpDown, Power, MoreHorizontal, Wrench, Loader2, FileText, HelpCircle, ShieldAlert } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { format, isToday, isPast, isBefore, addDays, startOfDay, endOfDay } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useTableSort } from "@/hooks/useTableSort";
import { SortDirection } from "@/components/ui/sortable-table-head";
import { toast } from "sonner";
import { ContactDetailSheet } from "@/components/admin/ContactDetailSheet";
import { NotificationStatusIndicators, NotificationLegend, type NotificationLog } from "./NotificationStatusIndicators";
import { TooltipProvider } from "@/components/ui/tooltip";
import { resolveRetryObservability, retryAttemptLabel, retryAttemptSummaryLabel, type RetryObservability } from "@/lib/autoRenewalObservability";
import {
  hasRealInstallmentEvidence,
  isFiniteInstallment,
  resolveInstallmentProgress,
  summarizeInstallmentPayments,
  type InstallmentPaymentEvidence,
  type InstallmentProgress,
} from "@/lib/autoRenewalInstallments";
import { ColumnSettings, ColumnConfig } from "@/components/admin/ColumnSettings";
import { usePermissions } from "@/hooks/usePermissions";
import { BackfillSnapshotTool } from "./BackfillSnapshotTool";
import { Backfill2026OrdersTool } from "./Backfill2026OrdersTool";
import { FixPaymentsIntegrityTool } from "./FixPaymentsIntegrityTool";
import { Inv22ResolverPanel } from "./Inv22ResolverPanel";
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
const QUERY_PAGE_SIZE = 500;
const TABLE_PAGE_SIZE = 100;

// PATCH-6: Staff emails - excluded from metrics, reminders, and access changes
const STAFF_EMAILS = [
  'a.bruylo@ajoure.by',
  'nrokhmistrov@gmail.com',
  'ceo@ajoure.by',
  'irenessa@yandex.ru',
];

type FilterType = 'all' | 'recurring' | 'installments' | 'installment_drafts' | 'installment_debt' | 'due_today' | 'due_week' | 'overdue' | 'no_card' | 'no_token' | 'pm_inactive' | 'max_attempts' | 'no_charge_date' | 'in_grace' | 'expired_reentry' | 'bepaid' | 'stripe' | 'errors' | 'bad_card' | 'broken_token' | 'requires_3ds' | 'link_only';

const FILTER_OPTIONS: { value: FilterType; label: string; icon?: any }[] = [
  { value: 'all', label: 'Все' },
  { value: 'recurring', label: 'Рекуррентные подписки', icon: RefreshCw },
  { value: 'installments', label: 'Конечные рассрочки', icon: FileText },
  { value: 'installment_drafts', label: 'Неоплаченные заготовки', icon: FileText },
  { value: 'installment_debt', label: 'Долг по рассрочкам', icon: CreditCard },
  { value: 'errors', label: 'Ошибки списаний', icon: AlertTriangle },
  { value: 'bad_card', label: 'Проблемные карты', icon: ShieldAlert },
  { value: 'due_today', label: 'К списанию сегодня', icon: Clock },
  { value: 'due_week', label: 'К списанию за неделю' },
  { value: 'overdue', label: 'Просрочено', icon: AlertTriangle },
  { value: 'in_grace', label: 'В льготном периоде (72 ч)', icon: Clock },
  { value: 'expired_reentry', label: 'Удалённые', icon: XCircle },
  { value: 'no_charge_date', label: 'Нет даты списания', icon: AlertTriangle },
  { value: 'no_card', label: 'Без карты', icon: CreditCard },
  { value: 'no_token', label: 'Без токена' },
  { value: 'pm_inactive', label: 'Способ оплаты неактивен' },
  { value: 'max_attempts', label: 'Макс. попыток' },
  { value: 'bepaid', label: 'BePaid подписки', icon: CreditCard },
  { value: 'stripe', label: 'Stripe подписки', icon: CreditCard },
  { value: 'broken_token', label: '⚠️ Повреждённый токен' },
  { value: 'requires_3ds', label: '🔐 Требуется 3-D Secure' },
  { value: 'link_only', label: '🔗 Только ссылка' },
];

// Stage 2B: Column configuration — bumped widths for readability + provider column
const DEFAULT_COLUMNS: ColumnConfig[] = [
  { key: "checkbox", label: "", visible: true, width: 40, order: 0 },
  { key: "contact", label: "Контакт", visible: true, width: 200, order: 1 },
  { key: "product", label: "Продукт", visible: true, width: 180, order: 2 },
  { key: "kind", label: "Тип", visible: true, width: 115, order: 3 },
  { key: "progress", label: "Взносы", visible: true, width: 90, order: 4 },
  { key: "remaining", label: "Остаток", visible: true, width: 115, order: 5 },
  { key: "provider", label: "Провайдер", visible: true, width: 95, order: 6 },
  { key: "billing_type", label: "Биллинг", visible: true, width: 100, order: 7 },
  { key: "amount", label: "След. сумма", visible: true, width: 110, order: 8 },
  { key: "next_charge", label: "След. списание", visible: true, width: 130, order: 9 },
  { key: "access_end", label: "Доступ до", visible: true, width: 100, order: 10 },
  { key: "grace_remaining", label: "Льготный срок", visible: true, width: 110, order: 11 },
  { key: "attempts", label: "Попытки", visible: true, width: 120, order: 12 },
  { key: "card", label: "Карта", visible: true, width: 70, order: 13 },
  { key: "pm", label: "Способ оплаты", visible: true, width: 125, order: 14 },
  { key: "last_attempt", label: "Последняя попытка", visible: true, width: 140, order: 15 },
  { key: "tg_status", label: "Telegram 7/3/1", visible: true, width: 95, order: 16 },
  { key: "email_status", label: "Почта 7/3/1", visible: true, width: 90, order: 17 },
];

// v4 invalidates the pre-Russian persisted labels (Grace / PM / Last Attempt).
// Column widths/order are user preferences, but labels are product copy and
// must be refreshed when the canonical column configuration changes.
const STORAGE_KEY = 'admin_auto_renewals_columns_v4';

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
  canceled_at: string | null;
  auto_renew: boolean;
  charge_attempts: number;
  retry_observability: RetryObservability;
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
  // PATCH-7: Billing type (stored value)
  billing_type: string;
  // PATCH P2.5: Display billing type (computed from actual token/PM state)
  display_billing_type: 'mit' | 'provider_managed' | 'broken_token' | 'requires_3ds' | 'link_only';
  // PATCH 3.1: BePaid flag from provider_subscriptions (source of truth)
  is_bepaid: boolean;
  // PATCH 3.2: Card verification fields
  pm_verification_status: string | null;
  pm_verification_error: string | null;
  pm_recurring_verified: boolean | null;
  provider_subscription_id: string | null;
  provider_last_charge_at: string | null;
  charged_today: boolean;
  // Stage 2B: provider-aware label ('bepaid' | 'stripe' | 'local')
  provider: 'bepaid' | 'stripe' | 'local';
  kind: 'recurring' | 'installment' | 'installment_draft';
  installment_progress: InstallmentProgress | null;
  installment_evidence: InstallmentPaymentEvidence | null;
  batch_action_eligible: boolean;
}

type RenewalAttemptObservation = {
  total_attempts: number;
  successful_attempts: number;
  failed_attempts: number;
  last_attempt_at: string | null;
  last_attempt_success: boolean | null;
  last_attempt_error: string | null;
  current_attempts?: number;
};

type RenewalObservabilityResponse = {
  logs: Array<NotificationLog & { channel: 'telegram' | 'email' }>;
  attempts: Record<string, RenewalAttemptObservation>;
  source_errors?: string[];
};

// PATCH P2.5: Compute actual billing type from token/PM/provider state
function computeDisplayBillingType(sub: {
  is_bepaid: boolean;
  has_payment_token: boolean;
  payment_method_id: string | null;
  pm_status: string | null;
  billing_type: string;
}): AutoRenewal['display_billing_type'] {
  // Provider-managed: has active sbs_* in provider_subscriptions
  if (sub.is_bepaid) return 'provider_managed';
  // MIT: has valid token + active PM
  if (sub.has_payment_token && sub.payment_method_id && sub.pm_status === 'active') return 'mit';
  // Broken token: claims token but no PM or inactive
  if (sub.has_payment_token && (!sub.payment_method_id || sub.pm_status !== 'active')) return 'broken_token';
  // Requires 3DS: has PM but no token for MIT
  if (sub.payment_method_id && sub.pm_status === 'active') return 'requires_3ds';
  // Link only: no auto-charge capability
  return 'link_only';
}

function canAutoCharge(renewal: AutoRenewal): boolean {
  return renewal.display_billing_type === 'provider_managed'
    || renewal.display_billing_type === 'mit';
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

  if (renewal.kind === 'installment' && renewal.installment_progress) {
    return {
      amount: renewal.installment_progress.perPaymentAmount,
      currency: renewal.order_currency || 'BYN',
      source: 'installment_progress',
    };
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

function isStaleOverdue(date: Date, hours = 72): boolean {
  return Date.now() - date.getTime() > hours * 60 * 60 * 1000;
}

export function AutoRenewalsTabContent() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [tablePage, setTablePage] = useState(1);
  const [draftToCancel, setDraftToCancel] = useState<AutoRenewal | null>(null);
  const [draftCancelLoading, setDraftCancelLoading] = useState(false);
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

  // Сумма видимых колонок — детерминированная min-width таблицы для надёжного
  // горизонтального скролла на mobile/PWA.
  const totalColumnsWidth = useMemo(
    () => sortedColumns.reduce((sum, c) => sum + (c.width || 0), 0),
    [sortedColumns]
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
  // PATCH-2026-04-29 (regression fix):
  //   SOT для "автопродление" — единственный признак: у любого active tariff_offer
  //   продукта поле meta.recurring.is_recurring === true (UI-чекбокс
  //   «Подписка / автопродление» в карточке тарифа).
  //   Всё остальное — разовые продукты, и они НЕ попадают в эту таблицу.
  //   Карта/auto_renew флаг/статус подписки на классификацию продукта НЕ влияют.
  const { data: renewals, isLoading, refetch } = useQuery({
    queryKey: ['auto-renewals'],
    queryFn: async () => {
      // Use the safe view that excludes payment_token for security
      const data: any[] = [];
      for (let from = 0; ; from += QUERY_PAGE_SIZE) {
        const { data: page, error } = await supabase
          .from('subscriptions_v2_safe')
          .select(`
            id,
            user_id,
            order_id,
            next_charge_at,
            access_end_at,
            status,
            canceled_at,
            auto_renew,
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
              id,
              name,
              original_price,
              trial_price,
              product_id,
              products_v2 (id, name, category)
            ),
            payment_methods (status, last4, brand, verification_status, verification_error, recurring_verified),
            orders_v2 (final_price, paid_amount, currency, meta)
          `)
          .in('status', ['active', 'trial', 'past_due'])
          .order('next_charge_at', { ascending: true, nullsFirst: false })
          .range(from, from + QUERY_PAGE_SIZE - 1);
        if (error) throw error;
        data.push(...(page ?? []));
        if ((page?.length ?? 0) < QUERY_PAGE_SIZE) break;
      }

      // PATCH 3.1: Fetch active provider_subscriptions to determine BePaid status (source of truth)
      const providerSubs: any[] = [];
      for (let from = 0; ; from += QUERY_PAGE_SIZE) {
        const { data: page, error } = await supabase
          .from('provider_subscriptions')
          .select('id, subscription_v2_id, provider, provider_subscription_id, user_id, profile_id, amount_cents, currency, next_charge_at, last_charge_at, card_brand, card_last4, raw_data, meta, state')
          .in('state', ['active', 'trialing'])
          .range(from, from + QUERY_PAGE_SIZE - 1);
        if (error) throw error;
        providerSubs.push(...(page ?? []));
        if ((page?.length ?? 0) < QUERY_PAGE_SIZE) break;
      }

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

      const subscriptionIdList = (data || []).map((sub) => sub.id);
      const orderIdList = Array.from(new Set(
        (data || []).map((sub) => sub.order_id).filter(Boolean),
      ));
      const successfulPaymentsByOrder = new Map<string, number>();
      for (let offset = 0; offset < orderIdList.length; offset += 200) {
        const orderChunk = orderIdList.slice(offset, offset + 200);
        const { data: successfulPayments, error } = await supabase
          .from('payments_v2')
          .select('order_id')
          .in('order_id', orderChunk)
          .eq('status', 'succeeded')
          .eq('is_deleted', false);
        if (error) throw error;
        for (const payment of successfulPayments || []) {
          if (!payment.order_id) continue;
          successfulPaymentsByOrder.set(
            payment.order_id,
            (successfulPaymentsByOrder.get(payment.order_id) || 0) + 1,
          );
        }
      }
      const installmentEvidenceBySubscription = new Map<string, InstallmentPaymentEvidence>();
      if (subscriptionIdList.length > 0) {
        const rowsBySubscription = new Map<string, any[]>();
        for (let offset = 0; offset < subscriptionIdList.length; offset += 200) {
          const idChunk = subscriptionIdList.slice(offset, offset + 200);
          const { data: installmentPayments, error } = await supabase
            .from('installment_payments')
            .select('subscription_id, payment_number, charge_attempts, status, due_date, paid_at, last_attempt_at, error_message, payment_id')
            .in('subscription_id', idChunk)
            .order('due_date', { ascending: true });
          if (error) throw error;
          for (const payment of installmentPayments || []) {
            if (!payment.subscription_id) continue;
            const rows = rowsBySubscription.get(payment.subscription_id) ?? [];
            rows.push(payment);
            rowsBySubscription.set(payment.subscription_id, rows);
          }
        }
        for (const [subscriptionId, rows] of rowsBySubscription) {
          installmentEvidenceBySubscription.set(
            subscriptionId,
            summarizeInstallmentPayments(rows),
          );
        }
      }

      // PATCH-2026-04-29: canonical recurring SOT — собираем все active offers
      // по уникальным product_id, проверяем meta.recurring.is_recurring=true
      // (= UI-чекбокс «Подписка / автопродление»).
      const productIds = Array.from(new Set(
        (data || [])
          .map(s => (s.tariffs as any)?.product_id)
          .filter(Boolean)
      ));

      const recurringProductIds = new Set<string>();
      const offersByTariffId = new Map<string, any[]>();
      if (productIds.length > 0) {
        const { data: offers } = await supabase
          .from('tariff_offers')
          .select('id, tariff_id, is_active, meta, payment_method, is_installment, installment_count, tariffs!inner(product_id, is_active)')
          .eq('is_active', true)
          .in('tariffs.product_id', productIds);

        for (const o of (offers || []) as any[]) {
          const t = o.tariffs as any;
          if (!t?.is_active || !t?.product_id) continue;
          const current = offersByTariffId.get(o.tariff_id) || [];
          current.push(o);
          offersByTariffId.set(o.tariff_id, current);
          const isRec = !!o?.meta?.recurring?.is_recurring;
          if (isRec) recurringProductIds.add(t.product_id);
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
        const productId: string | null = product?.id || tariff?.product_id || null;
        const pm = sub.payment_methods as any;
        const profile = profileMap.get(sub.user_id);
        const order = sub.orders_v2 as any;
        const linkedPs = linkedPsMap.get(sub.id);
        const offerCandidates = offersByTariffId.get(sub.tariff_id || '') || [];
        const sourceOfferId = (sub.meta as any)?.offer_id || order?.meta?.offer_id || null;
        const sourceOffer = sourceOfferId
          ? offerCandidates.find((offer) => offer?.id === sourceOfferId)
          : null;
        const installmentOffer = sourceOffer && (
          sourceOffer.payment_method === 'internal_installment'
          || sourceOffer.is_installment === true
          || Number(sourceOffer.installment_count || 0) >= 2
        )
          ? sourceOffer
          : null;
        const finiteInstallment = isFiniteInstallment({
          subscriptionMeta: sub.meta,
          orderMeta: order?.meta,
          providerMeta: linkedPs?.meta,
          offerPaymentMethod: installmentOffer?.payment_method,
          offerIsInstallment: installmentOffer?.is_installment,
          offerInstallmentCount: installmentOffer?.installment_count,
        });
        const installmentEvidence = installmentEvidenceBySubscription.get(sub.id) ?? null;
        const retryObservability = resolveRetryObservability({
          subscriptionAttempts: sub.charge_attempts,
          installmentAttempts: installmentEvidence?.currentAttempts,
          subscriptionMeta: sub.meta,
          providerMeta: linkedPs?.meta,
          providerRawData: linkedPs?.raw_data,
          successfulAttempts: installmentEvidence?.successfulPayments,
          failedAttempts: installmentEvidence?.failedAttempts,
        });
        const installmentProgress = finiteInstallment
          ? resolveInstallmentProgress({
              subscriptionMeta: sub.meta,
              orderMeta: order?.meta,
              providerMeta: linkedPs?.meta,
              providerRawData: linkedPs?.raw_data,
              orderFinalPrice: order?.final_price,
              providerAmount: linkedPs?.amount_cents ? Number(linkedPs.amount_cents) / 100 : null,
              subscriptionNextChargeAt: sub.next_charge_at,
              providerNextChargeAt: linkedPs?.next_charge_at,
              successfulAttempts: retryObservability.successfulAttempts,
            })
          : null;
        const realInstallment = finiteInstallment && hasRealInstallmentEvidence({
          evidence: installmentEvidence,
          paidPayments: installmentProgress?.paidPayments,
          linkedSuccessfulPayments: sub.order_id
            ? successfulPaymentsByOrder.get(sub.order_id) || 0
            : 0,
          providerLastChargeAt: linkedPs?.last_charge_at,
        });

        const isOpenEndedRecurring = !!linkedPs
          || sub.auto_renew === true
          || (productId ? recurringProductIds.has(productId) : false);
        const isSubscription = finiteInstallment || isOpenEndedRecurring;

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
          next_charge_at: installmentProgress?.nextChargeAt ?? sub.next_charge_at,
          access_end_at: sub.access_end_at,
          status: sub.status,
          canceled_at: sub.canceled_at || null,
          auto_renew: sub.auto_renew === true,
          charge_attempts: sub.charge_attempts || 0,
          retry_observability: retryObservability,
          payment_method_id: sub.payment_method_id,
          has_payment_token: (sub as any).has_payment_token ?? false,
          meta: {
            ...((sub.meta as Record<string, unknown> | null) ?? {}),
            ...(installmentEvidence?.latestAttemptAt
              ? {
                  last_charge_attempt_at: installmentEvidence.latestAttemptAt,
                  last_charge_attempt_success: installmentEvidence.latestAttemptSucceeded,
                  last_charge_attempt_error: installmentEvidence.latestAttemptError,
                }
              : {}),
          },
          product_name: product?.name || null,
          tariff_name: tariff?.name || null,
          contact_name: profile?.full_name || null,
          contact_email: profile?.email || null,
          profile_id: profile?.id || null,
          pm_status: pm?.status || null,
          pm_last4: pm?.last4 || null,
          pm_brand: pm?.brand || null,
          // PATCH 3.2: Card verification fields
          pm_verification_status: pm?.verification_status || null,
          pm_verification_error: pm?.verification_error || null,
          pm_recurring_verified: pm?.recurring_verified ?? null,
          order_final_price: order?.final_price || null,
          order_currency: order?.currency || null,
          // canonical SOT
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
          is_bepaid: !!linkedPs,
          // PATCH P2.5: Computed display billing type
          display_billing_type: computeDisplayBillingType({
            is_bepaid: !!linkedPs,
            has_payment_token: (sub as any).has_payment_token ?? false,
            payment_method_id: sub.payment_method_id,
            pm_status: pm?.status || null,
            billing_type: (sub as any).billing_type || 'mit',
          }),
          provider_subscription_id: linkedPs?.provider_subscription_id || null,
          provider_last_charge_at: linkedPs?.last_charge_at || null,
          charged_today: !!linkedPs?.last_charge_at && isTodayMinsk(new Date(linkedPs.last_charge_at)),
          // Stage 2B: provider label
          provider: linkedPs?.provider === 'stripe' ? 'stripe' : (linkedPs ? 'bepaid' : 'local'),
          kind: finiteInstallment
            ? (realInstallment ? 'installment' : 'installment_draft')
            : 'recurring',
          installment_progress: installmentProgress,
          installment_evidence: installmentEvidence,
          batch_action_eligible: !realInstallment,
        };
      });

      // Auto-renewal ledger includes both open-ended recurring subscriptions and
      // finite internal installments. One-time products remain excluded.
      const filteredSubs = mappedSubs.filter(sub => {
        if (!sub.is_subscription) return false;
        if (sub.canceled_at) return false;
        if (sub.kind === 'installment' && sub.installment_progress?.completed) return false;
        const isStaleNonChargeableOverdue = !!sub.next_charge_at
          && isPastMinsk(new Date(sub.next_charge_at))
          && isStaleOverdue(new Date(sub.next_charge_at))
          && !sub.is_bepaid
          && !sub.payment_method_id
          && !sub.has_payment_token;
        return sub.kind === 'installment'
          || sub.kind === 'installment_draft'
          || !isStaleNonChargeableOverdue;
      });

      // Do not deduplicate by user + product: each active subscription/finite
      // plan is a separate financial obligation and must stay auditable.
      const visibleSubs = [...filteredSubs];

      // PATCH 3.1: Append orphan provider_subscriptions (active, not linked to subscriptions_v2)
      for (const ps of orphanPs) {
        // A provider row without any successful charge is only a checkout
        // preparation, not a real recurring financial obligation.
        if (!ps.last_charge_at) continue;
        const profile = ps.user_id ? profileMap.get(ps.user_id) : (ps.profile_id ? profileByIdMap.get(ps.profile_id) : null);
        const planTitle = ps.raw_data?.plan?.title || ps.raw_data?.plan?.name || null;
        const amountByn = (ps.amount_cents || 0) / 100;
        const psProvider: 'bepaid' | 'stripe' = ps.provider === 'stripe' ? 'stripe' : 'bepaid';

        visibleSubs.push({
          id: ps.id, // use provider_subscriptions UUID
          user_id: ps.user_id || '',
          order_id: null,
          next_charge_at: ps.next_charge_at || null,
          access_end_at: ps.next_charge_at || '',
          status: 'active',
          canceled_at: null,
          auto_renew: true,
          charge_attempts: 0,
          retry_observability: resolveRetryObservability({
            providerMeta: ps.meta,
            providerRawData: ps.raw_data,
          }),
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
          is_bepaid: psProvider === 'bepaid',
          display_billing_type: 'provider_managed' as const,
          // PATCH 3.2
          pm_verification_status: null,
          pm_verification_error: null,
          pm_recurring_verified: null,
          provider_subscription_id: ps.provider_subscription_id || null,
          provider_last_charge_at: ps.last_charge_at || null,
          charged_today: !!ps.last_charge_at && isTodayMinsk(new Date(ps.last_charge_at)),
          provider: psProvider,
          kind: 'recurring',
          installment_progress: null,
          installment_evidence: null,
          batch_action_eligible: false,
        });
      }

      return visibleSubs;
    },
    refetchInterval: 60000,
  });

  // Extract subscription IDs for batch notification query
  const subscriptionIds = useMemo(() => 
    (renewals || []).map(r => r.id), 
    [renewals]
  );

  // Canonical reminder outbox is the delivery source of truth for both channels.
  const {
    data: observability,
    error: observabilityError,
  } = useQuery<RenewalObservabilityResponse>({
    queryKey: ['auto-renewals-notification-outbox', subscriptionIds],
    queryFn: async () => {
      if (subscriptionIds.length === 0) return { logs: [], attempts: {} };
      const { data, error } = await supabase.functions.invoke(
        'admin-auto-renewal-observability',
        {
          body: {
            subscription_ids: subscriptionIds,
            days: 45,
          },
        },
      );
      if (error) {
        throw new Error(error.message || 'Не удалось получить статусы уведомлений и попыток');
      }
      return {
        logs: Array.isArray(data?.logs) ? data.logs : [],
        attempts: data?.attempts && typeof data.attempts === 'object'
          ? data.attempts
          : {},
        source_errors: Array.isArray(data?.source_errors) ? data.source_errors : [],
      };
    },
    enabled: subscriptionIds.length > 0,
    staleTime: 30000,
  });
  const notificationLogs = observability?.logs ?? [];
  const observedRenewals = useMemo(() => {
    const attempts = observability?.attempts ?? {};
    return (renewals ?? []).map((renewal) => {
      const observed = attempts[renewal.id];
      if (!observed) return renewal;
      const successfulAttempts = Math.max(
        renewal.retry_observability.successfulAttempts,
        Number(observed.successful_attempts || 0),
      );
      const failedAttempts = Math.max(
        renewal.retry_observability.failedAttempts,
        Number(observed.failed_attempts || 0),
      );
      const totalAttempts = Math.max(
        renewal.retry_observability.totalAttempts,
        Number(observed.total_attempts || 0),
        successfulAttempts + failedAttempts,
      );
      const currentAttempts = Math.max(
        renewal.retry_observability.attempts,
        Number(observed.current_attempts || 0),
      );
      return {
        ...renewal,
        retry_observability: {
          ...renewal.retry_observability,
          successfulAttempts,
          failedAttempts,
          totalAttempts,
          attempts: currentAttempts,
          exhausted: renewal.retry_observability.maxAttempts !== null
            && currentAttempts >= renewal.retry_observability.maxAttempts,
        },
        meta: observed.last_attempt_at
          ? {
              ...(renewal.meta ?? {}),
              last_charge_attempt_at: observed.last_attempt_at,
              last_charge_attempt_success: observed.last_attempt_success,
              last_charge_attempt_error: observed.last_attempt_error,
            }
          : renewal.meta,
      };
    });
  }, [observability?.attempts, renewals]);

  const filteredRenewals = useMemo(() => {
    if (!observedRenewals) return [];
    
    // Рабочий реестр по умолчанию содержит только реальные обязательства.
    // Неоплаченные checkout-заготовки доступны отдельным диагностическим фильтром.
    let result = filter === 'installment_drafts'
      ? observedRenewals
      : observedRenewals.filter((renewal) => {
          if (renewal.kind === 'installment_draft') return false;
          if (renewal.kind === 'installment') return true;
          return renewal.display_billing_type !== 'link_only';
        });
    
    // Apply filter - using Minsk timezone
    const nowMinsk = toZonedTime(new Date(), MINSK_TZ);
    const weekFromNow = addDays(nowMinsk, 7);
    
    switch (filter) {
      case 'recurring':
        result = result.filter(r => r.kind === 'recurring');
        break;
      case 'installments':
        result = result.filter(r => r.kind === 'installment');
        break;
      case 'installment_drafts':
        result = result.filter(r => r.kind === 'installment_draft');
        break;
      case 'installment_debt':
        result = result.filter(r =>
          r.kind === 'installment'
          && Number(r.installment_progress?.remainingAmount || 0) > 0
        );
        break;
      case 'due_today':
        result = result.filter(r =>
          canAutoCharge(r)
          && (r.charged_today || (r.next_charge_at && isTodayMinsk(new Date(r.next_charge_at))))
        );
        break;
      case 'due_week':
        result = result.filter(r => {
          if (!r.next_charge_at || !canAutoCharge(r)) return false;
          const dateMinsk = toZonedTime(new Date(r.next_charge_at), MINSK_TZ);
          return isBefore(dateMinsk, weekFromNow);
        });
        break;
      case 'overdue':
        result = result.filter(r =>
          canAutoCharge(r)
          && r.next_charge_at
          && isPastMinsk(new Date(r.next_charge_at))
        );
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
        result = result.filter(r => r.retry_observability.exhausted);
        break;
      case 'in_grace':
        result = result.filter(r => r.grace_period_status === 'in_grace');
        break;
      case 'expired_reentry':
        result = result.filter(r => r.grace_period_status === 'expired_reentry');
        break;
      case 'bepaid':
        // PATCH 3.1: filter by is_bepaid (source of truth from provider_subscriptions)
        result = result.filter(r => r.provider === 'bepaid');
        break;
      case 'stripe':
        // Stage 2B: Stripe cohort — provider=stripe + provider_subscription_id starts with sub_
        result = result.filter(r => r.provider === 'stripe' && (r.provider_subscription_id || '').startsWith('sub_'));
        break;
      // PATCH 3.2: Error and bad card filters
      case 'errors':
        result = result.filter(r => {
          const lastStatus = r.meta?.last_charge_attempt_success;
          const lastError = r.meta?.last_charge_attempt_error;
          return lastStatus === false || (lastError != null && lastError !== '');
        });
        break;
      case 'bad_card':
        result = result.filter(r => 
          !r.is_bepaid && 
          r.payment_method_id && 
          (r.pm_verification_status !== 'verified' || r.pm_recurring_verified !== true)
        );
        break;
      // PATCH P2.5: New billing type filters
      case 'broken_token':
        result = result.filter(r => r.display_billing_type === 'broken_token');
        break;
      case 'requires_3ds':
        result = result.filter(r => r.display_billing_type === 'requires_3ds');
        break;
      case 'link_only':
        result = result.filter(r => r.display_billing_type === 'link_only');
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
  }, [observedRenewals, filter, searchQuery]);

  // Sorting logic using useTableSort hook
  const getFieldValue = useCallback((r: AutoRenewal, key: string) => {
    switch (key) {
      case 'contact':
        return (r.contact_name || r.contact_email || '').toLowerCase();
      case 'product':
        return (r.product_name || r.tariff_name || '').toLowerCase();
      case 'kind':
        return r.kind;
      case 'progress':
        return r.installment_progress
          ? r.installment_progress.paidPayments / Math.max(1, r.installment_progress.totalPayments)
          : null;
      case 'remaining':
        return r.installment_progress?.remainingAmount ?? 0;
      case 'amount':
        return getChargeAmount(r).amount || 0;
      case 'next_charge':
        return r.next_charge_at ? new Date(r.next_charge_at).getTime() : null;
      case 'access_end':
        return r.access_end_at ? new Date(r.access_end_at).getTime() : null;
      case 'attempts':
        return r.retry_observability.attempts;
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
  const pageCount = Math.max(1, Math.ceil(sortedData.length / TABLE_PAGE_SIZE));
  const pagedData = useMemo(
    () => sortedData.slice(
      (tablePage - 1) * TABLE_PAGE_SIZE,
      tablePage * TABLE_PAGE_SIZE,
    ),
    [sortedData, tablePage],
  );

  useEffect(() => {
    setTablePage(1);
  }, [filter, searchQuery]);

  useEffect(() => {
    if (tablePage > pageCount) setTablePage(pageCount);
  }, [pageCount, tablePage]);

  // Stats with amounts - PATCH-6: Exclude staff and NULL next_charge_at from due/overdue metrics
  const stats = useMemo(() => {
    if (!observedRenewals) return null;
    
    // PATCH-6: For due/overdue metrics, exclude staff and NULL next_charge_at
    const realRenewals = observedRenewals.filter((renewal) => {
      if (renewal.kind === 'installment_draft') return false;
      if (renewal.kind === 'installment') return true;
      return renewal.display_billing_type !== 'link_only';
    });
    const eligibleForMetrics = realRenewals.filter(r =>
      r.next_charge_at && !r.is_staff && canAutoCharge(r)
    );
    
    const chargedTodayList = realRenewals.filter(r => r.charged_today && !r.is_staff);
    const dueTodayRemainingList = eligibleForMetrics.filter(r => isTodayMinsk(new Date(r.next_charge_at!)) && !r.charged_today);
    const dueTodayList = realRenewals.filter(r =>
      !r.is_staff
      && canAutoCharge(r)
      && (r.charged_today || (r.next_charge_at && isTodayMinsk(new Date(r.next_charge_at))))
    );
    const overdueList = eligibleForMetrics.filter(r => isPastMinsk(new Date(r.next_charge_at!)));
    // AR-P0.9.6: exclude BePaid from "no card" stat (PATCH 3.1: use is_bepaid)
    const noCardList = realRenewals.filter(r => !r.payment_method_id && !r.is_bepaid);
    const installmentList = realRenewals.filter(r => r.kind === 'installment');
    const recurringList = realRenewals.filter(r => r.kind === 'recurring');
    const installmentDebt = installmentList.reduce(
      (sum, r) => sum + Number(r.installment_progress?.remainingAmount || 0),
      0,
    );
    
    // PATCH-6: Count subscriptions with NULL next_charge_at
    const noChargeDateList = realRenewals.filter(r => !r.next_charge_at);
    
    const sumAmount = (list: AutoRenewal[]) => 
      list.reduce((sum, r) => sum + getChargeAmount(r).amount, 0);
    
    // PATCH 3.1: MIT/BePaid split using is_bepaid (source of truth)
    const bepaidTotal = realRenewals.filter(r => r.is_bepaid).length;
    const mitTotal = realRenewals.length - bepaidTotal;
    const mitDueToday = dueTodayList.filter(r => !r.is_bepaid).length;
    const bepaidDueToday = dueTodayList.filter(r => r.is_bepaid).length;

    // PATCH 3.2: Error and bad card counts
    const errorsList = realRenewals.filter(r => {
      const lastStatus = r.meta?.last_charge_attempt_success;
      const lastError = r.meta?.last_charge_attempt_error;
      return lastStatus === false || (lastError != null && lastError !== '');
    });
    const badCardList = realRenewals.filter(r =>
      !r.is_bepaid && 
      r.payment_method_id && 
      (r.pm_verification_status !== 'verified' || r.pm_recurring_verified !== true)
    );

    return {
      total: { count: realRenewals.length, sum: sumAmount(realRenewals) },
      recurring: { count: recurringList.length, sum: sumAmount(recurringList) },
      installments: {
        count: installmentList.length,
        sum: installmentDebt,
      },
      dueToday: { count: dueTodayList.length, sum: sumAmount(dueTodayList) },
      dueTodayCharged: { count: chargedTodayList.length, sum: sumAmount(chargedTodayList) },
      dueTodayRemaining: { count: dueTodayRemainingList.length, sum: sumAmount(dueTodayRemainingList) },
      overdue: { count: overdueList.length, sum: sumAmount(overdueList) },
      noCard: { count: noCardList.length, sum: sumAmount(noCardList) },
      noChargeDate: { count: noChargeDateList.length, sum: 0 },
      // AR-P0.9.7: split counts
      bepaidTotal,
      mitTotal,
      mitDueToday,
      bepaidDueToday,
      // PATCH 3.2
      errors: errorsList.length,
      badCard: badCardList.length,
    };
  }, [observedRenewals]);

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
    if (renewal.charged_today) return { label: 'Списано', variant: 'default' as const, className: 'bg-emerald-600' };
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

  const cancelUnpaidDraft = async () => {
    if (!draftToCancel) return;
    setDraftCancelLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "admin-cancel-unpaid-subscription-drafts",
        {
          body: {
            subscription_ids: [draftToCancel.id],
            dry_run: false,
          },
        },
      );
      if (error) throw error;
      if (!Array.isArray(data?.canceled) || !data.canceled.includes(draftToCancel.id)) {
        throw new Error(data?.failed?.[0]?.reason || data?.blocked?.[0]?.reason || "Заготовка не отменена");
      }
      toast.success("Неоплаченная заготовка отменена");
      setDraftToCancel(null);
      await refetch();
    } catch (error) {
      toast.error((error as Error).message || "Не удалось отменить заготовку");
    } finally {
      setDraftCancelLoading(false);
    }
  };
  
  // Selection handlers
  const batchEligibleIds = useMemo(
    () => sortedData.filter((renewal) => renewal.batch_action_eligible).map((renewal) => renewal.id),
    [sortedData],
  );
  const allBatchEligibleSelected = batchEligibleIds.length > 0
    && batchEligibleIds.every((id) => selectedIds.has(id));

  const toggleSelectAll = () => {
    if (allBatchEligibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(batchEligibleIds));
    }
  };

  const toggleItem = (renewal: AutoRenewal) => {
    if (!renewal.batch_action_eligible) return;
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(renewal.id)) next.delete(renewal.id);
      else next.add(renewal.id);
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
  const selectedRenewals = useMemo(
    () => (observedRenewals ?? []).filter((renewal) => selectedIds.has(renewal.id)),
    [observedRenewals, selectedIds],
  );
  const batchContainsDrafts = selectedRenewals.some(
    (renewal) => renewal.kind === 'installment_draft',
  );
  const batchContainsRecurring = selectedRenewals.some(
    (renewal) => renewal.kind !== 'installment_draft',
  );
  
  // PATCH-5: Fix club billing dates modal state
  const [fixBillingDialogOpen, setFixBillingDialogOpen] = useState(false);
  const [fixDryRunResult, setFixDryRunResult] = useState<any>(null);
  const [fixLoading, setFixLoading] = useState(false);
  const [fixExecuteLoading, setFixExecuteLoading] = useState(false);

  const handleBatchDisable = async (dryRun: boolean) => {
    if (selectedIds.size === 0) return;
    if (batchContainsDrafts && batchContainsRecurring) {
      toast.error('Выберите либо неоплаченные заготовки, либо рекуррентные подписки');
      return;
    }
    
    setBatchLoading(true);
    try {
      const functionName = batchContainsDrafts
        ? 'admin-cancel-unpaid-subscription-drafts'
        : 'admin-batch-disable-auto-renew';
      const response = await supabase.functions.invoke(functionName, {
        body: { 
          subscription_ids: Array.from(selectedIds), 
          dry_run: dryRun,
          reason: 'admin_manual_disable'
        }
      });
      
      if (response.error) throw new Error(response.error.message);
      
      if (dryRun) {
        if (batchContainsDrafts) {
          const eligible = new Set(response.data.eligible || []);
          setBatchPreview(selectedRenewals
            .filter((renewal) => eligible.has(renewal.id))
            .map((renewal) => ({
              id: renewal.id,
              contact: renewal.contact_name || renewal.contact_email || 'Без имени',
              product: renewal.product_name || renewal.tariff_name || 'Без продукта',
            })));
          setBatchRemaining(0);
        } else {
          setBatchPreview(response.data.subscriptions || []);
          setBatchRemaining(response.data.remaining ?? 0);
        }
        setBatchDialogOpen(true);
      } else {
        const affected = batchContainsDrafts
          ? response.data.canceled?.length || 0
          : response.data.count || 0;
        toast.success(
          response.data.message
            || (batchContainsDrafts
              ? `Отменено неоплаченных заготовок: ${affected}`
              : `Отключено: ${affected}`),
        );
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
            disabled={!renewal.batch_action_eligible}
            aria-label={
              renewal.batch_action_eligible
                ? 'Выбрать подписку'
                : 'Действующую рассрочку нельзя отменить как неоплаченную заготовку'
            }
            onCheckedChange={() => toggleItem(renewal)}
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
                  Сотрудник
                </Badge>
              )}
              {/* PATCH-6: Comped badge (if not staff) */}
              {!renewal.is_staff && renewal.is_comped && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-green-100 text-green-700">
                  Бесплатно
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
      case 'kind':
        return (
          <Badge
            variant="outline"
            className={cn(
              'text-[10px] whitespace-nowrap',
              renewal.kind === 'installment'
                ? 'border-amber-400 text-amber-700 bg-amber-50 dark:bg-amber-950/20 dark:text-amber-300'
                : renewal.kind === 'installment_draft'
                  ? 'border-slate-400 text-slate-700 bg-slate-50 dark:bg-slate-950/20 dark:text-slate-300'
                : 'border-blue-400 text-blue-700 bg-blue-50 dark:bg-blue-950/20 dark:text-blue-300',
            )}
          >
            {renewal.kind === 'installment'
              ? 'Рассрочка'
              : renewal.kind === 'installment_draft'
                ? 'Не оплачена'
                : 'Рекуррент'}
          </Badge>
        );
      case 'progress':
        if (!renewal.installment_progress) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        if (renewal.kind === 'installment_draft') {
          return (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs text-destructive"
              onClick={(event) => {
                event.stopPropagation();
                setDraftToCancel(renewal);
              }}
            >
              Отменить
            </Button>
          );
        }
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="secondary" className="text-xs whitespace-nowrap">
                {renewal.installment_progress.paidPayments}/{renewal.installment_progress.totalPayments}
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="text-xs">
              Оплачено {renewal.installment_progress.paidPayments}, осталось{' '}
              {renewal.installment_progress.remainingPayments}
            </TooltipContent>
          </Tooltip>
        );
      case 'remaining':
        if (!renewal.installment_progress) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        return (
          <span className="text-sm font-mono">
            {formatAmount(
              renewal.installment_progress.remainingAmount,
              renewal.order_currency || 'BYN',
            )}
          </span>
        );
      case 'provider': {
        const cfg: Record<string, { label: string; className: string }> = {
          bepaid: { label: 'bePaid', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-300/50' },
          stripe: { label: 'Stripe', className: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 border-violet-300/50' },
          local: { label: 'Внутренняя запись', className: 'bg-muted text-muted-foreground border-border' },
        };
        const c = cfg[renewal.provider] || cfg.local;
        return (
          <Badge variant="outline" className={cn('text-[10px] px-1.5 font-medium', c.className)}>
            {c.label}
          </Badge>
        );
      }
      case 'billing_type': {
        const dbt = renewal.display_billing_type;
        const billingConfig: Record<string, { label: string; emoji: string; className: string }> = {
          provider_managed: { label: 'bePaid', emoji: '🔄', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
          mit: { label: 'Автосписание', emoji: '💳', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
          broken_token: { label: 'Ошибка токена', emoji: '⚠️', className: 'bg-destructive/10 text-destructive' },
          requires_3ds: { label: 'Нужен 3-D Secure', emoji: '🔐', className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
          link_only: { label: 'Нет автосписания', emoji: '🔗', className: 'text-muted-foreground' },
        };
        const cfg = billingConfig[dbt] || billingConfig.link_only;
        return (
          <Badge 
            variant="outline"
            className={cn('text-[10px] px-1.5', cfg.className)}
          >
            {cfg.emoji} {cfg.label}
          </Badge>
        );
      }
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
        if (!renewal.access_end_at || isNaN(new Date(renewal.access_end_at).getTime())) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        return (
          <span className="text-xs text-muted-foreground">
            {format(new Date(renewal.access_end_at), 'dd.MM.yy', { locale: ru })}
          </span>
        );
      case 'attempts': {
        const isBadCard = !renewal.is_bepaid && renewal.payment_method_id && 
          (renewal.pm_verification_status !== 'verified' || renewal.pm_recurring_verified !== true);
        const badge = (
          <Badge 
            variant={renewal.retry_observability.exhausted ? 'destructive' : 'secondary'}
            className="text-xs"
          >
            {retryAttemptSummaryLabel(renewal.retry_observability)}
          </Badge>
        );
        if (renewal.retry_observability.attempts === 0 && isBadCard) {
          return (
            <Tooltip>
              <TooltipTrigger asChild>{badge}</TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                Списание не запускалось: карта не пригодна
                {renewal.pm_verification_error && ` (${renewal.pm_verification_error})`}
              </TooltipContent>
            </Tooltip>
          );
        }
        return (
          <Tooltip>
            <TooltipTrigger asChild>{badge}</TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              <div>Текущая серия: {retryAttemptLabel(renewal.retry_observability)}</div>
              <div>Всего: {renewal.retry_observability.totalAttempts}</div>
              <div>Успешных: {renewal.retry_observability.successfulAttempts}</div>
              <div>Неуспешных: {renewal.retry_observability.failedAttempts}</div>
            </TooltipContent>
          </Tooltip>
        );
      }
      case 'card':
        // AR-P0.9.6: provider_managed doesn't need a local card
        if (renewal.billing_type === 'provider_managed') {
          return (
            <Badge variant="outline" className="text-[10px] mx-auto border-blue-400 text-blue-600">
              bePaid
            </Badge>
          );
        }
        if (renewal.payment_method_id) {
          // PATCH 3.2: Check verification status
          const vs = renewal.pm_verification_status;
          const rv = renewal.pm_recurring_verified;
          if (vs === 'failed' || vs === 'rejected') {
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertTriangle className="h-4 w-4 text-destructive mx-auto" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  <p className="font-medium">Карта не пригодна для списаний</p>
                  {renewal.pm_verification_error && <p className="text-muted-foreground">{renewal.pm_verification_error}</p>}
                  <p className="text-muted-foreground">Статус: {vs} · Recurring: {rv ? 'да' : 'нет'}</p>
                </TooltipContent>
              </Tooltip>
            );
          }
          if (vs === 'pending' || vs === 'processing') {
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Clock className="h-4 w-4 text-blue-500 mx-auto animate-pulse" />
                </TooltipTrigger>
                <TooltipContent className="text-xs">Проверка карты в процессе</TooltipContent>
              </Tooltip>
            );
          }
          if (vs === 'verified' && rv === true) {
            return <CheckCircle className="h-4 w-4 text-green-600 mx-auto" />;
          }
          // Card exists but not verified yet
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="h-4 w-4 text-amber-500 mx-auto" />
              </TooltipTrigger>
              <TooltipContent className="text-xs">
                Карта не проверена (статус: {vs || 'нет'})
              </TooltipContent>
            </Tooltip>
          );
        }
        return <XCircle className="h-4 w-4 text-muted-foreground mx-auto" />;
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
            {{
              active: 'Активен',
              inactive: 'Неактивен',
              failed: 'Ошибка',
              pending: 'Ожидает',
              processing: 'Обрабатывается',
            }[renewal.pm_status] || renewal.pm_status}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        );
      case 'last_attempt': {
        if (!lastAttempt) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        // PATCH 3.2: Tooltip with normalized error for unknown/failed
        const errorText = lastAttempt.error || '';
        const normalizedError = errorText.toLowerCase().includes('unknown') 
          ? 'Неизвестная ошибка (gateway/network/invalid token)'
          : errorText;
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1 cursor-default">
                {lastAttempt.success ? (
                  <CheckCircle className="h-3 w-3 text-green-600" />
                ) : (
                  <AlertTriangle className="h-3 w-3 text-destructive" />
                )}
                <span className={cn(
                  'text-[10px] truncate max-w-[80px]',
                  lastAttempt.success ? 'text-green-600' : 'text-destructive'
                )}>
                  {lastAttempt.success ? 'Успешно' : errorText.slice(0, 20) || 'Ошибка'}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              <p>{lastAttempt.success ? 'Успешное списание' : normalizedError || 'Ошибка списания'}</p>
              <p className="text-muted-foreground">
                {lastAttempt.at && !isNaN(new Date(lastAttempt.at).getTime())
                  ? format(new Date(lastAttempt.at), 'dd.MM.yy HH:mm', { locale: ru })
                  : '—'}
              </p>
            </TooltipContent>
          </Tooltip>
        );
      }
      case 'tg_status':
        // PATCH-6: Don't show indicators for NULL next_charge_at
        if (!renewal.next_charge_at) {
          return <span className="text-muted-foreground text-xs">—</span>;
        }
        return (
          <NotificationStatusIndicators
            subscriptionId={renewal.id}
            channel="telegram"
            logs={(notificationLogs || []).filter((log) => log.channel === 'telegram')}
            nextChargeAt={renewal.next_charge_at}
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
            logs={(notificationLogs || []).filter((log) => log.channel === 'email')}
            nextChargeAt={renewal.next_charge_at}
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
        {(observabilityError || (observability?.source_errors?.length ?? 0) > 0) && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-medium">
                Статусы уведомлений и попыток загружены не полностью
              </div>
              <div className="text-xs">
                Серые индикаторы нельзя считать подтверждением отсутствия отправки.
                Обновите страницу или проверьте диагностику.
              </div>
            </div>
          </div>
        )}
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
              <div className="text-xs text-muted-foreground">Всего автоплатежей</div>
              <div className="text-sm font-medium mt-1">
                {stats.total.sum.toFixed(2)} BYN
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                Рекуррентные: {stats.recurring.count} · Рассрочки: {stats.installments.count}
              </div>
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
              <div className="text-2xl font-bold text-blue-600">
                {stats.dueTodayCharged.count}/{stats.dueToday.count}
              </div>
              <div className="text-xs text-muted-foreground">К списанию сегодня</div>
              <div className="text-sm font-medium text-blue-600 mt-1">
                {stats.dueToday.sum.toFixed(2)} BYN
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                Списано: {stats.dueTodayCharged.count} · Осталось: {stats.dueTodayRemaining.count}
              </div>
              {(stats.mitDueToday > 0 || stats.bepaidDueToday > 0) && (
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  bePaid: {stats.bepaidDueToday}{stats.mitDueToday > 0 ? ` · Локальная карта: ${stats.mitDueToday}` : ''}
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
                filter === 'installment_debt' && "border-amber-500 bg-amber-500/5"
              )}
              onClick={() => handleStatClick('installment_debt')}
              role="button"
              aria-pressed={filter === 'installment_debt'}
            >
              <div className="text-2xl font-bold text-amber-600">{stats.installments.count}</div>
              <div className="text-xs text-muted-foreground">Конечные рассрочки</div>
              <div className="text-sm font-medium text-amber-600 mt-1">
                Долг: {stats.installments.sum.toFixed(2)} BYN
              </div>
            </Card>
          </div>
        )}

        {/* PATCH 3.2: Summary bar with clickable indicators */}
        {stats && (stats.errors > 0 || stats.badCard > 0 || stats.noCard.count > 0) && (
          <div className="flex flex-wrap items-center gap-3 px-3 py-2 rounded-lg bg-muted/40 border border-border/50">
            {stats.errors > 0 && (
              <button
                onClick={() => handleStatClick('errors')}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
                  filter === 'errors' 
                    ? "bg-destructive/15 text-destructive ring-1 ring-destructive/30" 
                    : "hover:bg-destructive/10 text-destructive/80"
                )}
              >
                <AlertTriangle className="h-3 w-3" />
                Ошибки: {stats.errors}
              </button>
            )}
            {stats.badCard > 0 && (
              <button
                onClick={() => handleStatClick('bad_card')}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
                  filter === 'bad_card' 
                    ? "bg-amber-500/15 text-amber-700 ring-1 ring-amber-500/30 dark:text-amber-400" 
                    : "hover:bg-amber-500/10 text-amber-600/80 dark:text-amber-400/80"
                )}
              >
                <ShieldAlert className="h-3 w-3" />
                Проблемные карты: {stats.badCard}
              </button>
            )}
            {stats.noCard.count > 0 && (
              <button
                onClick={() => handleStatClick('no_card')}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
                  filter === 'no_card' 
                    ? "bg-muted text-foreground ring-1 ring-border" 
                    : "hover:bg-muted text-muted-foreground"
                )}
              >
                <CreditCard className="h-3 w-3" />
                Без карты: {stats.noCard.count}
              </button>
            )}
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
                  {batchContainsDrafts ? 'Отменить заготовки' : 'Отключить автопродление'}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {batchContainsDrafts ? 'Отменить неоплаченные заготовки' : 'Отключить автопродление'}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-3 py-4">
                  <p className="text-sm text-muted-foreground">
                    {batchContainsDrafts
                      ? `Будут отменены только проверенные неоплаченные заготовки (${selectedIds.size} выбрано):`
                      : `Будет отключено автопродление для ${selectedIds.size} подписок:`}
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
            <SelectTrigger className="w-full sm:w-[260px] h-9">
              <Filter className="h-3.5 w-3.5 mr-2" />
              <SelectValue placeholder="Фильтр" />
            </SelectTrigger>
            <SelectContent className="max-h-[70vh]">
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

          {/* INV-22 — шестерёнка с badge числа зомби-подписок, открывает диалог разбора */}
          <Inv22ResolverPanel />

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
                Исправить даты списаний клуба
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => setBackfillDialogOpen(true)}
                disabled={!hasPermission('subscriptions.edit')}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Восстановить снимок автопродлений
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => setBackfill2026DialogOpen(true)}
                disabled={!hasPermission('subscriptions.edit')}
              >
                <FileText className="h-4 w-4 mr-2" />
                Восстановить сделки с 2026 года
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => setFixIntegrityDialogOpen(true)}
                disabled={!hasPermission('subscriptions.edit')}
              >
                <Wrench className="h-4 w-4 mr-2" />
                Исправить целостность с 2026 года
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
                Нет автоплатежей по выбранному фильтру
              </div>
            ) : (
              <div data-table-scroll-x="true" className="table-scroll-x">
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={sortedColumns.map(c => c.key)} strategy={horizontalListSortingStrategy}>
                    <Table style={{ tableLayout: 'fixed', width: '100%', minWidth: totalColumnsWidth }}>
                      <TableHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm">
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
                                  checked={allBatchEligibleSelected}
                                  disabled={batchEligibleIds.length === 0}
                                  onCheckedChange={toggleSelectAll}
                                />
                              ) : col.key === 'tg_status' ? (
                                <div className="flex flex-col items-center">
                                  <Send className="h-3.5 w-3.5 mb-0.5" />
                                  <span className="text-[9px]">Telegram 7/3/1</span>
                                </div>
                              ) : col.key === 'email_status' ? (
                                <div className="flex flex-col items-center">
                                  <Mail className="h-3.5 w-3.5 mb-0.5" />
                                  <span className="text-[9px]">Почта 7/3/1</span>
                                </div>
                              ) : col.label}
                            </SortableResizableHeader>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pagedData.map((renewal) => (
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
              </div>
            )}
            {!isLoading && sortedData.length > 0 && (
              <div className="flex flex-col gap-2 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-muted-foreground">
                  Показано {(tablePage - 1) * TABLE_PAGE_SIZE + 1}–
                  {Math.min(tablePage * TABLE_PAGE_SIZE, sortedData.length)} из {sortedData.length}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={tablePage <= 1}
                    onClick={() => setTablePage((page) => Math.max(1, page - 1))}
                  >
                    Назад
                  </Button>
                  <span className="min-w-[90px] text-center text-xs">
                    Страница {tablePage} из {pageCount}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={tablePage >= pageCount}
                    onClick={() => setTablePage((page) => Math.min(pageCount, page + 1))}
                  >
                    Далее
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog
          open={!!draftToCancel}
          onOpenChange={(open) => {
            if (!open && !draftCancelLoading) setDraftToCancel(null);
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Отменить неоплаченную заготовку?</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <p>
                Будет отменена только запись без единого успешного платежа.
                Если есть активная подписка у провайдера, она тоже будет отменена.
                Платежи, доступы и сделки не удаляются.
              </p>
              <p className="text-muted-foreground">
                {draftToCancel?.contact_name || draftToCancel?.contact_email || 'Контакт'}
                {' · '}
                {draftToCancel?.product_name || 'Продукт'}
              </p>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                disabled={draftCancelLoading}
                onClick={() => setDraftToCancel(null)}
              >
                Назад
              </Button>
              <Button
                variant="destructive"
                disabled={draftCancelLoading}
                onClick={cancelUnpaidDraft}
              >
                {draftCancelLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Отменяем…
                  </>
                ) : (
                  'Отменить заготовку'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

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
              <DialogTitle>Исправление дат списаний клуба</DialogTitle>
            </DialogHeader>
            
            {!fixDryRunResult ? (
              // Step 1: Dry Run
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Найти и исправить проблемные подписки клуба:
                </p>
                <ul className="text-xs text-muted-foreground list-disc list-inside space-y-1">
                  <li>Нет даты следующего списания при включённом автопродлении</li>
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
