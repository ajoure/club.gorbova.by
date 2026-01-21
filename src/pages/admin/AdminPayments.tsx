import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Download, Upload, ArrowLeft, Search, Filter, X, RefreshCw, Loader2, Shield
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useUnifiedPayments, UnifiedPayment, DateFilter } from "@/hooks/useUnifiedPayments";
import { AdminLayout } from "@/components/layout/AdminLayout";
import SmartImportDialog from "@/components/admin/bepaid/SmartImportDialog";
import PaymentsTable from "@/components/admin/payments/PaymentsTable";
import PaymentsFilters from "@/components/admin/payments/PaymentsFilters";
import PaymentsBatchActions from "@/components/admin/payments/PaymentsBatchActions";
import UnifiedPaymentsDashboard, { UnifiedDashboardFilter } from "@/components/admin/payments/UnifiedPaymentsDashboard";
import DatePeriodSelector from "@/components/admin/payments/DatePeriodSelector";
import PaymentsSettingsDropdown from "@/components/admin/payments/PaymentsSettingsDropdown";
import PaymentSecurityTab from "@/components/admin/payments/PaymentSecurityTab";
import UnlinkedPaymentsReport from "@/components/admin/payments/UnlinkedPaymentsReport";
import BepaidFullSyncDialog from "@/components/admin/payments/BepaidFullSyncDialog";
import AutolinkAllCardsButton from "@/components/admin/payments/AutolinkAllCardsButton";
import SyncRunDialog from "@/components/admin/payments/SyncRunDialog";

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
  status: "successful_and_refunds", // Default: show successful + refunds
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

