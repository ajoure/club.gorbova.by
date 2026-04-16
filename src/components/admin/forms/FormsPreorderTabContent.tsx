/**
 * Предзаписи — canonical FormsHubTable + summary cards сверху.
 *
 * PATCH 4.1: legacy PreregistrationsTabContent (admin/payments/...) больше
 * не используется в /admin/forms. Здесь — единый canonical table layer
 * через FormsHubTable, фильтрованный source_type="preorder".
 *
 * Summary cards и billing-pills сохранены как visual-only обёртка.
 */
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Users, Clock, CheckCircle, MessageSquare, CreditCard, XCircle } from "lucide-react";
import { ColumnSettings } from "@/components/admin/ColumnSettings";
import { useFormsColumns } from "@/hooks/useFormsColumns";
import {
  useFormsHubData,
  DEFAULT_FILTERS,
  DEFAULT_PAGINATION,
  type FormsHubFilters,
  type FormsHubRow,
  type FormsHubPagination,
} from "@/hooks/useFormsHubData";
import { getProductName } from "@/lib/product-names";
import { FormsHubFiltersPanel } from "./FormsHubFilters";
import { FormsHubTable } from "./FormsHubTable";
import { FormsHubPaginator } from "./FormsHubPaginator";
import { FormsDetailOpener } from "./FormsDetailOpener";
import { FormsBulkActionsBar } from "./FormsBulkActionsBar";

type BillingSegment = "all" | "pending" | "no_card" | "failed" | "paid";

