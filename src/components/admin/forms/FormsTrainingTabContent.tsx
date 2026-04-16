import { useState, useCallback, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useFormsHubData, DEFAULT_FILTERS, DEFAULT_PAGINATION, type FormsHubFilters, type FormsHubRow, type FormsHubPagination } from "@/hooks/useFormsHubData";
import { FormsHubFiltersPanel } from "./FormsHubFilters";
import { FormsHubTable } from "./FormsHubTable";
import { FormsHubPaginator } from "./FormsHubPaginator";
import { FormsDetailOpener } from "./FormsDetailOpener";
import { FormsTableToolbar } from "./FormsTableToolbar";
import { FormsBulkActionsBar } from "./FormsBulkActionsBar";

export function FormsTrainingTabContent() {
  const [filters, setFilters] = useState<FormsHubFilters>({ ...DEFAULT_FILTERS, source_type: "training" });
  const [pagination, setPagination] = useState<FormsHubPagination>(DEFAULT_PAGINATION);
  const { data, isLoading } = useFormsHubData(filters, "training", pagination);
  const [selectedRow, setSelectedRow] = useState<FormsHubRow | null>(null);
  const [selectedRows, setSelectedRows] = useState<FormsHubRow[]>([]);

  const prevFiltersRef = useRef(filters);
  useEffect(() => {
    if (prevFiltersRef.current !== filters) {
      setPagination(p => ({ ...p, page: 1 }));
      prevFiltersRef.current = filters;
    }
  }, [filters]);

  const handleSelectionChange = useCallback((rows: FormsHubRow[]) => setSelectedRows(rows), []);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4 space-y-3">
          <FormsHubFiltersPanel filters={filters} onChange={setFilters} hideSourceType />
          <FormsTableToolbar />
        </CardContent>
      </Card>

      <FormsHubTable
        rows={data?.rows || []}
        isLoading={isLoading}
        onOpenDetail={useCallback((row: FormsHubRow) => setSelectedRow(row), [])}
        onSelectionChange={handleSelectionChange}
      />

      <FormsHubPaginator
        page={pagination.page}
        pageSize={pagination.pageSize}
        totalCount={data?.totalCount || 0}
        onPageChange={(page) => setPagination(p => ({ ...p, page }))}
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
