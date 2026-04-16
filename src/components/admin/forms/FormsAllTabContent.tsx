import { useState, useCallback, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useFormsHubData, DEFAULT_FILTERS, DEFAULT_PAGINATION, type FormsHubFilters, type FormsHubRow, type FormsHubPagination } from "@/hooks/useFormsHubData";
import { FormsHubFiltersPanel } from "./FormsHubFilters";
import { FormsHubTable } from "./FormsHubTable";
import { FormsHubPaginator } from "./FormsHubPaginator";
import { FormsDetailOpener } from "./FormsDetailOpener";

export function FormsAllTabContent() {
  const [filters, setFilters] = useState<FormsHubFilters>(DEFAULT_FILTERS);
  const [pagination, setPagination] = useState<FormsHubPagination>(DEFAULT_PAGINATION);
  const { data, isLoading } = useFormsHubData(filters, undefined, pagination);
  const [selectedRow, setSelectedRow] = useState<FormsHubRow | null>(null);

  // Reset page on filter change
  const prevFiltersRef = useRef(filters);
  useEffect(() => {
    if (prevFiltersRef.current !== filters) {
      setPagination(p => ({ ...p, page: 1 }));
      prevFiltersRef.current = filters;
    }
  }, [filters]);

  const handleFiltersChange = useCallback((f: FormsHubFilters) => setFilters(f), []);
  const handleOpenDetail = useCallback((row: FormsHubRow) => setSelectedRow(row), []);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <FormsHubFiltersPanel filters={filters} onChange={handleFiltersChange} />
        </CardContent>
      </Card>

      <FormsHubTable
        rows={data?.rows || []}
        isLoading={isLoading}
        onOpenDetail={handleOpenDetail}
      />

      <FormsHubPaginator
        page={pagination.page}
        pageSize={pagination.pageSize}
        totalCount={data?.totalCount || 0}
        onPageChange={(page) => setPagination(p => ({ ...p, page }))}
      />

      <FormsDetailOpener row={selectedRow} onClose={() => setSelectedRow(null)} />
    </div>
  );
}
