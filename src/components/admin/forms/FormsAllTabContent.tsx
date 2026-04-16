import { useState, useCallback, useRef, useEffect } from "react";
import { ColumnSettings } from "@/components/admin/ColumnSettings";
import { useFormsColumns } from "@/hooks/useFormsColumns";
import { useFormsHubData, DEFAULT_FILTERS, DEFAULT_PAGINATION, type FormsHubFilters, type FormsHubRow, type FormsHubPagination } from "@/hooks/useFormsHubData";
import { FormsHubFiltersPanel } from "./FormsHubFilters";
import { FormsHubTable } from "./FormsHubTable";
import { FormsHubPaginator } from "./FormsHubPaginator";
import { FormsDetailOpener } from "./FormsDetailOpener";
import { FormsBulkActionsBar } from "./FormsBulkActionsBar";

export function FormsAllTabContent() {
  const [filters, setFilters] = useState<FormsHubFilters>(DEFAULT_FILTERS);
  const [pagination, setPagination] = useState<FormsHubPagination>(DEFAULT_PAGINATION);
  const { data, isLoading } = useFormsHubData(filters, undefined, pagination);
  const [selectedRow, setSelectedRow] = useState<FormsHubRow | null>(null);
  const [selectedRows, setSelectedRows] = useState<FormsHubRow[]>([]);
  const { columns, setColumns } = useFormsColumns();

  const prevFiltersRef = useRef(filters);
  useEffect(() => {
    if (prevFiltersRef.current !== filters) {
      setPagination(p => ({ ...p, page: 1 }));
      prevFiltersRef.current = filters;
    }
  }, [filters]);

  const handleFiltersChange = useCallback((f: FormsHubFilters) => setFilters(f), []);
  const handleOpenDetail = useCallback((row: FormsHubRow) => setSelectedRow(row), []);
  const handleSelectionChange = useCallback((rows: FormsHubRow[]) => setSelectedRows(rows), []);

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <FormsHubFiltersPanel filters={filters} onChange={handleFiltersChange} />
        </div>
        <ColumnSettings columns={columns} onChange={setColumns} />
      </div>

      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <span>Показано: <strong className="text-foreground">{data?.rows.length ?? 0}</strong></span>
        <span>•</span>
        <span>Всего: <strong className="text-foreground">{data?.totalCount ?? '...'}</strong></span>
      </div>

      <FormsHubTable
        rows={data?.rows || []}
        isLoading={isLoading}
        onOpenDetail={handleOpenDetail}
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
