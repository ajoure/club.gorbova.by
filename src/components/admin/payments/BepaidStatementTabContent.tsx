import { useState, useMemo } from "react";
import { Upload, Search, CheckSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PeriodSelector, DateFilter } from "@/components/ui/period-selector";
import { BepaidStatementTable } from "./BepaidStatementTable";
import { BepaidStatementSummary, StatementFilterType } from "./BepaidStatementSummary";
import { BepaidStatementImportDialog } from "./BepaidStatementImportDialog";
import { useBepaidStatement, useBepaidStatementStats } from "@/hooks/useBepaidStatement";
import { format, startOfMonth, endOfMonth } from "date-fns";

const FILTER_LABELS: Record<Exclude<StatementFilterType, null>, string> = {
  payments: 'Платежи',
  refunds: 'Возвраты',
  cancellations: 'Отмены',
  errors: 'Ошибки',
};

export function BepaidStatementTabContent() {
  // Default to current month
  const now = new Date();
  const [dateFilter, setDateFilter] = useState<DateFilter>({
    from: format(startOfMonth(now), 'yyyy-MM-dd'),
    to: format(endOfMonth(now), 'yyyy-MM-dd'),
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<StatementFilterType>(null);

  const { data: rows = [], isLoading } = useBepaidStatement(dateFilter, searchQuery);
  const { data: stats, isLoading: statsLoading } = useBepaidStatementStats(dateFilter);

  // Filter rows based on type filter
  const filteredRows = useMemo(() => {
    if (!typeFilter) return rows;
    
    return rows.filter(row => {
      const txType = (row.transaction_type || '').toLowerCase();
      const status = (row.status || '').toLowerCase();
      
      switch (typeFilter) {
        case 'payments':
          return (status.includes('успешн') || status.includes('successful') || status.includes('succeeded'));
        case 'refunds':
          return txType.includes('возврат') || txType.includes('refund');
        case 'cancellations':
          return txType.includes('отмена') || txType.includes('void') || txType.includes('cancel');
        case 'errors':
          return status.includes('ошибк') || status.includes('failed') || status.includes('declined') || status.includes('error');
        default:
          return true;
      }
    });
  }, [rows, typeFilter]);

  // Calculate selected rows sum
  const selectedStats = useMemo(() => {
    if (selectedIds.size === 0) return null;
    
    const selectedRows = filteredRows.filter(row => selectedIds.has(row.id));
    const sum = selectedRows.reduce((acc, row) => acc + (Number(row.amount) || 0), 0);
    return {
      count: selectedRows.length,
      sum,
    };
  }, [filteredRows, selectedIds]);

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('ru-BY', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  // Clear selection when filter changes
  const handleFilterChange = (filter: StatementFilterType) => {
    setTypeFilter(filter);
    setSelectedIds(new Set());
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex items-center gap-3">
          <Button onClick={() => setImportDialogOpen(true)} size="sm">
            <Upload className="h-4 w-4 mr-2" />
            Импорт
          </Button>
          <PeriodSelector value={dateFilter} onChange={setDateFilter} />
        </div>
        
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по всем полям..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Summary stats */}
      <BepaidStatementSummary 
        stats={stats} 
        isLoading={statsLoading}
        activeFilter={typeFilter}
        onFilterChange={handleFilterChange}
      />

      {/* Active filter indicator */}
      {typeFilter && (
        <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-primary/10 border border-primary/20">
          <span className="text-sm font-medium">
            Фильтр: {FILTER_LABELS[typeFilter]}
          </span>
          <span className="text-sm text-muted-foreground">|</span>
          <span className="text-sm text-muted-foreground">
            {filteredRows.length} из {rows.length} транзакций
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 ml-auto"
            onClick={() => handleFilterChange(null)}
          >
            <X className="h-3 w-3 mr-1" />
            Сбросить
          </Button>
        </div>
      )}

      {/* Selection summary */}
      {selectedStats && (
        <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-secondary/50 border border-border/50">
          <CheckSquare className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">
            Выделено: {selectedStats.count} транзакций
          </span>
          <span className="text-sm text-muted-foreground">|</span>
          <span className="text-sm font-bold text-primary">
            Сумма: {formatAmount(selectedStats.sum)} BYN
          </span>
        </div>
      )}

      {/* Table */}
      <BepaidStatementTable
        data={filteredRows}
        isLoading={isLoading}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
      />

      {/* Row count */}
      <div className="text-xs text-muted-foreground text-right">
        Показано: {filteredRows.length} строк
        {typeFilter && ` (отфильтровано из ${rows.length})`}
      </div>

      {/* Import dialog */}
      <BepaidStatementImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
      />
    </div>
  );
}
