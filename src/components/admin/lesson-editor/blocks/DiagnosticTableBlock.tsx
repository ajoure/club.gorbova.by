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
import { Plus, Trash2, CheckCircle2, Settings2, RotateCcw } from "lucide-react";

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
  layout?: 'horizontal' | 'vertical';
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
  // Reset handler
  onReset?: () => void;
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
  isCompleted = false,
  onReset
}: DiagnosticTableBlockProps) {
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const columns = content.columns || DEFAULT_COLUMNS;

  // PATCH-1: Local state for rows to prevent focus loss
  const [localRows, setLocalRows] = useState<Record<string, unknown>[]>([]);
  
  // PATCH P0.9.5: Debounce timeout ref for immediate update + debounced commit
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // PATCH-C: Refs for stable dependencies (avoid infinite loops)
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  
  const onRowsChangeRef = useRef(onRowsChange);
  onRowsChangeRef.current = onRowsChange;
  
  // PATCH-C: Flag to ensure one-time initialization
  const initDoneRef = useRef(false);
  
  // Local rows ref for flush (P0.9.5)
  const localRowsRef = useRef(localRows);
  localRowsRef.current = localRows;
  
  // Generate unique ID (stable function outside render)
  const genId = useCallback(() => Math.random().toString(36).substring(2, 9), []);
  
  // PATCH P0.9.5: Cleanup debounce timer on unmount + flush pending changes
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        // Flush pending changes on unmount
        if (localRowsRef.current.length > 0) {
          onRowsChangeRef.current?.(localRowsRef.current);
        }
      }
    };
  }, []);
  
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

  // PATCH P0.9.5: Debounced commit - schedule save after 300ms
  const debouncedCommit = useCallback((newRows: Record<string, unknown>[]) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      onRowsChange?.(newRows);
    }, 300);
  }, [onRowsChange]);

  // PATCH P0.9.5: Immediate commit (flush debounce)
  const flushAndCommit = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    if (localRowsRef.current.length > 0) {
      onRowsChange?.(localRowsRef.current);
    }
  }, [onRowsChange]);

  // Legacy commitRows for backwards compat (now flushes)
  const commitRows = flushAndCommit;

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
    onRowsChange?.(newRows); // Immediate commit for add
  };

  // PATCH P0.9.5: Update local row with debounced commit
  const updateLocalRow = (index: number, colId: string, value: unknown) => {
    setLocalRows(prev => {
      const newRows = [...prev];
      newRows[index] = { ...newRows[index], [colId]: value };
      // Schedule debounced commit
      debouncedCommit(newRows);
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

        <div className="space-y-2">
          <Label>Ориентация таблицы</Label>
          <Select
            value={content.layout || 'horizontal'}
            onValueChange={(v: 'horizontal' | 'vertical') => onChange({ ...content, layout: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="horizontal">Горизонтальная (колонки сверху)</SelectItem>
              <SelectItem value="vertical">Вертикальная (карточки)</SelectItem>
            </SelectContent>
          </Select>
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
          <p className="text-sm text-muted-foreground mb-2">Предпросмотр таблицы ({content.layout === 'vertical' ? 'вертикальная' : 'горизонтальная'})</p>
          {(content.layout === 'vertical') ? (
            <Card>
              <CardContent className="py-3 space-y-2">
                {columns.map(col => (
                  <div key={col.id} className="flex items-center justify-between gap-4 py-1 border-b last:border-b-0">
                    <span className="text-xs font-medium text-muted-foreground">{col.name}</span>
                    <span className="text-xs">
                      {col.type === 'computed' ? '(авто)' : col.type === 'select' ? (col.options?.[0] || '—') : col.type === 'slider' ? '5' : col.type === 'number' ? '0' : 'Пример'}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs whitespace-nowrap w-8">#</TableHead>
                    {columns.map(col => (
                      <TableHead key={col.id} className="text-xs whitespace-nowrap">
                        {col.name}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="text-xs text-muted-foreground">1</TableCell>
                    {columns.map(col => (
                      <TableCell key={col.id} className="text-xs text-muted-foreground">
                        {col.type === 'computed' ? '(авто)' : col.type === 'select' ? (col.options?.[0] || '—') : col.type === 'slider' ? '5' : col.type === 'number' ? '0' : 'Пример'}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
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

      {(content.layout === 'vertical') ? (
        /* Vertical card layout */
        <div className="space-y-3">
          {localRows.map((row, rowIndex) => (
            <Card key={row._id as string || rowIndex}>
              <CardContent className="py-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Строка {rowIndex + 1}</span>
                  {!isCompleted && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteRow(rowIndex)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
                {columns.map(col => (
                  <div key={col.id} className="flex items-center justify-between gap-4">
                    <Label className="text-xs whitespace-nowrap shrink-0">
                      {col.name}
                      {col.required && <span className="text-destructive ml-1">*</span>}
                    </Label>
                    <div className="w-full max-w-[200px]">
                      {col.type === 'computed' ? (
                        <Badge variant="secondary" className="font-mono">
                          {calculateComputed(row, col)}
                        </Badge>
                      ) : col.type === 'select' && col.options ? (
                        <Select
                          value={String(row[col.id] || '')}
                          onValueChange={(v) => updateLocalRow(rowIndex, col.id, v)}
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
                        <div className="flex items-center gap-2">
                          <Slider
                            value={[Number(row[col.id]) || 5]}
                            onValueChange={([v]) => updateLocalRow(rowIndex, col.id, v)}
                            min={col.min || 1}
                            max={col.max || 10}
                            step={1}
                            disabled={isCompleted}
                            className="w-full"
                          />
                          <Badge variant="outline" className="w-6 text-center text-xs shrink-0">
                            {String(row[col.id] || 5)}
                          </Badge>
                        </div>
                      ) : (
                        <Input
                          type={col.type === 'number' ? 'number' : 'text'}
                          value={String(row[col.id] || '')}
                          onChange={(e) => updateLocalRow(rowIndex, col.id, col.type === 'number' ? Number(e.target.value) : e.target.value)}
                          className="h-8 text-xs"
                          disabled={isCompleted}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        /* Horizontal table layout with sticky header */
        <div className="relative overflow-x-auto overflow-y-auto max-h-[70vh] border rounded-lg">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
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
                          onValueChange={(v) => updateLocalRow(rowIndex, col.id, v)}
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
                          onChange={(e) => updateLocalRow(rowIndex, col.id, col.type === 'number' ? Number(e.target.value) : e.target.value)}
                          className="h-8 text-xs"
                          disabled={isCompleted}
                        />
                      )}
                    </TableCell>
                  ))}
                  <TableCell>
                    {!isCompleted && (
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteRow(rowIndex)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

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
            // PATCH P0.9.5: Flush any pending debounced saves before completing
            flushAndCommit();
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
        <div className="flex flex-col items-center gap-3 py-2">
          <div className="flex items-center gap-2 text-primary">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-medium">Диагностика завершена</span>
          </div>
          {onReset && (
            <Button 
              variant="ghost" 
              size="sm"
              onClick={onReset}
              className="gap-2 text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-4 w-4" />
              Редактировать данные
            </Button>
          )}
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