export default function AdminPayments() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"payments" | "unlinked" | "security">("payments");
  
  // Date filter - default to current month
  const now = new Date();
  const [dateFilter, setDateFilter] = useState<DateFilter>({
    from: format(startOfMonth(now), 'yyyy-MM-dd'),
    to: format(endOfMonth(now), 'yyyy-MM-dd'),
  });
  
  // Filters
  const [filters, setFilters] = useState<PaymentFilters>(defaultFilters);
  const [showFilters, setShowFilters] = useState(false);
  
  // Dashboard filter (clickable cards) - unified with analytics
  const [dashboardFilter, setDashboardFilter] = useState<UnifiedDashboardFilter>(null);
  
  // Selection for batch operations
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  
  // Import dialog
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  
  // Full sync dialog (old)
  const [fullSyncDialogOpen, setFullSyncDialogOpen] = useState(false);
  
  // New unified sync dialog
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  
  // Refresh from API state
  const [isRefreshingFromApi, setIsRefreshingFromApi] = useState(false);
  
  // Fetch unified payment data
  const { 
    payments, 
    isLoading, 
    stats, 
    refetch 
  } = useUnifiedPayments(dateFilter);

  // Apply filters to payments (including dashboard + analytics filters)
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
      return v; // fallback
    };
    
    // Helper to check if transaction is a cancellation/void by type
    const isCancelledTransaction = (p: UnifiedPayment) => {
      const txType = normalizeType(p.transaction_type);
      return txType === 'void';
    };

    return payments.filter(p => {
      // Unified dashboard filter (from clickable cards)
      if (dashboardFilter) {
        const failedStatuses = ['failed', 'expired', 'declined', 'error', 'incomplete'];
        switch (dashboardFilter) {
          case 'successful': {
            // Successful = successful status AND NOT a cancellation/void
            const isSuccess = ['successful', 'succeeded'].includes(p.status_normalized);
            const isCancel = isCancelledTransaction(p);
            if (!isSuccess || isCancel) return false;
            break;
          }
          case 'refunded': {
            const isRefundTx = normalizeType(p.transaction_type) === 'refund';
            const isNegativeAmount = p.amount < 0;
            const hasRefundedStatus = ['refunded', 'refund'].includes(p.status_normalized);
            if (!isRefundTx && !isNegativeAmount && !hasRefundedStatus && p.total_refunded <= 0) return false;
            break;
          }
          case 'cancelled': {
            // Cancelled = by transaction_type, not status
            if (!isCancelledTransaction(p)) return false;
            break;
          }
          case 'failed': {
            // Failed = failed status, but NOT cancellations
            const isCancel = isCancelledTransaction(p);
            if (!failedStatuses.includes(p.status_normalized) || isCancel) return false;
            break;
          }
        }
      }

      // Search filter - include linked profile data
      if (filters.search) {
        const search = filters.search.toLowerCase();
        const matchSearch = 
          p.uid?.toLowerCase().includes(search) ||
          p.customer_email?.toLowerCase().includes(search) ||
          p.customer_phone?.toLowerCase().includes(search) ||
          p.card_holder?.toLowerCase().includes(search) ||
          p.card_last4?.includes(search) ||
          p.order_number?.toLowerCase().includes(search) ||
          // Also search by linked profile data
          p.profile_name?.toLowerCase().includes(search) ||
          p.profile_email?.toLowerCase().includes(search) ||
          p.profile_phone?.toLowerCase().includes(search);
        if (!matchSearch) return false;
      }

      // Status filter with combo option for successful + refunds
      if (filters.status !== "all") {
        if (filters.status === "successful_and_refunds") {
          // Show successful payments AND refund transactions (by status, type, or negative amount)
          const isSuccessful = ['successful', 'succeeded'].includes(p.status_normalized);
          const isRefundStatus = ['refund', 'refunded'].includes(p.status_normalized);
          const isRefundType = normalizeType(p.transaction_type) === 'refund';
          const isNegativeAmount = p.amount < 0; // Negative amount = refund
          if (!isSuccessful && !isRefundStatus && !isRefundType && !isNegativeAmount) return false;
        } else if (filters.status === "cancelled") {
          // Show cancelled by transaction_type (not status!)
          if (!isCancelledTransaction(p)) return false;
        } else if (filters.status === "failed") {
          // Show all failed statuses (failed, declined, expired, error) - NOT cancellations
          const failedStatuses = ['failed', 'declined', 'expired', 'error', 'incomplete'];
          const isCancel = isCancelledTransaction(p);
          if (!failedStatuses.includes(p.status_normalized) || isCancel) return false;
        } else if (filters.status !== p.status_normalized) {
          return false;
        }
      }

      // Type filter (normalize english/russian variants)
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
  }, [payments, filters, dashboardFilter]);

  // Refresh from bePaid API
  const handleRefreshFromApi = async () => {
    setIsRefreshingFromApi(true);
    try {
      const { data, error } = await supabase.functions.invoke('bepaid-fetch-transactions');
      if (error) throw error;
      
      const result = data as { 
        transactions_fetched?: number; 
        queued_for_review?: number;
        new_payments?: number;
        error?: string;
      };
      
      if (result.error) {
        toast.error(`Ошибка: ${result.error}`);
      } else {
        toast.success(
          `Загружено ${result.transactions_fetched || 0} транзакций, ` +
          `${result.queued_for_review || 0} в очередь`
        );
        refetch();
      }
    } catch (e: any) {
      console.error('Error refreshing from bePaid:', e);
      toast.error('Ошибка обновления: ' + (e.message || 'Неизвестная ошибка'));
    } finally {
      setIsRefreshingFromApi(false);
    }
  };
  
  // Open new unified sync dialog
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

    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
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
  };

  const activeFiltersCount = Object.entries(filters).filter(
    ([key, value]) => key !== 'search' && value !== 'all' && value !== ''
  ).length;

  return (
    <AdminLayout>
      <div className="container mx-auto p-4 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Платежи</h1>
              <p className="text-muted-foreground">
                Все транзакции bePaid в единой таблице
              </p>
            </div>
          </div>
          
        </div>

        {/* Glassmorphism Tabs */}
        <div className="p-1.5 rounded-2xl bg-background/40 backdrop-blur-xl border border-border/30 shadow-lg">
          <div className="w-full grid grid-cols-3 gap-1 bg-transparent p-0 h-auto">
            <button 
              onClick={() => setActiveTab("payments")}
              className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-medium transition-all ${
                activeTab === "payments" 
                  ? "bg-background/80 shadow-md text-foreground" 
                  : "text-muted-foreground hover:bg-background/40"
              }`}
            >
              Транзакции
            </button>
            <button 
              onClick={() => setActiveTab("unlinked")}
              className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-medium transition-all ${
                activeTab === "unlinked" 
                  ? "bg-background/80 shadow-md text-foreground" 
                  : "text-muted-foreground hover:bg-background/40"
              }`}
            >
              Непривязанные
            </button>
            <button 
              onClick={() => setActiveTab("security")}
              className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-medium transition-all ${
                activeTab === "security" 
                  ? "bg-background/80 shadow-md text-foreground" 
                  : "text-muted-foreground hover:bg-background/40"
              }`}
            >
              <Shield className="h-4 w-4" />
              Безопасность
            </button>
          </div>
        </div>
        
        {/* Toolbar - only for payments tab */}
        {activeTab === "payments" && (
          <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-background/30 backdrop-blur-sm border border-border/20">
            <DatePeriodSelector value={dateFilter} onChange={setDateFilter} />
            <div className="flex-1" />
            <Button variant="outline" onClick={handleBepaidSync} className="gap-2 h-9 bg-background/60">
              <RefreshCw className="h-4 w-4" />
              <span className="hidden sm:inline">Синхронизировать</span>
            </Button>
            <Button onClick={() => setImportDialogOpen(true)} className="gap-2 h-9">
              <Upload className="h-4 w-4" />
              <span className="hidden sm:inline">Импорт</span>
            </Button>
            <AutolinkAllCardsButton />
            <PaymentsSettingsDropdown 
              selectedIds={selectedItems.size > 0 ? Array.from(selectedItems) : undefined}
              onRefreshFromApi={handleRefreshFromApi}
              isRefreshingFromApi={isRefreshingFromApi}
              onComplete={refetch}
            />
          </div>
        )}
        
        {/* Tab Content */}
        {activeTab === "security" ? (
          <PaymentSecurityTab />
        ) : activeTab === "unlinked" ? (
          <UnlinkedPaymentsReport onComplete={refetch} />
        ) : (
          <>
            {/* Unified Financial Dashboard */}
            <UnifiedPaymentsDashboard 
              payments={payments} 
              isLoading={isLoading} 
              activeFilter={dashboardFilter}
              onFilterChange={setDashboardFilter}
              dateFilter={dateFilter}
            />

            {/* Main content */}
            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div>
                    <CardTitle>Транзакции</CardTitle>
                    <CardDescription>
                      {filteredPayments.length} из {payments.length} транзакций
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Search */}
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Поиск по UID, email, телефону, карте, заказу..."
                        value={filters.search}
                        onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                        className="pl-10 w-80"
                      />
                    </div>
                    
                    {/* Filter toggle */}
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
                    
                    {/* Reset filters */}
                    {activeFiltersCount > 0 && (
                      <Button variant="ghost" size="sm" onClick={resetFilters}>
                        <X className="h-4 w-4 mr-1" />
                        Сбросить
                      </Button>
                    )}
                    
                    {/* Export */}
                    <Button variant="outline" onClick={handleExport} disabled={filteredPayments.length === 0}>
                      <Download className="h-4 w-4 mr-2" />
                      CSV
                    </Button>
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
                
                {/* Table */}
                <PaymentsTable
                  payments={filteredPayments}
                  isLoading={isLoading}
                  selectedItems={selectedItems}
                  onToggleSelectAll={toggleSelectAll}
                  onToggleItem={toggleItem}
                  onRefetch={refetch}
                />
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
            
            {/* Full Sync dialog */}
            {/* New unified sync dialog */}
            <SyncRunDialog 
              open={syncDialogOpen}
              onOpenChange={setSyncDialogOpen}
              onComplete={refetch}
            />
            
            {/* Legacy full sync dialog (kept for fallback) */}
            <BepaidFullSyncDialog
              open={fullSyncDialogOpen}
              onOpenChange={setFullSyncDialogOpen}
              onComplete={refetch}
              defaultFromDate="2026-01-01"
            />
          </>
        )}
      </div>
    </AdminLayout>
  );
}
