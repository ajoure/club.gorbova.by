import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  RefreshCw, Download, CreditCard, Mail, 
  AlertCircle, Clock, Database, Phone, Package, AlertTriangle, Link2, Calendar, 
  Upload, ArrowLeft, ExternalLink, FileText, RotateCcw, Search, Filter, X
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useUnifiedPayments, UnifiedPayment, DateFilter } from "@/hooks/useUnifiedPayments";
import { AdminLayout } from "@/components/layout/AdminLayout";
import BepaidImportDialog from "@/components/admin/bepaid/BepaidImportDialog";
import PaymentsTable from "@/components/admin/payments/PaymentsTable";
import PaymentsFilters from "@/components/admin/payments/PaymentsFilters";
import PaymentsBatchActions from "@/components/admin/payments/PaymentsBatchActions";
import PaymentsDashboard, { DashboardFilter } from "@/components/admin/payments/PaymentsDashboard";
import PaymentsAnalytics from "@/components/admin/payments/PaymentsAnalytics";
import RecoverPaymentDialog from "@/components/admin/payments/RecoverPaymentDialog";

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
  status: "all",
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
  
  // Date filter - default from start of year
  const [dateFilter, setDateFilter] = useState<DateFilter>({
    from: "2026-01-01",
    to: undefined,
  });
  
  // Filters
  const [filters, setFilters] = useState<PaymentFilters>(defaultFilters);
  const [showFilters, setShowFilters] = useState(false);
  
  // Dashboard filter (clickable cards)
  const [dashboardFilter, setDashboardFilter] = useState<DashboardFilter | null>(null);
  
  // Selection for batch operations
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  
  // Import dialog
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  
  // Refresh from API state
  const [isRefreshingFromApi, setIsRefreshingFromApi] = useState(false);
  
  // Fetch unified payment data
  const { 
    payments, 
    isLoading, 
    stats, 
    refetch 
  } = useUnifiedPayments(dateFilter);

  // Apply filters to payments (including dashboard filter)
  const filteredPayments = useMemo(() => {
    return payments.filter(p => {
      // Dashboard filter (from clickable cards)
      if (dashboardFilter) {
        switch (dashboardFilter) {
          case 'successful':
            if (!['successful', 'succeeded'].includes(p.status_normalized)) return false;
            break;
          case 'pending':
            if (p.status_normalized !== 'pending') return false;
            break;
          case 'failed':
            if (p.status_normalized !== 'failed') return false;
            break;
          case 'withDeal':
            if (!p.order_id) return false;
            break;
          case 'attention':
            if (!p.is_external && !p.has_conflict) return false;
            break;
          // 'all' - no filter
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
          p.order_number?.toLowerCase().includes(search);
        if (!matchSearch) return false;
      }
      
      // Status filter
      if (filters.status !== "all" && p.status_normalized !== filters.status) return false;
      
      // Type filter
      if (filters.type !== "all" && p.transaction_type !== filters.type) return false;
      
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
          <div className="flex items-center gap-4 flex-wrap">
            {/* Recover payment button */}
            <RecoverPaymentDialog onRecovered={refetch} />
            
            {/* Refresh from API */}
            <Button 
              variant="outline" 
              onClick={handleRefreshFromApi} 
              disabled={isRefreshingFromApi}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshingFromApi ? 'animate-spin' : ''}`} />
              Обновить из bePaid
            </Button>
            
            {/* Import button */}
            <Button onClick={() => setImportDialogOpen(true)} className="gap-2">
              <Upload className="h-4 w-4" />
              Импорт CSV
            </Button>
            
            {/* Date filter */}
            <div className="flex items-center gap-2 bg-muted/50 p-2 rounded-lg">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <div className="flex items-center gap-2">
                <Label htmlFor="date-from" className="text-sm text-muted-foreground whitespace-nowrap">С:</Label>
                <Input
                  id="date-from"
                  type="date"
                  value={dateFilter.from}
                  onChange={(e) => setDateFilter(prev => ({ ...prev, from: e.target.value }))}
                  className="h-8 w-36"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="date-to" className="text-sm text-muted-foreground whitespace-nowrap">По:</Label>
                <Input
                  id="date-to"
                  type="date"
                  value={dateFilter.to || ""}
                  onChange={(e) => setDateFilter(prev => ({ ...prev, to: e.target.value || undefined }))}
                  className="h-8 w-36"
                  placeholder="Сегодня"
                />
              </div>
            </div>
          </div>
        </div>
        
        {/* Dashboard Stats - Glassmorphism clickable cards */}
        <PaymentsDashboard 
          stats={stats} 
          isLoading={isLoading} 
          activeFilter={dashboardFilter}
          onFilterChange={setDashboardFilter}
        />
        
        {/* Financial Analytics */}
        <PaymentsAnalytics payments={filteredPayments} isLoading={isLoading} />

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
        <BepaidImportDialog
          open={importDialogOpen}
          onOpenChange={setImportDialogOpen}
          onSuccess={() => {
            refetch();
            setImportDialogOpen(false);
          }}
        />
      </div>
    </AdminLayout>
  );
}
