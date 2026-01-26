import { useState, useMemo, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  Download, Upload, Search, Filter, X, RefreshCw, Bug, Info, Layers, ChevronDown, FileSpreadsheet
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { useUnifiedPayments, UnifiedPayment, DateFilter } from "@/hooks/useUnifiedPayments";
import PaymentsStatsPanel from "./PaymentsStatsPanel";
import SmartImportDialog from "@/components/admin/bepaid/SmartImportDialog";
import PaymentsTable from "@/components/admin/payments/PaymentsTable";
import PaymentsFilters from "@/components/admin/payments/PaymentsFilters";
import PaymentsBatchActions from "@/components/admin/payments/PaymentsBatchActions";
import DatePeriodSelector from "@/components/admin/payments/DatePeriodSelector";
import SyncRunDialog from "@/components/admin/payments/SyncRunDialog";
import SyncWithStatementDialog from "@/components/admin/payments/SyncWithStatementDialog";
import { TimezoneSelector, usePersistedTimezone } from "./TimezoneSelector";
import AdminToolsMenu from "./AdminToolsMenu";
import DataTraceModal from "./DataTraceModal";
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
  status: "successful_and_refunds",
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

export function PaymentsTabContent() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { role } = useAuth();
  
  // Check if user is superadmin
  const isSuperadmin = role === 'superadmin' || role === 'admin';
  
  // Date filter - default to current month
  const now = new Date();
  const [dateFilter, setDateFilter] = useState<DateFilter>({
    from: format(startOfMonth(now), 'yyyy-MM-dd'),
    to: format(endOfMonth(now), 'yyyy-MM-dd'),
  });
  
  // Data source mode: 'canon' = payments_v2 only, 'unified' = payments_v2 + queue
  const [sourceMode, setSourceMode] = useState<'canon' | 'unified'>('unified');
  
  // Filters
  const [filters, setFilters] = useState<PaymentFilters>(defaultFilters);
  const [showFilters, setShowFilters] = useState(false);
  
  // Selection for batch operations
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  
  // Import dialog
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  
  // Sync dialogs
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncStatementDialogOpen, setSyncStatementDialogOpen] = useState(false);
  
  // Trace modal (superadmin only)
  const [traceModalOpen, setTraceModalOpen] = useState(false);
  
  // Timezone - IANA timezone with persistence
  const { getInitialValue, setTimezone: persistTimezone } = usePersistedTimezone();
  const [selectedTimezone, setSelectedTimezone] = useState(getInitialValue);
  
  // Persist timezone changes
  const handleTimezoneChange = (tz: string) => {
    setSelectedTimezone(tz);
    persistTimezone(tz);
  };
  
  // Fetch unified payment data - always include imports
  const effectiveDateFilter = useMemo(() => ({
    ...dateFilter,
    includeImport: true,
    mode: sourceMode, // Pass mode to hook
  }), [dateFilter, sourceMode]);
  
  const { 
    payments: allPayments, 
    isLoading, 
    stats, 
    refetch 
  } = useUnifiedPayments(effectiveDateFilter);

  // Filter payments by source mode
  const payments = useMemo(() => {
    if (sourceMode === 'canon') {
      return allPayments.filter(p => p.rawSource === 'payments_v2');
    }
    return allPayments;
  }, [allPayments, sourceMode]);

  // Apply filters to payments
  const filteredPayments = useMemo(() => {
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

    return payments.filter(p => {
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

      // Status filter
      if (filters.status !== "all") {
        if (filters.status === "successful_and_refunds") {
          const isSuccessful = ['successful', 'succeeded'].includes(p.status_normalized);
          const isRefundStatus = ['refund', 'refunded'].includes(p.status_normalized);
          const isRefundType = normalizeType(p.transaction_type) === 'refund';
          const isNegativeAmount = p.amount < 0;
          if (!isSuccessful && !isRefundStatus && !isRefundType && !isNegativeAmount) return false;
        } else if (filters.status === "cancelled") {
          if (!isCancelledTransaction(p)) return false;
        } else if (filters.status === "failed") {
          const failedStatuses = ['failed', 'declined', 'expired', 'error', 'incomplete'];
          const isCancel = isCancelledTransaction(p);
          if (!failedStatuses.includes(p.status_normalized) || isCancel) return false;
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
  }, [payments, filters]);

  // Open sync dialog
  const handleBepaidSync = () => {
    setSyncDialogOpen(true);
  };

  // Export to CSV
  const handleExport = () => {
    const csv = [
      ["UID", "Дата", "Тип", "Статус", "Сумма", "Валюта", "Email", "Телефон", "Карта", "Владелец", "Заказ", "Продукт", "Контакт", "Источник", "Чек", "Возвраты", "RawSource"].join(";"),
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
        p.rawSource,
      ].join(";"))
    ].join("\n");

    // Add metadata header
    const metadata = [
      `# Export Date: ${new Date().toISOString()}`,
      `# Mode: ${sourceMode}`,
      `# Period: ${dateFilter.from} - ${dateFilter.to}`,
      `# Filters: ${JSON.stringify(filters)}`,
      '',
    ].join('\n');

    const blob = new Blob(["\uFEFF" + metadata + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payments-${sourceMode}-${format(new Date(), "yyyy-MM-dd-HHmm")}.csv`;
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
  };

  const activeFiltersCount = Object.entries(filters).filter(
    ([key, value]) => key !== 'search' && value !== 'all' && value !== ''
  ).length;

  // Stats for current mode
  const canonCount = allPayments.filter(p => p.rawSource === 'payments_v2').length;
  const queueOnlyCount = allPayments.filter(p => p.rawSource === 'queue').length;

  return (
    <div className="space-y-4">
      {/* Pill-style Tabs for status */}
      <div className="px-1 pt-1 pb-1.5 shrink-0">
        <div className="inline-flex p-0.5 rounded-full bg-muted/40 backdrop-blur-md border border-border/20 overflow-x-auto max-w-full scrollbar-none">
          {[
            { id: "successful_and_refunds", label: "Успешные" },
            { id: "all", label: "Все" },
            { id: "failed", label: "Ошибки" },
          ].map((tab) => {
            const isActive = filters.status === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setFilters(prev => ({ ...prev, status: tab.id }))}
                className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 whitespace-nowrap ${
                  isActive
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-background/30 backdrop-blur-sm border border-border/20">
        <DatePeriodSelector value={dateFilter} onChange={setDateFilter} />
        
        {/* Source mode toggle (superadmin only) */}
        {isSuperadmin && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700/50">
            <Layers className="h-3.5 w-3.5 text-slate-400" />
            <Label htmlFor="staging-toggle" className="text-xs text-slate-400 cursor-pointer">
              Staging
            </Label>
            <Switch
              id="staging-toggle"
              checked={sourceMode === 'unified'}
              onCheckedChange={(checked) => setSourceMode(checked ? 'unified' : 'canon')}
              className="scale-75"
            />
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${sourceMode === 'unified' ? 'border-amber-500/50 text-amber-400' : 'border-emerald-500/50 text-emerald-400'}`}>
              {sourceMode === 'unified' ? 'Unified' : 'Canon'}
            </Badge>
          </div>
        )}
        
        <div className="flex-1 min-w-0" />
        <div className="flex items-center gap-2">
          {/* Trace button (superadmin only) */}
          {isSuperadmin && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setTraceModalOpen(true)}>
                    <Bug className="h-4 w-4 text-purple-400" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Data Trace — источники данных</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1">
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
          <Button size="sm" className="h-8" onClick={() => setImportDialogOpen(true)}>
            <Upload className="h-3.5 w-3.5 sm:mr-1.5" />
            <span className="hidden sm:inline">Импорт</span>
          </Button>
          <AdminToolsMenu 
            onRefetch={refetch} 
            dateFrom={dateFilter.from}
            dateTo={dateFilter.to}
          />
        </div>
      </div>

      {/* Stats Panel - pass ALL payments for period, not filtered */}
      <PaymentsStatsPanel 
        payments={payments} 
        isLoading={isLoading}
        dateRange={dateFilter}
      />
      
      {/* Main content */}
      <Card>
        <CardHeader className="pb-4">
          {/* Responsive header: stacked on mobile */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Транзакции</CardTitle>
              <CardDescription className="flex items-center gap-2">
                <span>{filteredPayments.length} из {payments.length} транзакций</span>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3 w-3 text-slate-500 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <div className="text-xs space-y-1">
                        <div>Mode: <span className="font-mono text-purple-300">{sourceMode}</span></div>
                        <div>payments_v2: <span className="font-mono">{canonCount}</span></div>
                        <div>queue_only: <span className="font-mono">{queueOnlyCount}</span></div>
                        <div>Period: {dateFilter.from} — {dateFilter.to}</div>
                        <div className="text-slate-400 pt-1">
                          <button 
                            onClick={() => setTraceModalOpen(true)}
                            className="text-purple-400 hover:underline"
                          >
                            Открыть Trace →
                          </button>
                        </div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                {sourceMode === 'unified' && queueOnlyCount > 0 && (
                  <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-400">
                    +{queueOnlyCount} queue
                  </Badge>
                )}
              </CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {/* Search - full width on mobile */}
              <div className="relative w-full sm:w-80">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Поиск..."
                  value={filters.search}
                  onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                  className="pl-10 w-full"
                />
              </div>
              
              {/* Filter buttons */}
              <div className="flex items-center gap-2 flex-wrap">
                <Button 
                  variant={showFilters ? "secondary" : "outline"} 
                  onClick={() => setShowFilters(!showFilters)}
                  className="gap-2"
                >
                  <Filter className="h-4 w-4" />
                  Фильтры
                  {activeFiltersCount > 0 && (
                    <Badge variant="secondary" className="ml-1">{activeFiltersCount}</Badge>
                  )}
                </Button>
                
                {activeFiltersCount > 0 && (
                  <Button variant="ghost" size="sm" onClick={resetFilters}>
                    <X className="h-4 w-4 mr-1" />
                    Сбросить
                  </Button>
                )}
                
                <Button variant="outline" onClick={handleExport} disabled={filteredPayments.length === 0}>
                  <Download className="h-4 w-4 mr-2" />
                  CSV
                </Button>
                
                {/* Timezone selector - IANA timezones */}
                <TimezoneSelector 
                  value={selectedTimezone} 
                  onValueChange={handleTimezoneChange} 
                />
              </div>
            </div>
          </div>
          
          {/* Filters panel */}
          {showFilters && (
            <PaymentsFilters filters={filters} setFilters={setFilters} />
          )}
        </CardHeader>
        
        <CardContent>
          {/* Batch actions */}
          {selectedItems.size > 0 && (
            <PaymentsBatchActions
              selectedPayments={filteredPayments.filter(p => selectedItems.has(p.id))}
              onSuccess={() => {
                setSelectedItems(new Set());
                refetch();
              }}
              onClearSelection={() => setSelectedItems(new Set())}
            />
          )}
          
          {/* Table with horizontal scroll */}
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <PaymentsTable
              payments={filteredPayments}
              isLoading={isLoading}
              selectedItems={selectedItems}
              onToggleSelectAll={toggleSelectAll}
              onToggleItem={toggleItem}
              onRefetch={refetch}
              displayTimezone="user"
              selectedTimezoneIANA={selectedTimezone}
            />
          </div>
        </CardContent>
      </Card>
      
      {/* Import dialog */}
      <SmartImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onSuccess={() => {
          refetch();
          setImportDialogOpen(false);
        }}
      />
      
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
      
      {/* Trace modal (superadmin only) */}
      {isSuperadmin && (
        <DataTraceModal
          open={traceModalOpen}
          onOpenChange={setTraceModalOpen}
          dateFrom={dateFilter.from}
          dateTo={dateFilter.to || dateFilter.from}
          uiRowsShown={filteredPayments.length}
          activeFilters={filters}
          mode={sourceMode}
        />
      )}
    </div>
  );
}
