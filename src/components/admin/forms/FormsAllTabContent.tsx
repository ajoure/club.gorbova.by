import { useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useFormsHubData, DEFAULT_FILTERS, type FormsHubFilters, type FormsHubRow } from "@/hooks/useFormsHubData";
import { FormsHubFiltersPanel } from "./FormsHubFilters";
import { FormsHubTable } from "./FormsHubTable";
import { FormsDetailOpener } from "./FormsDetailOpener";

export function FormsAllTabContent() {
  const [filters, setFilters] = useState<FormsHubFilters>(DEFAULT_FILTERS);
  const { data: rows, isLoading } = useFormsHubData(filters);
  const [selectedRow, setSelectedRow] = useState<FormsHubRow | null>(null);

  const handleOpenDetail = useCallback((row: FormsHubRow) => {
    setSelectedRow(row);
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <FormsHubFiltersPanel filters={filters} onChange={setFilters} />
        </CardContent>
      </Card>

      <FormsHubTable
        rows={rows || []}
        isLoading={isLoading}
        onOpenDetail={handleOpenDetail}
      />

      <div className="text-xs text-muted-foreground text-right">
        {rows ? `${rows.length} записей` : ""}
      </div>

      <FormsDetailOpener row={selectedRow} onClose={() => setSelectedRow(null)} />
    </div>
  );
}
