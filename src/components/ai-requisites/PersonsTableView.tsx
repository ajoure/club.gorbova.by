/**
 * PersonsTableView — каноническая таблица физлиц с DnD-колонками, ресайзом
 * и настройкой видимости (как в /admin/forms и /admin/live-events).
 */

import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { GlassCard } from "@/components/ui/GlassCard";
import { Users, Plus, Search, Loader2 } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { SortableResizableTableHead } from "@/components/admin/table/SortableResizableTableHead";
import { ColumnSettings, type ColumnConfig } from "@/components/admin/ColumnSettings";
import { usePersonsColumns, PERSONS_LOCKED_KEYS } from "@/hooks/usePersonsColumns";
import {
  getPersonDisplayName,
  getPersonDocumentSummary,
} from "@/lib/persons/personDisplayUtils";
import type { PersonRow } from "@/hooks/useAiPersons";

type FilterKey = "all" | "active" | "inactive";

const FILTER_PILLS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "active", label: "Активные" },
  { key: "inactive", label: "Неактивные" },
];

interface PersonsTableViewProps {
  allPersons: PersonRow[];
  isLoading: boolean;
  onCreateNew: () => void;
  onView: (person: PersonRow) => void;
}

function normalizeSearch(val: string): string {
  return val.trim().toLowerCase();
}

function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-\(\)\+]/g, "");
}

export function PersonsTableView({
  allPersons,
  isLoading,
  onCreateNew,
  onView,
}: PersonsTableViewProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");

  const {
    columns,
    setColumns,
    visibleColumns,
    handleColumnResize,
    handleDragEnd,
    resetColumns,
  } = usePersonsColumns();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const filtered = useMemo(() => {
    let list = allPersons;

    if (filter === "active") list = list.filter((p) => p.is_active);
    if (filter === "inactive") list = list.filter((p) => !p.is_active);

    if (search.trim()) {
      const q = normalizeSearch(search);
      const qDigits = q.replace(/\D/g, "");
      list = list.filter((p) => {
        if (p.full_name && p.full_name.toLowerCase().includes(q)) return true;
        if (p.personal_number && p.personal_number.toLowerCase().includes(q)) return true;
        if (p.passport_number && p.passport_number.toLowerCase().includes(q)) return true;
        if (p.passport_series && `${p.passport_series} ${p.passport_number}`.toLowerCase().includes(q)) return true;
        if (p.email && p.email.toLowerCase().includes(q)) return true;
        if (p.phone && qDigits && normalizePhone(p.phone).includes(qDigits)) return true;
        return false;
      });
    }

    return [...list].sort((a, b) => {
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
      return (a.full_name || "").localeCompare(b.full_name || "", "ru");
    });
  }, [allPersons, filter, search]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const renderCell = (col: ColumnConfig, person: PersonRow) => {
    switch (col.key) {
      case "name":
        return (
          <TableCell key={col.key} style={{ width: col.width }} className="font-medium">
            <span className="truncate block">{getPersonDisplayName(person)}</span>
          </TableCell>
        );
      case "document":
        return (
          <TableCell
            key={col.key}
            style={{ width: col.width }}
            className="text-muted-foreground text-sm font-mono"
          >
            <span className="truncate block">{getPersonDocumentSummary(person)}</span>
          </TableCell>
        );
      case "phone":
        return (
          <TableCell key={col.key} style={{ width: col.width }} className="text-sm text-muted-foreground">
            {person.phone || "—"}
          </TableCell>
        );
      case "email":
        return (
          <TableCell
            key={col.key}
            style={{ width: col.width }}
            className="text-sm text-muted-foreground"
          >
            <span className="truncate block">{person.email || "—"}</span>
          </TableCell>
        );
      case "status":
        return (
          <TableCell key={col.key} style={{ width: col.width }}>
            {person.is_active ? (
              <Badge variant="secondary" className="text-xs bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                Активный
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-xs bg-muted text-muted-foreground">
                Неактивный
              </Badge>
            )}
          </TableCell>
        );
      default:
        return null;
    }
  };

  const renderHead = (col: ColumnConfig) => (
    <SortableResizableTableHead
      key={col.key}
      id={col.key}
      column={col}
      onResize={handleColumnResize}
    >
      {col.label}
    </SortableResizableTableHead>
  );

  const sortableIds = visibleColumns
    .filter((c) => !PERSONS_LOCKED_KEYS.has(c.key))
    .map((c) => c.key);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-semibold">Физлица</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {allPersons.length > 0 && (
            <ColumnSettings
              columns={columns.filter((c) => !PERSONS_LOCKED_KEYS.has(c.key))}
              onChange={(updated) => {
                setColumns((prev) => {
                  const locked = prev.filter((c) => PERSONS_LOCKED_KEYS.has(c.key));
                  return [
                    ...updated.map((c, i) => ({ ...c, order: i })),
                    ...locked.map((c, i) => ({ ...c, order: updated.length + i })),
                  ];
                });
              }}
              onReset={resetColumns}
            />
          )}
          <Button onClick={onCreateNew} size="sm">
            <Plus className="h-4 w-4 mr-1" />
            Добавить
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по ФИО, документу, телефону, email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTER_PILLS.map((pill) => (
            <Button
              key={pill.key}
              variant={filter === pill.key ? "default" : "outline"}
              size="sm"
              className="text-xs"
              onClick={() => setFilter(pill.key)}
            >
              {pill.label}
            </Button>
          ))}
        </div>
      </div>

      {allPersons.length === 0 && (
        <GlassCard className="text-center py-12">
          <div className="mx-auto mb-4 p-4 rounded-2xl bg-muted/40 w-fit">
            <Users className="h-8 w-8 text-teal-500" />
          </div>
          <h3 className="text-lg font-semibold mb-2">Нет физлиц</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Добавьте физлицо для автозаполнения документов.
          </p>
          <Button onClick={onCreateNew}>
            <Plus className="h-4 w-4 mr-1" />
            Добавить физлицо
          </Button>
        </GlassCard>
      )}

      {allPersons.length > 0 && (
        <GlassCard className="p-0 overflow-hidden">
          <div
            data-table-scroll-x="true"
            className="table-scroll-x relative"
          >
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <Table
                wrapperClassName="contents"
                style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}
              >
                <colgroup>
                  {visibleColumns.map((col) => (
                    <col key={col.key} style={{ width: `${col.width}px` }} />
                  ))}
                </colgroup>
                <TableHeader>
                  <TableRow>
                    <SortableContext items={sortableIds} strategy={horizontalListSortingStrategy}>
                      {visibleColumns.map(renderHead)}
                    </SortableContext>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={visibleColumns.length}
                        className="text-center text-muted-foreground py-8"
                      >
                        Ничего не найдено
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((person) => (
                      <TableRow
                        key={person.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => onView(person)}
                      >
                        {visibleColumns.map((col) => renderCell(col, person))}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </DndContext>
          </div>
        </GlassCard>
      )}

      {filtered.length > 0 && (
        <p className="text-xs text-muted-foreground text-right">
          Показано: {filtered.length} из {allPersons.length}
        </p>
      )}
    </div>
  );
}
