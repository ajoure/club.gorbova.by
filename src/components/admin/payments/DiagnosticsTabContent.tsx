import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { PeriodSelector } from "@/components/ui/period-selector";
import { usePermissions } from "@/hooks/usePermissions";
import { usePaymentDiagnostics, type DiagnosticsFilters } from "@/hooks/usePaymentDiagnostics";
import { DiagnosticsSummaryCards } from "@/components/admin/diagnostics/DiagnosticsSummaryCards";
import { DiagnosticsFilters as FiltersComponent } from "@/components/admin/diagnostics/DiagnosticsFilters";
import { BankDeclineChart } from "@/components/admin/diagnostics/BankDeclineChart";
import { ErrorCategoryPieChart } from "@/components/admin/diagnostics/ErrorCategoryPieChart";
import { GeoComparisonChart } from "@/components/admin/diagnostics/GeoComparisonChart";
import { ApprovalRateTrendChart } from "@/components/admin/diagnostics/ApprovalRateTrendChart";
import { BankBreakdownTable } from "@/components/admin/diagnostics/BankBreakdownTable";
import { CardVerificationControl } from "@/components/admin/cards/CardVerificationControl";
import { SubscriptionBillingReport } from "@/components/admin/diagnostics/SubscriptionBillingReport";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FileText, Loader2, RefreshCw } from "lucide-react";
import { format, subDays } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreditCard, BarChart3 } from "lucide-react";

export function DiagnosticsTabContent() {
  const { hasPermission, isSuperAdmin } = usePermissions();
  const canView = hasPermission("payments.read") || isSuperAdmin();

  // Date filter state
  const [dateFilter, setDateFilter] = useState({
    from: format(subDays(new Date(), 30), "yyyy-MM-dd"),
    to: format(new Date(), "yyyy-MM-dd"),
  });

  // Filters state
  const [filters, setFilters] = useState<DiagnosticsFilters>({
    from: dateFilter.from,
    to: dateFilter.to,
  });

  // Update filters when date changes
  const handleDateChange = (newDateFilter: { from: string; to?: string }) => {
    const from = newDateFilter.from;
    const to = newDateFilter.to || from;
    setDateFilter({ from, to });
    setFilters((prev) => ({ ...prev, from, to }));
  };

  // Fetch diagnostics data
  const {
    stats,
    bankBreakdown,
    errorBreakdown,
    dailyTrend,
    filterOptions,
    isLoading,
    refetch,
    rawData,
  } = usePaymentDiagnostics(filters);

  // Generate report mutation (dry-run + audit log)
  const generateReportMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();

      // Log SYSTEM ACTOR audit entry
      const { error } = await supabase.from("audit_logs").insert({
        actor_type: "system",
        actor_user_id: null,
        actor_label: "admin-ui",
        action: "payments.diagnostics.generated",
        meta: {
          triggered_by_admin: user?.id,
          period: { from: filters.from, to: filters.to },
          filters_applied: Object.keys(filters).filter(
            (k) => filters[k as keyof DiagnosticsFilters] && filters[k as keyof DiagnosticsFilters] !== "all"
          ),
          stats_summary: {
            total: stats.total,
            approval_rate: stats.approvalRate,
            needs_3ds_rate: stats.needs3dsRate,
            sample_size: stats.sampleSize,
          },
        },
      });

      if (error) throw error;

      return {
        generatedAt: new Date().toISOString(),
        stats,
        topBanks: bankBreakdown.slice(0, 10),
        errorBreakdown,
      };
    },
    onSuccess: () => {
      toast.success("Отчёт сформирован", {
        description: "Данные агрегированы, запись в audit_logs создана",
      });
    },
    onError: (error) => {
      toast.error("Ошибка формирования отчёта", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    },
  });

  if (!canView) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        Недостаточно прав для просмотра диагностики платежей
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <PeriodSelector
            value={{
              from: dateFilter.from,
              to: dateFilter.to,
            }}
            onChange={handleDateChange}
          />
          <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
          <Button
            onClick={() => generateReportMutation.mutate()}
            disabled={generateReportMutation.isPending || isLoading}
          >
            {generateReportMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FileText className="h-4 w-4 mr-2" />
            )}
            Сформировать отчёт
          </Button>
        </div>
      </div>

      {/* Card Verification Control - only for superAdmin */}
      {isSuperAdmin() && (
        <CardVerificationControl />
      )}

      {/* Tabs for different views */}
      <Tabs defaultValue="billing" className="space-y-4">
        <TabsList className="bg-muted/50 backdrop-blur-sm border">
          <TabsTrigger value="billing" className="gap-2">
            <CreditCard className="h-4 w-4" />
            Списания и уведомления
          </TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            Аналитика отказов
          </TabsTrigger>
        </TabsList>

        {/* Billing Report Tab */}
        <TabsContent value="billing" className="space-y-4">
          <SubscriptionBillingReport />
        </TabsContent>

        {/* Analytics Tab - existing content */}
        <TabsContent value="analytics" className="space-y-6">
          {/* Summary Cards */}
          <DiagnosticsSummaryCards stats={stats} isLoading={isLoading} />

          {/* Filters */}
          <FiltersComponent
            filters={filters}
            onFiltersChange={setFilters}
            filterOptions={filterOptions}
          />

          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <BankDeclineChart data={bankBreakdown} isLoading={isLoading} />
            <ErrorCategoryPieChart data={errorBreakdown} isLoading={isLoading} />
            <GeoComparisonChart stats={stats} rawData={rawData} isLoading={isLoading} />
            <ApprovalRateTrendChart data={dailyTrend} isLoading={isLoading} />
          </div>

          {/* Bank Breakdown Table */}
          <BankBreakdownTable data={bankBreakdown} isLoading={isLoading} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
