import { useState, useCallback, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useFormsHubData, DEFAULT_FILTERS, DEFAULT_PAGINATION, type FormsHubFilters, type FormsHubRow, type FormsHubPagination } from "@/hooks/useFormsHubData";
import { FormsHubFiltersPanel } from "./FormsHubFilters";
import { FormsHubTable } from "./FormsHubTable";
import { FormsHubPaginator } from "./FormsHubPaginator";
import { FormsDetailOpener } from "./FormsDetailOpener";

export function FormsSiteTabContent() {
  const [filters, setFilters] = useState<FormsHubFilters>({ ...DEFAULT_FILTERS, source_type: "site_form" });
  const [pagination, setPagination] = useState<FormsHubPagination>(DEFAULT_PAGINATION);
  const { data, isLoading } = useFormsHubData(filters, "site_form", pagination);
  const [selectedRow, setSelectedRow] = useState<FormsHubRow | null>(null);

  const prevFiltersRef = useRef(filters);
  useEffect(() => {
    if (prevFiltersRef.current !== filters) {
      setPagination(p => ({ ...p, page: 1 }));
      prevFiltersRef.current = filters;
    }
  }, [filters]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <FormsHubFiltersPanel filters={filters} onChange={setFilters} hideSourceType />
        </CardContent>
      </Card>

      <FormsHubTable
        rows={data?.rows || []}
        isLoading={isLoading}
        onOpenDetail={useCallback((row: FormsHubRow) => setSelectedRow(row), [])}
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
