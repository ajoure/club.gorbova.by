/**
 * EntityTableView — full-width table of entities with search and filter pills.
 *
 * Replaces EntityListScreen (card layout).
 * Shows all entities (billing + document, active + archived) in one table.
 * Archive action only for purpose=document && status=active.
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
import {
  Building2,
  Plus,
  Archive,
  Pencil,
  Search,
  Loader2,
} from "lucide-react";
import {
  getEntityShortName,
  getEntityTypeBadge,
  getEntityUnp,
} from "@/lib/legal-entities/entityDisplayUtils";
import type { ClientLegalDetails } from "@/hooks/useLegalDetails";

type FilterKey = "all" | "legal" | "entrepreneur" | "active" | "archived";

const FILTER_PILLS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "legal", label: "ЮЛ" },
  { key: "entrepreneur", label: "ИП" },
  { key: "active", label: "Активные" },
  { key: "archived", label: "Архив" },
];

interface EntityTableViewProps {
  allEntities: ClientLegalDetails[];
  isLoading: boolean;
  isArchiving: boolean;
  onCreateNew: () => void;
  onView: (entity: ClientLegalDetails) => void;
  onArchive: (id: string) => void;
}

export function EntityTableView({
  allEntities,
  isLoading,
  isArchiving,
  onCreateNew,
  onEdit,
  onArchive,
}: EntityTableViewProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");

  const filtered = useMemo(() => {
    let list = allEntities;

    // Filter by type/status
    if (filter === "legal") list = list.filter((e) => e.client_type === "legal_entity");
    if (filter === "entrepreneur") list = list.filter((e) => e.client_type === "entrepreneur");
    if (filter === "active") list = list.filter((e) => e.status === "active");
    if (filter === "archived") list = list.filter((e) => e.status === "archived");

    // Search by short name
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter((e) => getEntityShortName(e).toLowerCase().includes(q));
    }

    // Sort: active first, then alphabetically by short name
    return [...list].sort((a, b) => {
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
      return getEntityShortName(a).localeCompare(getEntityShortName(b), "ru");
    });
  }, [allEntities, filter, search]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-semibold">Юрлица / ИП</h2>
        <Button onClick={onCreateNew} size="sm">
          <Plus className="h-4 w-4 mr-1" />
          Добавить
        </Button>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по названию..."
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

      {/* Empty state */}
      {allEntities.length === 0 && (
        <GlassCard className="text-center py-12">
          <div className="mx-auto mb-4 p-4 rounded-2xl bg-muted/40 w-fit">
            <Building2 className="h-8 w-8 text-indigo-500" />
          </div>
          <h3 className="text-lg font-semibold mb-2">Нет реквизитов</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Добавьте реквизиты организации или ИП для автозаполнения документов.
          </p>
          <Button onClick={onCreateNew}>
            <Plus className="h-4 w-4 mr-1" />
            Добавить реквизиты
          </Button>
        </GlassCard>
      )}

      {/* Table */}
      {allEntities.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Название</TableHead>
              <TableHead className="w-[60px]">Тип</TableHead>
              <TableHead className="w-[120px]">УНП</TableHead>
              <TableHead className="w-[100px]">Статус</TableHead>
              <TableHead className="w-[140px] text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  Ничего не найдено
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((entity) => {
                const canArchive =
                  entity.purpose === "document" && entity.status === "active";
                return (
                  <TableRow
                    key={entity.id}
                    className="cursor-pointer"
                    onClick={() => onEdit(entity)}
                  >
                    <TableCell className="font-medium">
                      {getEntityShortName(entity)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {getEntityTypeBadge(entity)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm font-mono">
                      {getEntityUnp(entity) || "—"}
                    </TableCell>
                    <TableCell>
                      {entity.status === "archived" ? (
                        <Badge variant="secondary" className="text-xs bg-muted text-muted-foreground">
                          Архив
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                          Активный
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            onEdit(entity);
                          }}
                        >
                          <Pencil className="h-3 w-3 mr-1" />
                          Открыть
                        </Button>
                        {canArchive && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs text-muted-foreground hover:text-destructive"
                            disabled={isArchiving}
                            onClick={(e) => {
                              e.stopPropagation();
                              onArchive(entity.id);
                            }}
                          >
                            {isArchiving ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Archive className="h-3 w-3" />
                            )}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      )}

      {/* Count */}
      {filtered.length > 0 && (
        <p className="text-xs text-muted-foreground text-right">
          Показано: {filtered.length} из {allEntities.length}
        </p>
      )}
    </div>
  );
}