export function FormsPreorderTabContent() {
  const [filters, setFilters] = useState<FormsHubFilters>({
    ...DEFAULT_FILTERS,
    source_type: "preorder",
  });
  const [pagination, setPagination] = useState<FormsHubPagination>(DEFAULT_PAGINATION);
  const [billingFilter, setBillingFilter] = useState<BillingSegment>("all");
  const { data, isLoading } = useFormsHubData(filters, undefined, pagination);
  const [selectedRow, setSelectedRow] = useState<FormsHubRow | null>(null);
  const [selectedRows, setSelectedRows] = useState<FormsHubRow[]>([]);
  const { columns, setColumns } = useFormsColumns();

  // Stats query — same shape as legacy, but limited to product filter scope.
  const { data: stats } = useQuery({
    queryKey: ["preregistration-stats", filters.product_id],
    queryFn: async () => {
      let query = supabase
        .from("course_preregistrations")
        .select("status, product_code, meta");

      const { data, error } = await query;
      if (error) throw error;

      const total = data.length;
      const newCount = data.filter((p) => p.status === "new").length;
      const confirmed = data.filter((p) => p.status === "confirmed").length;
      const byProduct = data.reduce((acc, p) => {
        acc[p.product_code] = (acc[p.product_code] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const billingPending = data.filter((p) => {
        const bs = (p.meta as any)?.billing?.billing_status;
        return !["paid", "cancelled"].includes(p.status) && (!bs || bs === "pending");
      }).length;
      const billingNoCard = data.filter((p) => (p.meta as any)?.billing?.billing_status === "no_card").length;
      const billingFailed = data.filter((p) => (p.meta as any)?.billing?.billing_status === "failed").length;
      const billingPaid = data.filter((p) => {
        const bs = (p.meta as any)?.billing?.billing_status;
        return p.status === "paid" || bs === "paid";
      }).length;

      return { total, newCount, confirmed, byProduct, billingPending, billingNoCard, billingFailed, billingPaid };
    },
  });

  // Filter rows client-side by billing segment (after server-side filters via FormsHubFilters).
  const filteredRows = useMemo(() => {
    const rows = data?.rows || [];
    if (billingFilter === "all") return rows;
    return rows.filter((r) => {
      const meta = (r.raw as any)?.meta;
      const bs = meta?.billing?.billing_status;
      const status = r.status;
      switch (billingFilter) {
        case "pending":
          return !["paid", "cancelled"].includes(status) && (!bs || bs === "pending");
        case "no_card":
          return bs === "no_card";
        case "failed":
          return bs === "failed";
        case "paid":
          return status === "paid" || bs === "paid";
      }
    });
  }, [data?.rows, billingFilter]);

  const prevFiltersRef = useRef(filters);
  useEffect(() => {
    if (prevFiltersRef.current !== filters) {
      setPagination((p) => ({ ...p, page: 1 }));
      prevFiltersRef.current = filters;
    }
  }, [filters]);

  const handleOpenDetail = useCallback((row: FormsHubRow) => setSelectedRow(row), []);
  const handleSelectionChange = useCallback((rows: FormsHubRow[]) => setSelectedRows(rows), []);

  return (
    <div className="space-y-4">
      {/* Stats cards */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Всего</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{stats?.total || 0}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Новых</CardTitle>
            <Clock className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{stats?.newCount || 0}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Подтверждённых</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{stats?.confirmed || 0}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">По продуктам</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xs space-y-1 max-h-20 overflow-auto">
              {stats?.byProduct &&
                Object.entries(stats.byProduct).map(([code, count]) => (
                  <div key={code} className="flex justify-between gap-2">
                    <span className="text-muted-foreground truncate">{getProductName(code)}</span>
                    <span className="font-medium">{count}</span>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Billing segment pills */}
      <div className="flex flex-wrap gap-2">
        <Button variant={billingFilter === "all" ? "default" : "outline"} size="sm" onClick={() => setBillingFilter("all")}>
          Все
        </Button>
        <Button variant={billingFilter === "pending" ? "default" : "outline"} size="sm" onClick={() => setBillingFilter("pending")} className="gap-2">
          <Clock className="h-4 w-4" /> Ожидают списания
          <Badge variant="secondary" className="ml-1">{stats?.billingPending || 0}</Badge>
        </Button>
        <Button variant={billingFilter === "no_card" ? "default" : "outline"} size="sm" onClick={() => setBillingFilter("no_card")} className="gap-2">
          <CreditCard className="h-4 w-4 text-yellow-500" /> Нет карты
          <Badge variant="secondary" className="ml-1">{stats?.billingNoCard || 0}</Badge>
        </Button>
        <Button variant={billingFilter === "failed" ? "default" : "outline"} size="sm" onClick={() => setBillingFilter("failed")} className="gap-2">
          <XCircle className="h-4 w-4 text-red-500" /> Ошибка
          <Badge variant="secondary" className="ml-1">{stats?.billingFailed || 0}</Badge>
        </Button>
        <Button variant={billingFilter === "paid" ? "default" : "outline"} size="sm" onClick={() => setBillingFilter("paid")} className="gap-2">
          <CheckCircle className="h-4 w-4 text-green-500" /> Оплачено
          <Badge variant="secondary" className="ml-1">{stats?.billingPaid || 0}</Badge>
        </Button>
      </div>

      {/* Canonical filters + table */}
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <FormsHubFiltersPanel filters={filters} onChange={setFilters} hideSourceType />
        </div>
        <ColumnSettings columns={columns} onChange={setColumns} />
      </div>

      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <span>Показано: <strong className="text-foreground">{filteredRows.length}</strong></span>
        <span>•</span>
        <span>Всего: <strong className="text-foreground">{data?.totalCount ?? "..."}</strong></span>
      </div>

      <FormsHubTable
        rows={filteredRows}
        isLoading={isLoading}
        onOpenDetail={handleOpenDetail}
        onSelectionChange={handleSelectionChange}
      />

      <FormsHubPaginator
        page={pagination.page}
        pageSize={pagination.pageSize}
        totalCount={data?.totalCount || 0}
        onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
      />

      <FormsBulkActionsBar
        selectedRows={selectedRows}
        totalCount={data?.totalCount || 0}
        onClearSelection={() => setSelectedRows([])}
      />

      <FormsDetailOpener row={selectedRow} onClose={() => setSelectedRow(null)} />
    </div>
  );
}
