import { useState, useMemo, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronRight, ChevronDown, Layers, FileText, ClipboardList, GraduationCap, BookOpen } from "lucide-react";
import { ColumnSettings } from "@/components/admin/ColumnSettings";
import { useFormsColumns } from "@/hooks/useFormsColumns";
import { useFormsHubData, DEFAULT_FILTERS, type FormsHubFilters, type FormsHubRow } from "@/hooks/useFormsHubData";
import { FormsHubFiltersPanel } from "./FormsHubFilters";
import { FormsHubTable } from "./FormsHubTable";
import { FormsDetailOpener } from "./FormsDetailOpener";
import { FormsBulkActionsBar } from "./FormsBulkActionsBar";

/**
 * "По продуктам" — двухуровневая (для training: трёхуровневая) группировка.
 *   product
 *     ├─ Анкеты сайта (site_form)
 *     ├─ Предзаписи (preorder)
 *     └─ Обучение (training) → module → lesson
 *
 * Counts на каждом уровне. Embedded таблицы используют тот же общий
 * columns state (`useFormsColumns`) — порядок/ширины синхронизированы.
 */
export function FormsByProductTabContent() {
  const [filters, setFilters] = useState<FormsHubFilters>(DEFAULT_FILTERS);
  const { data, isLoading } = useFormsHubData(filters, undefined, { page: 1, pageSize: 50 }, { exportMode: true });
  const [selectedRow, setSelectedRow] = useState<FormsHubRow | null>(null);
  const [selectedRows, setSelectedRows] = useState<FormsHubRow[]>([]);
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());

  const rows = data?.rows;

  type ModuleGroup = { module_id: string | null; module_title: string; lessons: Map<string, { lesson_id: string | null; lesson_title: string; rows: FormsHubRow[] }> };
  type ProductGroup = {
    product_id: string | null;
    title: string;
    site_form: FormsHubRow[];
    preorder: FormsHubRow[];
    training_modules: Map<string, ModuleGroup>;
    total: number;
  };

  const productGroups = useMemo(() => {
    if (!rows) return [];
    const map = new Map<string, ProductGroup>();

    // PATCH 4.1: единый ключ группировки = product_id (UUID).
    // Записи без resolvable product_id попадают в одну группу "no-product".
    // Это устраняет дубль "одного продукта двумя верхними группами".
    for (const row of rows) {
      const pKey = row.product_id || "no-product";
      let pg = map.get(pKey);
      if (!pg) {
        pg = {
          product_id: row.product_id,
          title: row.product_id ? (row.product_title || "Без названия") : "Без привязки к продукту",
          site_form: [],
          preorder: [],
          training_modules: new Map(),
          total: 0,
        };
        map.set(pKey, pg);
      }
      pg.total += 1;

      if (row.source_type === "site_form") pg.site_form.push(row);
      else if (row.source_type === "preorder") pg.preorder.push(row);
      else if (row.source_type === "training") {
        const mKey = row.module_id || row.module_title || "no-module";
        let mg = pg.training_modules.get(mKey);
        if (!mg) {
          mg = { module_id: row.module_id, module_title: row.module_title || "Без модуля", lessons: new Map() };
          pg.training_modules.set(mKey, mg);
        }
        const lKey = row.lesson_id || row.lesson_title || "no-lesson";
        let lg = mg.lessons.get(lKey);
        if (!lg) {
          lg = { lesson_id: row.lesson_id, lesson_title: row.lesson_title || row.source_entity || "Урок", rows: [] };
          mg.lessons.set(lKey, lg);
        }
        lg.rows.push(row);
      }
    }

    // "Без привязки" всегда в конце
    return Array.from(map.values()).sort((a, b) => {
      if (!a.product_id && b.product_id) return 1;
      if (a.product_id && !b.product_id) return -1;
      return b.total - a.total;
    });
  }, [rows]);

  const totalTraining = (pg: ProductGroup) =>
    Array.from(pg.training_modules.values()).reduce(
      (s, m) => s + Array.from(m.lessons.values()).reduce((s2, l) => s2 + l.rows.length, 0),
      0,
    );

  const toggle = (key: string) =>
    setOpenKeys((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });

  const handleOpenDetail = useCallback((row: FormsHubRow) => setSelectedRow(row), []);
  const handleSelectionChange = useCallback((r: FormsHubRow[]) => setSelectedRows(r), []);

  const { columns, setColumns } = useFormsColumns();

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <FormsHubFiltersPanel filters={filters} onChange={setFilters} />
        </div>
        <ColumnSettings columns={columns} onChange={setColumns} />
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Загрузка...</div>
      ) : productGroups.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Нет записей</div>
      ) : (
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground text-right">
            {data?.totalCount ?? 0} записей · {productGroups.length} продуктов
          </div>

          {productGroups.map((pg) => {
            const pKey = pg.product_id || "no-product";
            const pOpen = openKeys.has(pKey);
            const trainingCount = totalTraining(pg);

            return (
              <Card key={pKey} className="border-l-4 border-l-indigo-300 shadow-sm overflow-hidden">
                <Collapsible open={pOpen} onOpenChange={() => toggle(pKey)}>
                  <CollapsibleTrigger asChild>
                    <button className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent/30 transition-colors text-left">
                      {pOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      <div className="flex items-center gap-2 p-1.5 rounded-md bg-indigo-50">
                        <Layers className="h-4 w-4 text-indigo-500" />
                      </div>
                      <span className="font-medium text-sm flex-1">{pg.title}</span>
                      <Badge variant="secondary" className="text-xs">{pg.total}</Badge>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="px-3 pb-3 space-y-2">
                      {/* Site forms section */}
                      {pg.site_form.length > 0 && (
                        <SourceSection
                          icon={FileText}
                          iconBg="bg-blue-50"
                          iconColor="text-blue-500"
                          title="Анкеты сайта"
                          count={pg.site_form.length}
                          isOpen={openKeys.has(`${pKey}::site`)}
                          onToggle={() => toggle(`${pKey}::site`)}
                        >
                          <FormsHubTable
                            rows={pg.site_form}
                            isLoading={false}
                            onOpenDetail={handleOpenDetail}
                            variant="embedded"
                            onSelectionChange={handleSelectionChange}
                          />
                        </SourceSection>
                      )}

                      {/* Preorders */}
                      {pg.preorder.length > 0 && (
                        <SourceSection
                          icon={ClipboardList}
                          iconBg="bg-amber-50"
                          iconColor="text-amber-500"
                          title="Предзаписи"
                          count={pg.preorder.length}
                          isOpen={openKeys.has(`${pKey}::pre`)}
                          onToggle={() => toggle(`${pKey}::pre`)}
                        >
                          <FormsHubTable
                            rows={pg.preorder}
                            isLoading={false}
                            onOpenDetail={handleOpenDetail}
                            variant="embedded"
                            onSelectionChange={handleSelectionChange}
                          />
                        </SourceSection>
                      )}

                      {/* Training: module → lesson */}
                      {trainingCount > 0 && (
                        <SourceSection
                          icon={GraduationCap}
                          iconBg="bg-emerald-50"
                          iconColor="text-emerald-500"
                          title="Обучение"
                          count={trainingCount}
                          isOpen={openKeys.has(`${pKey}::train`)}
                          onToggle={() => toggle(`${pKey}::train`)}
                        >
                          <div className="space-y-1.5 pl-2">
                            {Array.from(pg.training_modules.values()).map((mg) => {
                              const mKey = `${pKey}::m::${mg.module_id || mg.module_title}`;
                              const mOpen = openKeys.has(mKey);
                              const mTotal = Array.from(mg.lessons.values()).reduce((s, l) => s + l.rows.length, 0);
                              return (
                                <Collapsible key={mKey} open={mOpen} onOpenChange={() => toggle(mKey)}>
                                  <CollapsibleTrigger asChild>
                                    <button className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-accent/30 rounded text-left text-sm">
                                      {mOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                                      <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
                                      <span className="flex-1 font-medium">{mg.module_title}</span>
                                      <Badge variant="outline" className="text-[10px]">{mTotal}</Badge>
                                    </button>
                                  </CollapsibleTrigger>
                                  <CollapsibleContent>
                                    <div className="pl-5 space-y-1.5 mt-1">
                                      {Array.from(mg.lessons.values()).map((lg) => {
                                        const lKey = `${mKey}::l::${lg.lesson_id || lg.lesson_title}`;
                                        const lOpen = openKeys.has(lKey);
                                        return (
                                          <Collapsible key={lKey} open={lOpen} onOpenChange={() => toggle(lKey)}>
                                            <CollapsibleTrigger asChild>
                                              <button className="w-full flex items-center gap-2 px-2 py-1 hover:bg-accent/30 rounded text-left text-xs">
                                                {lOpen ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                                                <span className="flex-1">{lg.lesson_title}</span>
                                                <Badge variant="outline" className="text-[10px]">{lg.rows.length}</Badge>
                                              </button>
                                            </CollapsibleTrigger>
                                            <CollapsibleContent>
                                              <div className="pl-2 mt-1">
                                                <FormsHubTable
                                                  rows={lg.rows}
                                                  isLoading={false}
                                                  onOpenDetail={handleOpenDetail}
                                                  variant="embedded"
                                                  onSelectionChange={handleSelectionChange}
                                                />
                                              </div>
                                            </CollapsibleContent>
                                          </Collapsible>
                                        );
                                      })}
                                    </div>
                                  </CollapsibleContent>
                                </Collapsible>
                              );
                            })}
                          </div>
                        </SourceSection>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            );
          })}
        </div>
      )}

      <FormsBulkActionsBar
        selectedRows={selectedRows}
        totalCount={data?.totalCount || 0}
        onClearSelection={() => setSelectedRows([])}
      />

      <FormsDetailOpener row={selectedRow} onClose={() => setSelectedRow(null)} />
    </div>
  );
}

function SourceSection({
  icon: Icon, iconBg, iconColor, title, count, isOpen, onToggle, children,
}: {
  icon: any; iconBg: string; iconColor: string; title: string; count: number;
  isOpen: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <Collapsible open={isOpen} onOpenChange={onToggle}>
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center gap-2 px-2 py-2 hover:bg-accent/30 rounded text-left">
          {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          <div className={`p-1 rounded ${iconBg}`}>
            <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
          </div>
          <span className="text-sm font-medium flex-1">{title}</span>
          <Badge variant="secondary" className="text-[10px]">{count}</Badge>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1.5">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
