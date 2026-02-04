import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
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
  type: 'text' | 'number' | 'select' | 'computed' | 'slider';
  options?: string[];
  formula?: string;
  width?: number;
  required?: boolean;
  min?: number;
  max?: number;
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

// Default columns for Point A diagnostic (updated per spec)
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
  { id: 'emotional_load', name: 'Эмоц. (1-10)', type: 'slider', min: 1, max: 10 },
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

  // PATCH-1: Local state for rows to prevent focus loss
  const [localRows, setLocalRows] = useState<Record<string, unknown>[]>([]);
  
  // PATCH-C: Refs for stable dependencies (avoid infinite loops)
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  
  const onRowsChangeRef = useRef(onRowsChange);
  onRowsChangeRef.current = onRowsChange;
  
  // PATCH-C: Flag to ensure one-time initialization
  const initDoneRef = useRef(false);
  
  // Generate unique ID (stable function outside render)
  const genId = useCallback(() => Math.random().toString(36).substring(2, 9), []);
  
  // PATCH-C: Initialize local rows from props OR create first empty row
  useEffect(() => {
    // Если пришли реальные данные — ВСЕГДА применить (даже после init)
    if (rows.length > 0) {
      setLocalRows(rows);
      initDoneRef.current = true;
      return;
    }
    
    // Одноразовая инициализация пустой строкой
    if (initDoneRef.current) return;
    
    if (!isCompleted) {
      // Создать первую пустую строку
      const newRow: Record<string, unknown> = { _id: genId() };
      columnsRef.current.forEach(col => {
        newRow[col.id] = col.type === 'number' ? 0 : col.type === 'slider' ? 5 : '';
      });
      setLocalRows([newRow]);
      onRowsChangeRef.current?.([newRow]);
      initDoneRef.current = true;
    }
  }, [rows, isCompleted, genId]);

  // Commit local rows to parent
  const commitRows = useCallback(() => {
    if (localRows.length > 0) {
      onRowsChange?.(localRows);
    }
  }, [localRows, onRowsChange]);

  // PATCH-V3: Calculate computed columns SAFELY (no eval!)
  // Hardcoded support for known computed fields only
  const calculateComputed = useCallback((row: Record<string, unknown>, col: DiagnosticTableColumn): number => {
    if (col.type !== 'computed') return 0;
    
    // SAFE: Only support known computed field IDs with hardcoded logic
    if (col.id === 'hourly_rate') {
      const income = Number(row.income) || 0;
      const workHours = Number(row.work_hours) || 0;
      const overheadHours = Number(row.overhead_hours) || 0;
      const totalHours = workHours + overheadHours;
      
      // Prevent division by zero or negative hours
      if (totalHours <= 0) return 0;
      
      const result = income / totalHours;
      // Ensure result is finite and positive
      if (!Number.isFinite(result) || result < 0) return 0;
      
      return Math.round(result * 100) / 100;
    }
    
    // Unknown computed field — return 0 (no arbitrary formula execution)
    return 0;
  }, []);

  // PATCH-5: Calculate aggregates per spec (4 values)
  const totalAggregates = useMemo(() => {
    if (localRows.length === 0) return null;
    
    const total_income = localRows.reduce((sum, r) => sum + (Number(r.income) || 0), 0);
    const total_work_hours = localRows.reduce((sum, r) => sum + (Number(r.work_hours) || 0), 0);
    const total_overhead_hours = localRows.reduce((sum, r) => sum + (Number(r.overhead_hours) || 0), 0);
    const total_hours = total_work_hours + total_overhead_hours;
    const avg_hourly_rate = total_hours > 0 ? Math.round((total_income / total_hours) * 100) / 100 : 0;
    
    return { total_income, total_work_hours, total_overhead_hours, avg_hourly_rate };
  }, [localRows]);

  // Add new row - commit first then add
  const addRow = () => {
    const newRow: Record<string, unknown> = { _id: genId() };
    columns.forEach(col => {
      newRow[col.id] = col.type === 'number' ? 0 : col.type === 'slider' ? 5 : '';
    });
    const newRows = [...localRows, newRow];
    setLocalRows(newRows);
    onRowsChange?.(newRows);
  };

  // Update local row only (no parent call on every keystroke)
  const updateLocalRow = (index: number, colId: string, value: unknown) => {
    setLocalRows(prev => {
      const newRows = [...prev];
      newRows[index] = { ...newRows[index], [colId]: value };
      return newRows;
    });
  };

  // Delete row - commit immediately
  const deleteRow = (index: number) => {
    const newRows = localRows.filter((_, i) => i !== index);
    setLocalRows(newRows);
    onRowsChange?.(newRows);
  };

  // Check if can complete
  const canComplete = localRows.length >= (content.minRows || 1);

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
            {localRows.map((row, rowIndex) => (
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
                        onValueChange={(v) => {
                          updateLocalRow(rowIndex, col.id, v);
                          // Commit select changes immediately
                          setTimeout(commitRows, 0);
                        }}
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
                    ) : col.type === 'slider' ? (
                      <div className="flex items-center gap-2 min-w-[100px]">
                        <Slider
                          value={[Number(row[col.id]) || 5]}
                          onValueChange={([v]) => updateLocalRow(rowIndex, col.id, v)}
                          onValueCommit={() => commitRows()}
                          min={col.min || 1}
                          max={col.max || 10}
                          step={1}
                          disabled={isCompleted}
                          className="w-16"
                        />
                        <Badge variant="outline" className="w-6 text-center text-xs">
                          {String(row[col.id] || 5)}
                        </Badge>
                      </div>
                    ) : (
                      <Input
                        type={col.type === 'number' ? 'number' : 'text'}
                        value={String(row[col.id] || '')}
                        onChange={(e) => updateLocalRow(rowIndex, col.id, 
                          col.type === 'number' ? Number(e.target.value) : e.target.value
                        )}
                        onBlur={commitRows}
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

      {/* PATCH-5: Aggregates per spec - 4 values */}
      {content.showAggregates && totalAggregates && localRows.length > 0 && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="py-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div className="text-center">
                <p className="text-muted-foreground text-xs">Общий доход</p>
                <p className="font-bold text-lg">{totalAggregates.total_income.toLocaleString()} BYN/мес</p>
              </div>
              <div className="text-center">
                <p className="text-muted-foreground text-xs">Часы по задачам</p>
                <p className="font-semibold">{totalAggregates.total_work_hours} ч</p>
              </div>
              <div className="text-center">
                <p className="text-muted-foreground text-xs">Часы переписки</p>
                <p className="font-semibold">{totalAggregates.total_overhead_hours} ч</p>
              </div>
              <div className="text-center bg-primary/10 rounded-lg py-1">
                <p className="text-muted-foreground text-xs">Средний доход/час</p>
                <p className="font-bold text-lg text-primary">{totalAggregates.avg_hourly_rate} BYN</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Complete button */}
      {!isCompleted ? (
        <Button
          onClick={() => {
            commitRows();
            onComplete?.();
          }}
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
