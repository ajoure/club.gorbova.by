import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { 
  Download, Upload, ArrowLeft, Search, Filter, X, RefreshCw
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { useUnifiedPayments, UnifiedPayment, DateFilter } from "@/hooks/useUnifiedPayments";
import { AdminLayout } from "@/components/layout/AdminLayout";
import SmartImportDialog from "@/components/admin/bepaid/SmartImportDialog";
import PaymentsTable from "@/components/admin/payments/PaymentsTable";
import PaymentsFilters from "@/components/admin/payments/PaymentsFilters";
import PaymentsBatchActions from "@/components/admin/payments/PaymentsBatchActions";
import DatePeriodSelector from "@/components/admin/payments/DatePeriodSelector";
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

export default function AdminPayments() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  // Date filter - default to current month
  const now = new Date();
  const [dateFilter, setDateFilter] = useState<DateFilter>({
    from: format(startOfMonth(now), 'yyyy-MM-dd'),
    to: format(endOfMonth(now), 'yyyy-MM-dd'),
  });
  
  // Filters
  const [filters, setFilters] = useState<PaymentFilters>(defaultFilters);
  const [showFilters, setShowFilters] = useState(false);
  
  // Selection for batch operations
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  
  // Import dialog
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  
  // Sync dialog
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  
  // Fetch unified payment data - always include imports
  const effectiveDateFilter = useMemo(() => ({
    ...dateFilter,
    includeImport: true,
  }), [dateFilter]);
  
  const { 
    payments, 
    isLoading, 
    stats, 
    refetch 
  } = useUnifiedPayments(effectiveDateFilter);

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
      <div className="container mx-auto p-4 space-y-4">
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
          <div className="flex-1 min-w-0" />
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8" onClick={handleBepaidSync}>
              <RefreshCw className="h-3.5 w-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">Sync</span>
            </Button>
            <Button size="sm" className="h-8" onClick={() => setImportDialogOpen(true)}>
              <Upload className="h-3.5 w-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">Импорт</span>
            </Button>
          </div>
        </div>
        
        {/* Main content */}
        <Card>
          <CardHeader className="pb-4">
            {/* Responsive header: stacked on mobile */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Транзакции</CardTitle>
                <CardDescription>
                  {filteredPayments.length} из {payments.length} транзакций
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
        
        {/* Sync dialog */}
        <SyncRunDialog 
          open={syncDialogOpen}
          onOpenChange={setSyncDialogOpen}
          onComplete={refetch}
        />
      </div>
    </AdminLayout>
  );
}
