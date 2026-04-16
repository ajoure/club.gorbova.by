import { useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useFormsHubData, DEFAULT_FILTERS, type FormsHubFilters, type FormsHubRow } from "@/hooks/useFormsHubData";
import { FormsHubFiltersPanel } from "./FormsHubFilters";
import { FormsHubTable } from "./FormsHubTable";
import { FormsDetailOpener } from "./FormsDetailOpener";

export function FormsTrainingTabContent() {
  const [filters, setFilters] = useState<FormsHubFilters>({ ...DEFAULT_FILTERS, source_type: "training" });
  const { data: rows, isLoading } = useFormsHubData(filters, "training");
  const [selectedRow, setSelectedRow] = useState<FormsHubRow | null>(null);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <FormsHubFiltersPanel filters={filters} onChange={setFilters} hideSourceType />
        </CardContent>
      </Card>

      <FormsHubTable
        rows={rows || []}
        isLoading={isLoading}
        onOpenDetail={useCallback((row: FormsHubRow) => setSelectedRow(row), [])}
      />

      <FormsDetailOpener row={selectedRow} onClose={() => setSelectedRow(null)} />
    </div>
  );
}
