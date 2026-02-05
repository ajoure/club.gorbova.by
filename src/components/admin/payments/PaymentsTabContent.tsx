import { useState, useMemo, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { 
  Download, Search, Filter, X, RefreshCw, ChevronDown, FileSpreadsheet, Settings
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { useUnifiedPayments, UnifiedPayment, DateFilter } from "@/hooks/useUnifiedPayments";
import PaymentsStatsPanel, { StatsFilterType } from "./PaymentsStatsPanel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PaymentsTable, { ColumnConfig, DEFAULT_COLUMNS } from "@/components/admin/payments/PaymentsTable";
import PaymentsFilters from "@/components/admin/payments/PaymentsFilters";
import PaymentsBatchActions from "@/components/admin/payments/PaymentsBatchActions";
import DatePeriodSelector from "@/components/admin/payments/DatePeriodSelector";
import SyncRunDialog from "@/components/admin/payments/SyncRunDialog";
import SyncWithStatementDialog from "@/components/admin/payments/SyncWithStatementDialog";
import { TimezoneSelector, usePersistedTimezone } from "./TimezoneSelector";
import { useAuth } from "@/contexts/AuthContext";

export type PaymentFilters = {
  search: string;
  status: string;
  type: string;
  hasContact: string;
  hasDeal: string;
  hasMapping: string;
  hasReceipt: string;
  hasRefunds: string;
  isExternal: string;
  isGhost: string;
  hasConflict: string;
  source: string;
};

const defaultFilters: PaymentFilters = {
  search: "",
  status: "all", // PATCH-C2: Changed from "successful_and_refunds" to show ALL transactions by default
  type: "all",
  hasContact: "all",
  hasDeal: "all",
  hasMapping: "all",
  hasReceipt: "all",
  hasRefunds: "all",
  isExternal: "all",
  isGhost: "all",
  hasConflict: "all",
  source: "all",
};

const COLUMNS_STORAGE_KEY = 'admin_payments_columns_v1';

export function PaymentsTabContent() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { role } = useAuth();
  
  // Date filter - default to current month in Europe/Minsk
  const MINSK_TZ = 'Europe/Minsk';
  const nowMinsk = toZonedTime(new Date(), MINSK_TZ);
  const [dateFilter, setDateFilter] = useState<DateFilter>({
    from: format(startOfMonth(nowMinsk), 'yyyy-MM-dd'),
    to: format(endOfMonth(nowMinsk), 'yyyy-MM-dd'),
  });
  
  // PATCH-5: Page size for UI limiting (reduces displayed rows, not server load)
  const [pageSize, setPageSize] = useState<number>(50);
  
  // Filters
  const [filters, setFilters] = useState<PaymentFilters>(defaultFilters);
  const [showFilters, setShowFilters] = useState(false);
  
  // Stats panel filter (clickable cards)
  const [statsFilter, setStatsFilter] = useState<StatsFilterType>(null);
  
  // Selection for batch operations
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  
  // Sync dialogs
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncStatementDialogOpen, setSyncStatementDialogOpen] = useState(false);
  
  // Timezone - IANA timezone with persistence
  const { getInitialValue, setTimezone: persistTimezone } = usePersistedTimezone();
  const [selectedTimezone, setSelectedTimezone] = useState(getInitialValue);
  
  // Column state (lifted from PaymentsTable for settings dropdown)
  const [columns, setColumns] = useState<ColumnConfig[]>(() => {
    const saved = localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return DEFAULT_COLUMNS.map(dc => {
          const savedCol = parsed.find((p: ColumnConfig) => p.key === dc.key);
          return savedCol ? { ...dc, ...savedCol } : dc;
        });
      } catch {
        return DEFAULT_COLUMNS;
      }
    }
    return DEFAULT_COLUMNS;
  });
  
  // Save columns to localStorage
  useEffect(() => {
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(columns));
  }, [columns]);
  
  const resetColumns = () => {
    setColumns(DEFAULT_COLUMNS);
    localStorage.removeItem(COLUMNS_STORAGE_KEY);
    toast.success("Колонки сброшены");
  };
  
  // Persist timezone changes
  const handleTimezoneChange = (tz: string) => {
    setSelectedTimezone(tz);
    persistTimezone(tz);
  };
  
  // Fetch unified payment data
  const effectiveDateFilter = useMemo(() => ({
    ...dateFilter,
    includeImport: true,
  }), [dateFilter]);
  
  const { 
    payments: allPayments, 
    isLoading, 
    stats, 
    refetch 
  } = useUnifiedPayments(effectiveDateFilter);

  // Always use all payments (no more source mode filtering)
  const payments = allPayments;

  // Helper to normalize transaction type
  const normalizeType = (raw: string | null | undefined) => {
    const v = (raw || '').toLowerCase().trim();
    if (!v) return 'payment';
    if (['refund', 'refunded', 'возврат средств', 'возврат'].includes(v)) return 'refund';
    if (['payment', 'оплата', 'платеж', 'платёж'].includes(v)) return 'payment';
    if (['subscription', 'подписка'].includes(v)) return 'subscription';
    if (['authorization', 'auth', 'авторизация'].includes(v)) return 'authorization';
    if (['void', 'canceled', 'cancelled', 'отмена', 'cancellation', 'authorization_void'].includes(v)) return 'void';
    if (['chargeback', 'чарджбек'].includes(v)) return 'chargeback';
    return v;
  };
  
  const isCancelledTransaction = (p: UnifiedPayment) => {
    const txType = normalizeType(p.transaction_type);
    return txType === 'void';
  };

  // Apply filters to payments (including stats filter)
  const filteredPayments = useMemo(() => {
    return payments.filter(p => {
      // Stats panel filter (from clickable cards)
      if (statsFilter) {
        const isSuccessful = ['successful', 'succeeded'].includes(p.status_normalized);
        const isRefund = normalizeType(p.transaction_type) === 'refund' || ['refund', 'refunded'].includes(p.status_normalized) || p.amount < 0;
        const isCancelled = isCancelledTransaction(p);
        const isFailed = ['failed', 'declined', 'expired', 'error', 'incomplete'].includes(p.status_normalized) && !isCancelled;
        
        switch (statsFilter) {
          case 'successful':
            if (!isSuccessful || isRefund || isCancelled) return false;
            break;
          case 'refunded':
            if (!isRefund) return false;
            break;
          case 'cancelled':
            if (!isCancelled) return false;
            break;
          case 'failed':
            if (!isFailed) return false;
            break;
        }
      }

      // Search filter
      if (filters.search) {
        const search = filters.search.toLowerCase();
        const matchSearch = 
          p.uid?.toLowerCase().includes(search) ||
          p.customer_email?.toLowerCase().includes(search) ||
          p.customer_phone?.toLowerCase().includes(search) ||
          p.card_holder?.toLowerCase().includes(search) ||
          p.card_last4?.includes(search) ||
          p.order_number?.toLowerCase().includes(search) ||
          p.profile_name?.toLowerCase().includes(search) ||
          p.profile_email?.toLowerCase().includes(search) ||
          p.profile_phone?.toLowerCase().includes(search);
        if (!matchSearch) return false;
      }

      // Status filter (only if stats filter is not active)
      if (!statsFilter && filters.status !== "all") {
        if (filters.status === "successful_and_refunds") {
          const isSuccessful = ['successful', 'succeeded'].includes(p.status_normalized);
          const isRefundStatus = ['refund', 'refunded'].includes(p.status_normalized);
          const isRefundType = normalizeType(p.transaction_type) === 'refund';
          const isNegativeAmount = p.amount < 0;
          if (!isSuccessful && !isRefundStatus && !isRefundType && !isNegativeAmount) return false;
        } else if (filters.status === "cancelled") {
          if (!isCancelledTransaction(p)) return false;
        } else if (filters.status === "processing") {
          // PATCH-C3: Filter for processing/pending transactions
          const processingStatuses = ['processing', 'pending', 'incomplete', 'pending_3ds'];
          if (!processingStatuses.includes(p.status_normalized)) return false;
        } else if (filters.status === "failed") {
          const failedStatuses = ['failed', 'declined', 'expired', 'error'];
          const isCancel = isCancelledTransaction(p);
          const isProcessing = ['processing', 'pending', 'incomplete'].includes(p.status_normalized);
          if (!failedStatuses.includes(p.status_normalized) || isCancel || isProcessing) return false;
        } else if (filters.status !== p.status_normalized) {
          return false;
        }
      }

      // Type filter
      if (filters.type !== "all" && normalizeType(p.transaction_type) !== filters.type) return false;

      // Has contact filter
      if (filters.hasContact === "yes" && !p.profile_id) return false;
      if (filters.hasContact === "no" && p.profile_id) return false;

      // Has deal filter
      if (filters.hasDeal === "yes" && !p.order_id) return false;
      if (filters.hasDeal === "no" && p.order_id) return false;

      // Has mapping filter
      if (filters.hasMapping === "yes" && !p.mapped_product_id) return false;
      if (filters.hasMapping === "no" && p.mapped_product_id) return false;

      // Has receipt filter
      if (filters.hasReceipt === "yes" && !p.receipt_url) return false;
      if (filters.hasReceipt === "no" && p.receipt_url) return false;

      // Has refunds filter
      if (filters.hasRefunds === "yes" && (!p.refunds_count || p.refunds_count === 0)) return false;
      if (filters.hasRefunds === "no" && p.refunds_count && p.refunds_count > 0) return false;

      // Is external filter
      if (filters.isExternal === "yes" && !p.is_external) return false;
      if (filters.isExternal === "no" && p.is_external) return false;

      // Is ghost filter
      if (filters.isGhost === "yes" && !p.is_ghost) return false;
      if (filters.isGhost === "no" && p.is_ghost) return false;

      // Has conflict filter
      if (filters.hasConflict === "yes" && !p.has_conflict) return false;
      if (filters.hasConflict === "no" && p.has_conflict) return false;

      // Source filter
      if (filters.source !== "all" && p.source !== filters.source) return false;

      return true;
    });
  }, [payments, filters, statsFilter]);

  // Open sync dialog
  const handleBepaidSync = () => {
    setSyncDialogOpen(true);
  };

  // Export to CSV
  const handleExport = () => {
    const csv = [
      ["UID", "Дата", "Тип", "Статус", "Сумма", "Валюта", "Email", "Телефон", "Карта", "Владелец", "Заказ", "Продукт", "Контакт", "Источник", "Чек", "Возвраты"].join(";"),
      ...filteredPayments.map(p => [
        p.uid,
        p.paid_at ? format(new Date(p.paid_at), "dd.MM.yyyy HH:mm") : "",
        p.transaction_type || "",
        p.status_normalized || "",
        p.amount,
        p.currency,
        p.customer_email || "",
        p.customer_phone || "",
        p.card_last4 ? `*${p.card_last4}` : "",
        p.card_holder || "",
        p.order_number || "",
        p.product_name || "",
        p.profile_name || "",
        p.source,
        p.receipt_url ? "Да" : "Нет",
        p.refunds_count || 0,
      ].join(";"))
    ].join("\n");

    // Add metadata header
    const metadata = [
      `# Export Date: ${new Date().toISOString()}`,
      `# Period: ${dateFilter.from} - ${dateFilter.to}`,
      `# Filters: ${JSON.stringify(filters)}`,
      '',
    ].join('\n');

    const blob = new Blob(["\uFEFF" + metadata + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payments-${format(new Date(), "yyyy-MM-dd-HHmm")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV экспортирован");
  };

  // Toggle selection
  const toggleSelectAll = () => {
    if (selectedItems.size === filteredPayments.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredPayments.map(p => p.id)));
    }
  };

  const toggleItem = (id: string) => {
    const newSet = new Set(selectedItems);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedItems(newSet);
  };

  // Reset filters
  const resetFilters = () => {
    setFilters(defaultFilters);
    setStatsFilter(null);
  };

  const activeFiltersCount = Object.entries(filters).filter(
    ([key, value]) => key !== 'search' && value !== 'all' && value !== '' && value !== defaultFilters[key as keyof PaymentFilters]
  ).length + (statsFilter ? 1 : 0);

  // Get visible columns for settings
  const visibleColumns = columns.filter(c => c.key !== 'checkbox' && c.key !== 'actions');

  return (
    <div className="space-y-3">
      {/* 1. Stats Panel - PATCH-2: uses filteredPayments for unified source */}
      <div className="pt-1">
        <PaymentsStatsPanel 
          dateRange={dateFilter}
          isTableLoading={isLoading}
          activeFilter={statsFilter}
          onFilterChange={setStatsFilter}
        />
      </div>
      
      {/* 2. Строка периода + счётчик + лимит - PATCH-5 */}
      <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground py-1">
        <span>{dateFilter.from} — {dateFilter.to || 'сегодня'}</span>
        <span>•</span>
        <span>Показано: {Math.min(pageSize, filteredPayments.length)} из {filteredPayments.length} транзакций</span>
        <Select value={pageSize.toString()} onValueChange={(v) => setPageSize(parseInt(v, 10))}>
          <SelectTrigger className="h-6 w-[80px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="20">20</SelectItem>
            <SelectItem value="50">50</SelectItem>
            <SelectItem value="100">100</SelectItem>
            <SelectItem value="500">500</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      {/* 3. Quick Filters Row - единая строка */}
      <div className="flex flex-wrap items-center gap-2 px-1">
        {/* Period selector */}
        <DatePeriodSelector value={dateFilter} onChange={setDateFilter} />
        
        {/* Pill-style status tabs - PATCH-C3: Added processing tab */}
        <div className="inline-flex p-0.5 rounded-full bg-muted/40 backdrop-blur-md border border-border/20">
          {[
            { id: "all", label: "Все" },
            { id: "successful_and_refunds", label: "Успешные" },
            { id: "processing", label: "В обработке" },
            { id: "failed", label: "Ошибки" },
          ].map((tab) => {
            const isActive = filters.status === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setFilters(prev => ({ ...prev, status: tab.id }));
                  setStatsFilter(null); // Clear stats filter when using pill tabs
                }}
                className={`relative flex items-center gap-1.5 px-3 h-8 rounded-full text-xs transition-all duration-200 whitespace-nowrap ${
                  isActive
                    ? "bg-background text-foreground shadow-sm font-semibold"
                    : "text-muted-foreground hover:text-foreground font-medium"
                }`}
              >
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
        
        {/* Timezone selector */}
        <TimezoneSelector 
          value={selectedTimezone} 
          onValueChange={handleTimezoneChange} 
        />
        
        {/* Sync dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 px-3 text-xs font-medium">
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sync</span>
              <ChevronDown className="h-3 w-3 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Синхронизация с bePaid
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleBepaidSync} className="gap-3 p-3 cursor-pointer">
              <div className="p-1.5 rounded-lg bg-primary/10">
                <RefreshCw className="h-4 w-4 text-primary" />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-sm">Синхронизировать с API</span>
                <span className="text-xs text-muted-foreground">
                  Получить новые транзакции
                </span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSyncStatementDialogOpen(true)} className="gap-3 p-3 cursor-pointer">
              <div className="p-1.5 rounded-lg bg-emerald-500/10">
                <FileSpreadsheet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-sm">Синхронизировать с Выпиской</span>
                <span className="text-xs text-muted-foreground">
                  Сверить с загруженной выпиской
                </span>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        
        <div className="flex-1 min-w-0" />
        
        {/* Settings gear - справа */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Settings className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={handleExport} disabled={filteredPayments.length === 0}>
              <Download className="h-4 w-4 mr-2" />
              Экспорт CSV
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Колонки
            </DropdownMenuLabel>
            {visibleColumns.map((col) => (
              <DropdownMenuCheckboxItem
                key={col.key}
                checked={col.visible}
                onCheckedChange={(checked) => {
                  setColumns(prev => prev.map(c => 
                    c.key === col.key ? { ...c, visible: checked } : c
                  ));
                }}
              >
                {col.label}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={resetColumns} className="text-xs text-muted-foreground">
              Сбросить колонки
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      
      {/* 4. Search row + Filters button */}
      <div className="flex items-center gap-2 px-1">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по UID, email, телефону, карте..."
            value={filters.search}
            onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
            className="pl-10 h-9 text-sm"
          />
        </div>
        
        <Button 
          variant={showFilters ? "secondary" : "outline"} 
          size="sm"
          onClick={() => setShowFilters(!showFilters)}
          className="h-8 gap-1.5 px-3 text-xs font-medium"
        >
          <Filter className="h-3.5 w-3.5" />
          Фильтры
          {activeFiltersCount > 0 && (
            <Badge variant="secondary" className="ml-1 h-5 px-1.5">{activeFiltersCount}</Badge>
          )}
        </Button>
        
        {activeFiltersCount > 0 && (
          <Button variant="ghost" size="sm" onClick={resetFilters} className="h-8 px-3 text-xs font-medium">
            <X className="h-3.5 w-3.5 mr-1" />
            Сбросить
          </Button>
        )}
      </div>
      
      {/* Filters panel */}
      {showFilters && (
        <div className="px-1">
          <PaymentsFilters filters={filters} setFilters={setFilters} />
        </div>
      )}
      
      {/* Batch actions */}
      {selectedItems.size > 0 && (
        <div className="px-1">
          <PaymentsBatchActions
            selectedPayments={filteredPayments.filter(p => selectedItems.has(p.id))}
            onSuccess={() => {
              setSelectedItems(new Set());
              refetch();
            }}
            onClearSelection={() => setSelectedItems(new Set())}
          />
        </div>
      )}
      
      {/* 5. Table - PATCH-5: limited by pageSize */}
      <div className="overflow-x-auto">
        <PaymentsTable
          payments={filteredPayments.slice(0, pageSize)}
          isLoading={isLoading}
          selectedItems={selectedItems}
          onToggleSelectAll={toggleSelectAll}
          onToggleItem={toggleItem}
          onRefetch={refetch}
          displayTimezone="user"
          selectedTimezoneIANA={selectedTimezone}
          columns={columns}
          onColumnsChange={setColumns}
        />
      </div>
      
      {/* Load more button - PATCH-5 */}
      {filteredPayments.length > pageSize && (
        <div className="flex justify-center">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setPageSize(prev => Math.min(prev + 50, filteredPayments.length))}
          >
            Показать ещё ({filteredPayments.length - pageSize} осталось)
          </Button>
        </div>
      )}
      
      {/* Sync dialog - API */}
      <SyncRunDialog 
        open={syncDialogOpen}
        onOpenChange={setSyncDialogOpen}
        onComplete={refetch}
      />
      
      {/* Sync dialog - Statement */}
      <SyncWithStatementDialog
        open={syncStatementDialogOpen}
        onOpenChange={setSyncStatementDialogOpen}
        onComplete={refetch}
        defaultFromDate={dateFilter.from}
        defaultToDate={dateFilter.to}
      />
    </div>
  );
}
