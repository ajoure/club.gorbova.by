import { useState, useMemo, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronRight, ChevronDown, Layers } from "lucide-react";
import { useFormsHubData, DEFAULT_FILTERS, type FormsHubFilters, type FormsHubRow } from "@/hooks/useFormsHubData";
import { FormsHubFiltersPanel } from "./FormsHubFilters";
import { FormsHubTable } from "./FormsHubTable";
import { FormsDetailOpener } from "./FormsDetailOpener";

export function FormsByProductTabContent() {
  const [filters, setFilters] = useState<FormsHubFilters>(DEFAULT_FILTERS);
  const { data: rows, isLoading } = useFormsHubData(filters);
  const [selectedRow, setSelectedRow] = useState<FormsHubRow | null>(null);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    if (!rows) return [];
    const map = new Map<string, { title: string; product_id: string | null; rows: FormsHubRow[] }>();
    
    for (const row of rows) {
      const key = row.product_id || row.product_title || "no-product";
      if (!map.has(key)) {
        map.set(key, { title: row.product_title || "Без продукта", product_id: row.product_id, rows: [] });
      }
      map.get(key)!.rows.push(row);
    }

    return Array.from(map.values()).sort((a, b) => b.rows.length - a.rows.length);
  }, [rows]);

  const toggleGroup = (key: string) => {
    setOpenGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleOpenDetail = useCallback((row: FormsHubRow) => setSelectedRow(row), []);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <FormsHubFiltersPanel filters={filters} onChange={setFilters} />
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Загрузка...</div>
      ) : groups.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Нет записей</div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => {
            const key = group.product_id || group.title;
            const isOpen = openGroups.has(key);

            return (
              <Card key={key} className="border-l-4 border-l-indigo-300 shadow-sm overflow-hidden">
                <Collapsible open={isOpen} onOpenChange={() => toggleGroup(key)}>
                  <CollapsibleTrigger asChild>
                    <button className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent/30 transition-colors text-left">
                      {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      <div className="flex items-center gap-2 p-1.5 rounded-md bg-indigo-50">
                        <Layers className="h-4 w-4 text-indigo-500" />
                      </div>
                      <span className="font-medium text-sm flex-1">{group.title}</span>
                      <Badge variant="secondary" className="text-xs">{group.rows.length}</Badge>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="px-2 pb-2">
                      <FormsHubTable
                        rows={group.rows}
                        isLoading={false}
                        onOpenDetail={handleOpenDetail}
                      />
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            );
          })}
        </div>
      )}

      <FormsDetailOpener row={selectedRow} onClose={() => setSelectedRow(null)} />
    </div>
  );
}
