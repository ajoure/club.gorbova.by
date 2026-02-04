import { useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Plus, Trash2, CheckCircle2, Settings2 } from "lucide-react";

export interface DiagnosticTableColumn {
  id: string;
  name: string;
  type: 'text' | 'number' | 'select' | 'computed';
  options?: string[];
  formula?: string;
  width?: number;
  required?: boolean;
}

export interface DiagnosticTableContent {
  title?: string;
  instruction?: string;
  columns: DiagnosticTableColumn[];
  minRows: number;
  showAggregates: boolean;
  submitButtonText: string;
}

interface DiagnosticTableBlockProps {
  content: DiagnosticTableContent;
  onChange: (content: DiagnosticTableContent) => void;
  isEditing?: boolean;
  // Player mode props
  rows?: Record<string, unknown>[];
  onRowsChange?: (rows: Record<string, unknown>[]) => void;
  onComplete?: () => void;
  isCompleted?: boolean;
}

// Default columns for Point A diagnostic
const DEFAULT_COLUMNS: DiagnosticTableColumn[] = [
  { id: 'source', name: 'Источник дохода', type: 'text', required: true },
  { id: 'type', name: 'Тип', type: 'select', options: ['найм', 'клиент'] },
  { id: 'income', name: 'Доход в месяц', type: 'number', required: true },
  { id: 'work_hours', name: 'Часы по задачам', type: 'number' },
  { id: 'overhead_hours', name: 'Часы переписки', type: 'number' },
  { id: 'hourly_rate', name: 'Доход за час', type: 'computed', formula: 'income / (work_hours + overhead_hours)' },
  { id: 'legal_risk', name: 'Юр. риски', type: 'select', options: ['низкий', 'средний', 'высокий'] },
  { id: 'financial_risk', name: 'Фин. риски', type: 'select', options: ['низкий', 'средний', 'высокий'] },
  { id: 'reputation_risk', name: 'Реп. риски', type: 'select', options: ['низкий', 'средний', 'высокий'] },
  { id: 'emotional_load', name: 'Эмоц. (1-10)', type: 'number' },
  { id: 'comment', name: 'Комментарий', type: 'text' },
];

const DEFAULT_CONTENT: DiagnosticTableContent = {
  title: 'Диагностика точки А',
  instruction: 'Заполните таблицу всех источников дохода',
  columns: DEFAULT_COLUMNS,
  minRows: 1,
  showAggregates: true,
  submitButtonText: 'Диагностика точки А завершена',
};

export function DiagnosticTableBlock({ 
  content = DEFAULT_CONTENT, 
  onChange, 
  isEditing = true,
  rows = [],
  onRowsChange,
  onComplete,
  isCompleted = false
}: DiagnosticTableBlockProps) {
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const columns = content.columns || DEFAULT_COLUMNS;

  // Generate unique ID
  const genId = () => Math.random().toString(36).substring(2, 9);

  // Calculate computed columns
  const calculateComputed = useCallback((row: Record<string, unknown>, col: DiagnosticTableColumn): string | number => {
    if (col.type !== 'computed' || !col.formula) return '';
    
    try {
      // Simple formula parser: replace column IDs with values
      let formula = col.formula;
      columns.forEach(c => {
        const val = Number(row[c.id]) || 0;
        formula = formula.replace(new RegExp(c.id, 'g'), String(val));
      });
      
      // Prevent division by zero
      if (formula.includes('/ 0') || formula.includes('/0')) return 0;
      
      // eslint-disable-next-line no-eval
      const result = eval(formula);
      return typeof result === 'number' && isFinite(result) ? Math.round(result * 100) / 100 : 0;
    } catch {
      return 0;
    }
  }, [columns]);

  // Calculate aggregates
  const aggregates = useMemo(() => {
    if (!content.showAggregates || rows.length === 0) return null;
    
    const numericColumns = columns.filter(c => c.type === 'number' || c.type === 'computed');
    const result: Record<string, number> = {};
    
    numericColumns.forEach(col => {
      const values = rows.map(row => {
        if (col.type === 'computed') {
          return Number(calculateComputed(row, col)) || 0;
        }
        return Number(row[col.id]) || 0;
      });
      result[col.id] = values.reduce((a, b) => a + b, 0);
    });
    
    return result;
  }, [rows, columns, content.showAggregates, calculateComputed]);

  // Add new row
  const addRow = () => {
    const newRow: Record<string, unknown> = { _id: genId() };
    columns.forEach(col => {
      newRow[col.id] = col.type === 'number' ? 0 : '';
    });
    onRowsChange?.([...rows, newRow]);
  };

  // Update row
  const updateRow = (index: number, colId: string, value: unknown) => {
    const newRows = [...rows];
    newRows[index] = { ...newRows[index], [colId]: value };
    onRowsChange?.(newRows);
  };

  // Delete row
  const deleteRow = (index: number) => {
    const newRows = rows.filter((_, i) => i !== index);
    onRowsChange?.(newRows);
  };

  // Check if can complete
  const canComplete = rows.length >= (content.minRows || 1);

  if (isEditing) {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Заголовок</Label>
          <Input
            value={content.title || ''}
            onChange={(e) => onChange({ ...content, title: e.target.value })}
            placeholder="Диагностика точки А"
          />
        </div>

        <div className="space-y-2">
          <Label>Инструкция</Label>
          <Textarea
            value={content.instruction || ''}
            onChange={(e) => onChange({ ...content, instruction: e.target.value })}
            placeholder="Заполните таблицу..."
            rows={2}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Минимум строк для продолжения</Label>
            <Input
              type="number"
              min={1}
              value={content.minRows || 1}
              onChange={(e) => onChange({ ...content, minRows: Number(e.target.value) || 1 })}
            />
          </div>

          <div className="space-y-2">
            <Label>Текст кнопки завершения</Label>
            <Input
              value={content.submitButtonText || 'Диагностика завершена'}
              onChange={(e) => onChange({ ...content, submitButtonText: e.target.value })}
            />
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <Switch
            id="show-aggregates"
            checked={content.showAggregates !== false}
            onCheckedChange={(checked) => onChange({ ...content, showAggregates: checked })}
          />
          <Label htmlFor="show-aggregates">Показывать итоги</Label>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowColumnSettings(!showColumnSettings)}
        >
          <Settings2 className="h-4 w-4 mr-2" />
          Настройка колонок ({columns.length})
        </Button>

        {showColumnSettings && (
          <Card className="p-4">
            <p className="text-sm text-muted-foreground mb-2">
              Колонки: {columns.map(c => c.name).join(', ')}
            </p>
            <p className="text-xs text-muted-foreground">
              Расширенная настройка колонок будет доступна в следующей версии
            </p>
          </Card>
        )}

        {/* Preview */}
        <div className="mt-4 border rounded-lg p-4 bg-muted/30">
          <p className="text-sm text-muted-foreground mb-2">Предпросмотр таблицы</p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.slice(0, 5).map(col => (
                    <TableHead key={col.id} className="text-xs whitespace-nowrap">
                      {col.name}
                    </TableHead>
                  ))}
                  <TableHead className="text-xs">...</TableHead>
                </TableRow>
              </TableHeader>
            </Table>
          </div>
        </div>
      </div>
    );
  }

  // Player mode
  return (
    <div className="space-y-4">
      {content.title && (
        <h3 className="text-lg font-semibold">{content.title}</h3>
      )}
      
      {content.instruction && (
        <p className="text-muted-foreground">{content.instruction}</p>
      )}

      <div className="overflow-x-auto border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">#</TableHead>
              {columns.map(col => (
                <TableHead key={col.id} className="text-xs whitespace-nowrap">
                  {col.name}
                  {col.required && <span className="text-destructive ml-1">*</span>}
                </TableHead>
              ))}
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, rowIndex) => (
              <TableRow key={row._id as string || rowIndex}>
                <TableCell className="text-muted-foreground">{rowIndex + 1}</TableCell>
                {columns.map(col => (
                  <TableCell key={col.id} className="p-1">
                    {col.type === 'computed' ? (
                      <Badge variant="secondary" className="font-mono">
                        {calculateComputed(row, col)}
                      </Badge>
                    ) : col.type === 'select' && col.options ? (
                      <Select
                        value={String(row[col.id] || '')}
                        onValueChange={(v) => updateRow(rowIndex, col.id, v)}
                        disabled={isCompleted}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          {col.options.map(opt => (
                            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        type={col.type === 'number' ? 'number' : 'text'}
                        value={String(row[col.id] || '')}
                        onChange={(e) => updateRow(rowIndex, col.id, 
                          col.type === 'number' ? Number(e.target.value) : e.target.value
                        )}
                        className="h-8 text-xs"
                        disabled={isCompleted}
                      />
                    )}
                  </TableCell>
                ))}
                <TableCell>
                  {!isCompleted && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => deleteRow(rowIndex)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {!isCompleted && (
        <Button variant="outline" onClick={addRow} className="w-full">
          <Plus className="h-4 w-4 mr-2" />
          Добавить строку
        </Button>
      )}

      {/* Aggregates */}
      {content.showAggregates && aggregates && rows.length > 0 && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="py-3">
            <div className="flex flex-wrap gap-4 text-sm">
              {Object.entries(aggregates).map(([colId, value]) => {
                const col = columns.find(c => c.id === colId);
                if (!col || value === 0) return null;
                return (
                  <div key={colId}>
                    <span className="text-muted-foreground">{col.name}:</span>{' '}
                    <span className="font-semibold">{value}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Complete button */}
      {!isCompleted ? (
        <Button
          onClick={onComplete}
          disabled={!canComplete}
          variant="default"
          className="w-full"
        >
          <CheckCircle2 className="h-4 w-4 mr-2" />
          {content.submitButtonText || 'Диагностика завершена'}
        </Button>
      ) : (
        <div className="flex items-center justify-center gap-2 text-primary py-2">
          <CheckCircle2 className="h-5 w-5" />
          <span className="font-medium">Диагностика завершена</span>
        </div>
      )}

      {!canComplete && !isCompleted && (
        <p className="text-center text-sm text-muted-foreground">
          Добавьте минимум {content.minRows || 1} {(content.minRows || 1) === 1 ? 'строку' : 'строки'} для продолжения
        </p>
      )}
    </div>
  );
}
