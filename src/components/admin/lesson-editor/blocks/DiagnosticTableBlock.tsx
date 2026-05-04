import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextarea } from "@/components/ui/RichTextarea";
import { SafeHtml } from "@/components/ui/SafeHtml";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Plus, Trash2, CheckCircle2, Settings2, RotateCcw, AlertCircle, Save, Loader2, Link2, CheckCircle, XCircle, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_V2_COLUMNS,
  calculateV2Computed,
  calculateV2Aggregates,
  formatV2Computed,
  validateV2Rows,
  isRowEmpty,
  CATEGORY_COLORS,
  V2_TEXTAREA_FIELD_IDS,
  type DiagnosticTableV2Computed,
  type V2ValidationError,
} from "@/lib/diagnosticTableV1toV2";

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
  condition?: 'client_only';
}

export interface DiagnosticTableContent {
  title?: string;
  instruction?: string;
  columns: DiagnosticTableColumn[];
  minRows: number;
  showAggregates: boolean;
  submitButtonText: string;
  layout?: 'horizontal' | 'vertical';
  version?: 'v1' | 'v2';
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
  // Real save status from useLessonProgressState (optional — not used in editor mode)
  saveStatus?: 'idle' | 'saving' | 'saved' | 'error';
}

// Default columns for Point A diagnostic — FULL names, no abbreviations
const DEFAULT_COLUMNS: DiagnosticTableColumn[] = [
  { id: 'source', name: 'Источник дохода', type: 'text', required: true },
  { id: 'type', name: 'Тип', type: 'select', options: ['найм', 'клиент'] },
  { id: 'income', name: 'Доход в месяц, BYN', type: 'number', required: true },
  { id: 'work_hours', name: 'Часы по задачам', type: 'number' },
  { id: 'overhead_hours', name: 'Часы переписки', type: 'number' },
  { id: 'hourly_rate', name: 'Доход за час, BYN', type: 'computed', formula: 'income / (work_hours + overhead_hours)' },
  { id: 'legal_risk', name: 'Юридические риски', type: 'select', options: ['низкий', 'средний', 'высокий'] },
  { id: 'financial_risk', name: 'Финансовые риски', type: 'select', options: ['низкий', 'средний', 'высокий'] },
  { id: 'reputation_risk', name: 'Репутационные риски', type: 'select', options: ['низкий', 'средний', 'высокий'] },
  { id: 'emotional_load', name: 'Эмоциональная нагрузка (1-10)', type: 'slider', min: 1, max: 10 },
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
  onReset,
  saveStatus: externalSaveStatus,
}: DiagnosticTableBlockProps) {
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  
  // V2 version flag — all V2 logic branches on this
  const isV2 = content.version === 'v2';
  const columns = isV2 
    ? (content.columns?.length ? content.columns : DEFAULT_V2_COLUMNS as DiagnosticTableColumn[])
    : (content.columns?.length ? content.columns : DEFAULT_COLUMNS);

  // ── Source lesson ID editor state (admin only, V2 only) ──
  const [sourceLessonInput, setSourceLessonInput] = useState((content as any).source_lesson_id || '');
  const debouncedSourceId = useDebouncedValue(sourceLessonInput, 600);
  const [sourceValidation, setSourceValidation] = useState<{
    status: 'idle' | 'loading' | 'valid' | 'error_not_found' | 'error_no_v1';
    lessonTitle?: string;
  }>({ status: sourceLessonInput ? 'loading' : 'idle' });

  // Validate source_lesson_id on debounced value change
  useEffect(() => {
    if (!isV2 || !isEditing) return;
    
    const id = debouncedSourceId.trim();
    if (!id) {
      setSourceValidation({ status: 'idle' });
      return;
    }

    // UUID format check
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRe.test(id)) {
      setSourceValidation({ status: 'error_not_found' });
      return;
    }

    let cancelled = false;
    setSourceValidation({ status: 'loading' });

    (async () => {
      // 1. Check lesson exists
      const { data: lesson } = await supabase
        .from('training_lessons')
        .select('id, title')
        .eq('id', id)
        .maybeSingle();
      if (cancelled) return;
      if (!lesson) {
        setSourceValidation({ status: 'error_not_found' });
        return;
      }
      // 2. Check has V1 diagnostic_table block
      const { data: blocks } = await supabase
        .from('lesson_blocks')
        .select('id, content')
        .eq('lesson_id', id)
        .eq('block_type', 'diagnostic_table');
      if (cancelled) return;
      const hasV1 = blocks?.some(b => {
        const ver = (b.content as any)?.version;
        return !ver || ver !== 'v2';
      });
      if (!hasV1) {
        setSourceValidation({ status: 'error_no_v1', lessonTitle: lesson.title });
        return;
      }
      setSourceValidation({ status: 'valid', lessonTitle: lesson.title });
    })();

    return () => { cancelled = true; };
  }, [debouncedSourceId, isV2, isEditing]);

  // Commit source_lesson_id to content on debounced change
  useEffect(() => {
    if (!isV2 || !isEditing) return;
    const current = (content as any).source_lesson_id || '';
    const trimmed = debouncedSourceId.trim();
    if (trimmed !== current) {
      onChange({ ...content, source_lesson_id: trimmed } as any);
    }
  }, [debouncedSourceId]); // intentionally minimal deps to avoid loops

  // PATCH: Local state for rows to prevent focus loss
  const [localRows, setLocalRows] = useState<Record<string, unknown>[]>([]);
  
  // PATCH: Validation errors (inline, no toast)
  const [validationErrors, setValidationErrors] = useState<V2ValidationError[]>([]);
  
  // PATCH: Save status — use external (real DB) if provided, else local fallback for editor
  const [localSaveStatus, setLocalSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveStatus = externalSaveStatus ?? localSaveStatus;
  const saveStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Debounce timeout ref for immediate update + debounced commit
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Refs for stable dependencies (avoid infinite loops)
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  
  const onRowsChangeRef = useRef(onRowsChange);
  onRowsChangeRef.current = onRowsChange;
  
  // Flag to ensure one-time initialization
  const initDoneRef = useRef(false);
  
  // Local rows ref for flush
  const localRowsRef = useRef(localRows);
  localRowsRef.current = localRows;
  
  // Generate unique ID
  const genId = useCallback(() => Math.random().toString(36).substring(2, 9), []);
  
  // Cleanup debounce timer on unmount + flush pending changes
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        if (localRowsRef.current.length > 0) {
          onRowsChangeRef.current?.(localRowsRef.current);
        }
      }
      if (saveStatusTimeoutRef.current) {
        clearTimeout(saveStatusTimeoutRef.current);
      }
    };
  }, []);
  
  // Guard: skip props sync while user is actively editing (prevents cursor reset)
  const userEditingRef = useRef(false);

  // Initialize local rows from props OR create first empty row
  useEffect(() => {
    if (rows.length > 0) {
      // After init, skip sync from props if user is editing (prevents cursor jump)
      if (initDoneRef.current && userEditingRef.current) {
        return;
      }
      setLocalRows(rows);
      initDoneRef.current = true;
      return;
    }
    
    if (initDoneRef.current) return;
    
    if (!isCompleted) {
      const newRow: Record<string, unknown> = { _id: genId() };
      columnsRef.current.forEach(col => {
        newRow[col.id] = col.type === 'number' ? 0 : col.type === 'slider' ? 5 : '';
      });
      setLocalRows([newRow]);
      onRowsChangeRef.current?.([newRow]);
      initDoneRef.current = true;
    }
  }, [rows, isCompleted, genId]);

  // Debounced commit (only sets local status if no external saveStatus)
  const debouncedCommit = useCallback((newRows: Record<string, unknown>[]) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    if (!externalSaveStatus) setLocalSaveStatus('saving');
    saveTimeoutRef.current = setTimeout(() => {
      try {
        onRowsChange?.(newRows);
        userEditingRef.current = false; // Allow props sync again after commit
        if (!externalSaveStatus) {
          setLocalSaveStatus('saved');
          if (saveStatusTimeoutRef.current) clearTimeout(saveStatusTimeoutRef.current);
          saveStatusTimeoutRef.current = setTimeout(() => setLocalSaveStatus('idle'), 2000);
        }
      } catch {
        userEditingRef.current = false;
        if (!externalSaveStatus) setLocalSaveStatus('error');
      }
    }, 300);
  }, [onRowsChange, externalSaveStatus]);

  // Immediate commit (flush debounce)
  const flushAndCommit = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    if (localRowsRef.current.length > 0) {
      onRowsChange?.(localRowsRef.current);
    }
  }, [onRowsChange]);

  // V1: Calculate computed columns SAFELY (no eval)
  const calculateComputed = useCallback((row: Record<string, unknown>, col: DiagnosticTableColumn): number => {
    if (col.type !== 'computed') return 0;
    
    if (col.id === 'hourly_rate') {
      const income = Math.max(0, Number(row.income) || 0);
      const workHours = Math.max(0, Number(row.work_hours) || 0);
      const overheadHours = Math.max(0, Number(row.overhead_hours) || 0);
      const totalHours = workHours + overheadHours;
      
      if (totalHours <= 0) return 0;
      
      const result = income / totalHours;
      if (!Number.isFinite(result) || result < 0) return 0;
      
      return Math.round(result * 100) / 100;
    }
    
    return 0;
  }, []);

  // V2: Pre-calculate all computed values (cross-row dependencies)
  const v2ComputedMap = useMemo(() => {
    if (!isV2) return null;
    return localRows.map(row => calculateV2Computed(row, localRows));
  }, [isV2, localRows]);

  // V1 aggregates
  const totalAggregates = useMemo(() => {
    if (isV2 || localRows.length === 0) return null;
    
    const total_income = localRows.reduce((sum, r) => sum + (Number(r.income) || 0), 0);
    const total_work_hours = localRows.reduce((sum, r) => sum + (Number(r.work_hours) || 0), 0);
    const total_overhead_hours = localRows.reduce((sum, r) => sum + (Number(r.overhead_hours) || 0), 0);
    const total_hours = total_work_hours + total_overhead_hours;
    const avg_hourly_rate = total_hours > 0 ? Math.round((total_income / total_hours) * 100) / 100 : 0;
    
    return { total_income, total_work_hours, total_overhead_hours, avg_hourly_rate };
  }, [isV2, localRows]);

  // V2 aggregates
  const v2Aggregates = useMemo(() => {
    if (!isV2) return null;
    return calculateV2Aggregates(localRows);
  }, [isV2, localRows]);

  // Add new row
  const addRow = () => {
    const newRow: Record<string, unknown> = { _id: genId() };
    columns.forEach(col => {
      newRow[col.id] = col.type === 'number' ? 0 : col.type === 'slider' ? 5 : '';
    });
    const newRows = [...localRows, newRow];
    setLocalRows(newRows);
    onRowsChange?.(newRows);
  };

  // Update local row with debounced commit
  const updateLocalRow = (index: number, colId: string, value: unknown) => {
    userEditingRef.current = true;
    setLocalRows(prev => {
      const newRows = [...prev];
      newRows[index] = { ...newRows[index], [colId]: value };
      debouncedCommit(newRows);
      return newRows;
    });
    // Clear validation error for this field
    if (validationErrors.length > 0) {
      setValidationErrors(prev => prev.filter(e => !(e.rowIndex === index && e.field === colId)));
    }
  };

  // Delete row
  const deleteRow = (index: number) => {
    const newRows = localRows.filter((_, i) => i !== index);
    setLocalRows(newRows);
    onRowsChange?.(newRows);
    // Clear errors for deleted row
    setValidationErrors([]);
  };

  // Check if can complete (non-empty rows count)
  const nonEmptyRowCount = useMemo(() => {
    if (isV2) return localRows.filter(r => !isRowEmpty(r)).length;
    return localRows.length;
  }, [isV2, localRows]);
  const canComplete = nonEmptyRowCount >= (content.minRows || 1);

  // Helper: get field error for inline display
  const getFieldError = useCallback((rowIndex: number, fieldId: string): string | undefined => {
    return validationErrors.find(e => e.rowIndex === rowIndex && e.field === fieldId)?.message;
  }, [validationErrors]);

  // Helper: get computed display value (V1 or V2)
  const getComputedDisplay = useCallback((row: Record<string, unknown>, col: DiagnosticTableColumn, rowIndex: number): string => {
    if (isV2 && v2ComputedMap) {
      const computed = v2ComputedMap[rowIndex];
      if (computed) {
        const val = computed[col.id as keyof DiagnosticTableV2Computed];
        if (val === '' || val === undefined) return '—';
        return formatV2Computed(val ?? 0, col.id);
      }
      return '—';
    }
    return String(calculateComputed(row, col));
  }, [isV2, v2ComputedMap, calculateComputed]);

  // Helper: should column be visible for this row?
  const isColumnVisible = useCallback((col: DiagnosticTableColumn, row: Record<string, unknown>): boolean => {
    if (!isV2) return true;
    if (col.condition === 'client_only' && String(row.source_type) !== 'клиент') return false;
    return true;
  }, [isV2]);

  if (isEditing) {
    return (
      <div className="space-y-4">
        {isV2 && (
          <Badge variant="outline" className="bg-teal-500/10 text-teal-600 border-teal-200">
            Диагностическая таблица V2 — Аналитика портфеля
          </Badge>
        )}

        <div className="space-y-2">
          <Label>Заголовок</Label>
          <RichTextarea
            value={content.title || ''}
            onChange={(html) => onChange({ ...content, title: html })}
            placeholder={isV2 ? "Аналитика портфеля клиентов" : "Диагностика точки А"}
            inline
          />
        </div>

        <div className="space-y-2">
          <Label>Инструкция</Label>
          <RichTextarea
            value={content.instruction || ''}
            onChange={(html) => onChange({ ...content, instruction: html })}
            placeholder="Заполните таблицу..."
            minHeight="60px"
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
            {isV2 && (
              <p className="text-xs text-muted-foreground mb-1">
                🔹 Клиентские поля (13–20) видны только для строк с типом «клиент»
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Расширенная настройка колонок будет доступна в следующей версии
            </p>
          </Card>
        )}

        {/* V2: Source lesson ID setting (optional override) */}
        {isV2 && (
          <Card className="p-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Link2 className="h-3.5 w-3.5" />
                Урок-источник (override)
              </Label>
              <p className="text-xs text-muted-foreground">
                Оставьте пустым для автопоиска V1 в текущем модуле (по sort_order)
              </p>
              <Input
                value={sourceLessonInput}
                onChange={(e) => setSourceLessonInput(e.target.value)}
                placeholder="UUID урока (необязательно)"
                className="font-mono text-xs"
              />
              {/* Validation status */}
              {sourceValidation.status === 'idle' && !sourceLessonInput.trim() && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Info className="h-3 w-3" />
                  Автопоиск: V1 будет найден автоматически в этом модуле
                </p>
              )}
              {sourceValidation.status === 'idle' && sourceLessonInput.trim() && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Info className="h-3 w-3" />
                  Проверка формата…
                </p>
              )}
              {sourceValidation.status === 'loading' && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Проверка…
                </p>
              )}
              {sourceValidation.status === 'valid' && (
                <p className="text-xs text-green-600 flex items-center gap-1">
                  <CheckCircle className="h-3 w-3" />
                  Override: {sourceValidation.lessonTitle}
                </p>
              )}
              {sourceValidation.status === 'error_not_found' && (
                <p className="text-xs text-amber-600 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Урок не найден — будет использован автопоиск
                </p>
              )}
              {sourceValidation.status === 'error_no_v1' && (
                <p className="text-xs text-amber-600 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  В «{sourceValidation.lessonTitle}» нет V1 таблицы — будет использован автопоиск
                </p>
              )}
            </div>
          </Card>
        )}

        {/* Preview */}
        <div className="mt-4 border rounded-lg p-4 bg-muted/30">
          <p className="text-sm text-muted-foreground mb-2">Предпросмотр таблицы ({content.layout === 'vertical' ? 'вертикальная' : 'горизонтальная'})</p>
          {(content.layout === 'vertical') ? (
            <Card>
              <CardContent className="py-3 space-y-2">
                {columns.filter(c => !c.condition).map(col => (
                  <div key={col.id} className="flex items-center justify-between gap-4 py-1 border-b last:border-b-0">
                    <span className="text-xs font-medium text-muted-foreground">{col.name}</span>
                    <span className="text-xs">
                      {col.type === 'computed' ? '(авто)' : col.type === 'select' ? (col.options?.[0] || '—') : col.type === 'slider' ? '5' : col.type === 'number' ? '0' : 'Пример'}
                    </span>
                  </div>
                ))}
                {isV2 && (
                  <div className="pt-2 border-t">
                    <p className="text-xs text-muted-foreground italic">+ клиентские поля для строк типа «клиент»</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs whitespace-nowrap w-8">#</TableHead>
                    {columns.filter(c => !c.condition).map(col => (
                      <TableHead key={col.id} className="text-xs whitespace-nowrap">
                        {col.name}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="text-xs text-muted-foreground">1</TableCell>
                    {columns.filter(c => !c.condition).map(col => (
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

  // Effective layout
  const effectiveLayout = content.layout || 'horizontal';

  // V2: Handle complete with inline validation (no toast errors)
  const handleV2Complete = () => {
    flushAndCommit();
    if (isV2) {
      const errors = validateV2Rows(localRows);
      if (errors.length > 0) {
        setValidationErrors(errors);
        return;
      }
      setValidationErrors([]);
    }
    onComplete?.();
  };

  // Render field with optional error highlight
  const renderFieldInput = (
    row: Record<string, unknown>,
    col: DiagnosticTableColumn,
    rowIndex: number,
    compact = false
  ) => {
    const fieldError = getFieldError(rowIndex, col.id);
    const hasError = !!fieldError;
    const inputClass = compact
      ? `h-8 text-xs ${hasError ? 'border-destructive ring-1 ring-destructive/30' : ''}`
      : `h-9 text-sm w-full ${hasError ? 'border-destructive ring-1 ring-destructive/30' : ''}`;

    if (col.type === 'computed') {
      return (
        <Badge variant="secondary" className="font-mono">
          {getComputedDisplay(row, col, rowIndex)}
        </Badge>
      );
    }

    if (col.type === 'select' && col.options) {
      return (
        <div>
          <Select
            value={String(row[col.id] || '')}
            onValueChange={(v) => updateLocalRow(rowIndex, col.id, v)}
            disabled={isCompleted}
          >
            <SelectTrigger className={inputClass}>
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {col.options.map(opt => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasError && <p className="text-xs text-destructive mt-1">{col.name}: обязательное поле</p>}
        </div>
      );
    }

    if (col.type === 'slider') {
      return (
        <div className="flex items-center gap-3">
          <Slider
            value={[Number(row[col.id]) || 5]}
            onValueChange={([v]) => updateLocalRow(rowIndex, col.id, v)}
            min={col.min || 1}
            max={col.max || 10}
            step={1}
            disabled={isCompleted}
            className="flex-1"
          />
          <Badge variant="outline" className="w-8 text-center text-xs shrink-0">
            {String(row[col.id] || 5)}
          </Badge>
        </div>
      );
    }

    // Textarea for long analytical fields (V2)
    if (isV2 && col.type === 'text' && V2_TEXTAREA_FIELD_IDS.has(col.id)) {
      const placeholder = col.id === 'strategic_value'
        ? 'стабильность, перспективность, отрасль, рекомендации, стратегический доступ'
        : '';
      return (
        <div>
          <Textarea
            value={String(row[col.id] || '')}
            onChange={(e) => updateLocalRow(rowIndex, col.id, e.target.value)}
            className={`text-sm min-h-[60px] ${hasError ? 'border-destructive ring-1 ring-destructive/30' : ''}`}
            disabled={isCompleted}
            placeholder={placeholder}
            rows={2}
          />
          {hasError && <p className="text-xs text-destructive mt-1">{col.name}: обязательное поле</p>}
        </div>
      );
    }

    const isMoneyCol = col.id === 'monthly_income' || col.id === 'income';
    const numberPlaceholder = isMoneyCol ? 'например, 1500' : '';

    return (
      <div>
        <Input
          type={col.type === 'number' ? 'number' : 'text'}
          value={String(row[col.id] || '')}
          onChange={(e) => {
            let val: unknown = e.target.value;
            if (col.type === 'number') {
              val = Math.max(0, Number(e.target.value) || 0);
            }
            updateLocalRow(rowIndex, col.id, val);
          }}
          className={inputClass}
          disabled={isCompleted}
          min={col.type === 'number' ? 0 : undefined}
          placeholder={col.type === 'number' ? numberPlaceholder : undefined}
        />
        {hasError && <p className="text-xs text-destructive mt-1">{col.name}: обязательное поле</p>}
      </div>
    );
  };

  // ── V2 SUMMARY MODE: isCompleted && isV2 → clean read-only analytics ──
  if (isV2 && isCompleted && !isEditing) {
    const nonEmptyRows = localRows.filter(r => !isRowEmpty(r));
    const clientRows = nonEmptyRows
      .map((row, idx) => ({ row, origIdx: localRows.indexOf(row) }))
      .filter(({ row }) => String(row.source_type) === 'клиент');
    const totalIncome = v2Aggregates?.total_income || 0;

    return (
      <div className="space-y-4">
        {content.title && (
          <SafeHtml html={content.title!} as="div" className="w-full" />
        )}

        {/* Summary analytics card */}
        {v2Aggregates && nonEmptyRows.length > 0 && (
          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="py-4 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                <div className="text-center">
                  <p className="text-muted-foreground text-xs">Общий доход</p>
                  <p className="font-bold text-lg">{v2Aggregates.total_income.toLocaleString()} BYN / мес</p>
                </div>
                <div className="text-center">
                  <p className="text-muted-foreground text-xs">Общие часы</p>
                  <p className="font-semibold text-lg">{v2Aggregates.total_hours} ч</p>
                </div>
                <div className="text-center bg-primary/10 rounded-lg py-1">
                  <p className="text-muted-foreground text-xs">Средний доход / час</p>
                  <p className="font-bold text-lg text-primary">{v2Aggregates.avg_hourly_income} BYN</p>
                </div>
              </div>

              {/* Category distribution */}
              {Object.keys(v2Aggregates.category_counts).length > 0 && (
                <div className="border-t pt-3">
                  <p className="text-xs text-muted-foreground mb-2">Распределение по категориям</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(v2Aggregates.category_counts).map(([cat, count]) => (
                      <Badge key={cat} className={CATEGORY_COLORS[cat] || 'bg-muted text-muted-foreground'}>
                        {cat}: {count}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Read-only compact table — Desktop */}
        <div className="hidden sm:block">
          <div className="relative overflow-x-auto border rounded-lg">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead className="text-xs py-1.5 w-8">#</TableHead>
                  <TableHead className="text-xs py-1.5">Клиент</TableHead>
                  <TableHead className="text-xs py-1.5">Тип</TableHead>
                  <TableHead className="text-xs py-1.5 text-right">Доход, BYN</TableHead>
                  <TableHead className="text-xs py-1.5 text-right">Часы</TableHead>
                  <TableHead className="text-xs py-1.5 text-right">Доход/час, BYN</TableHead>
                  <TableHead className="text-xs py-1.5 text-right">Доля нагр.</TableHead>
                  <TableHead className="text-xs py-1.5">Категория</TableHead>
                  <TableHead className="text-xs py-1.5">Стр. ценность</TableHead>
                  <TableHead className="text-xs py-1.5">Что изменить</TableHead>
                  <TableHead className="text-xs py-1.5">Решение</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nonEmptyRows.map((row, i) => {
                  const origIdx = localRows.indexOf(row);
                  const computed = v2ComputedMap?.[origIdx];
                  const isClient = String(row.source_type) === 'клиент';
                  const income = Number(row.monthly_income) || 0;
                  const share = totalIncome > 0 ? Math.round((income / totalIncome) * 100) : 0;
                  return (
                    <TableRow key={row._id as string || i}>
                      <TableCell className="text-xs py-1.5 text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="text-xs py-1.5 font-medium max-w-[120px] truncate">{String(row.client || '—')}</TableCell>
                      <TableCell className="text-xs py-1.5">
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">{String(row.source_type || '—')}</Badge>
                      </TableCell>
                      <TableCell className="text-xs py-1.5 text-right font-mono">{income.toLocaleString()}</TableCell>
                      <TableCell className="text-xs py-1.5 text-right">{computed?.total_hours || 0}</TableCell>
                      <TableCell className="text-xs py-1.5 text-right font-mono">{computed?.hourly_income || 0}</TableCell>
                      <TableCell className="text-xs py-1.5 text-right">{isClient && computed ? `${Math.round(computed.load_share * 100)}%` : '—'}</TableCell>
                      <TableCell className="text-xs py-1.5">
                        {isClient && computed?.client_category ? (
                          <Badge className={`text-[10px] px-1.5 py-0 ${CATEGORY_COLORS[computed.client_category] || 'bg-muted text-muted-foreground'}`}>
                            {computed.client_category}
                          </Badge>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-xs py-1.5 max-w-[140px] truncate" title={String(row.strategic_value || '')}>
                        {isClient ? String(row.strategic_value || '—') : '—'}
                      </TableCell>
                      <TableCell className="text-xs py-1.5 max-w-[140px] truncate" title={String(row.what_to_change || '')}>
                        {isClient ? String(row.what_to_change || '—') : '—'}
                      </TableCell>
                      <TableCell className="text-xs py-1.5 max-w-[160px] truncate" title={String(row.management_decision || '')}>
                        {isClient ? String(row.management_decision || '—') : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Read-only cards — Mobile */}
        <div className="sm:hidden space-y-3">
          {nonEmptyRows.map((row, i) => {
            const origIdx = localRows.indexOf(row);
            const computed = v2ComputedMap?.[origIdx];
            const isClient = String(row.source_type) === 'клиент';
            const income = Number(row.monthly_income) || 0;
            return (
              <Card key={row._id as string || i}>
                <CardContent className="py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{String(row.client || '—')}</span>
                    <Badge variant="outline" className="text-[10px]">{String(row.source_type || '—')}</Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div><span className="text-muted-foreground">Доход, BYN:</span> <span className="font-mono">{income.toLocaleString()}</span></div>
                    <div><span className="text-muted-foreground">Часы:</span> {computed?.total_hours || 0}</div>
                    <div><span className="text-muted-foreground">BYN/ч:</span> <span className="font-mono">{computed?.hourly_income || 0}</span></div>
                  </div>
                  {isClient && computed?.client_category && (
                    <Badge className={`text-[10px] ${CATEGORY_COLORS[computed.client_category] || 'bg-muted text-muted-foreground'}`}>
                      {computed.client_category}
                    </Badge>
                  )}
                  {isClient && String(row.management_decision || '') && (
                    <p className="text-xs text-muted-foreground"><span className="font-medium">Решение:</span> {String(row.management_decision)}</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Completed status + edit button */}
        <div className="flex flex-col items-center gap-3 py-2">
          <div className="flex items-center gap-2 text-primary">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-medium">Аналитика завершена</span>
          </div>
          {onReset && (
            <Button
              variant="outline"
              size="sm"
              onClick={onReset}
              className="gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              Редактировать таблицу
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ── EDIT MODE (V1 + V2 not completed) ──
  // Player mode
  return (
    <div className="space-y-4">
      {content.title && (
        <div className="space-y-1">
          <SafeHtml html={content.title!} as="div" className="w-full" />
          {/* Save status indicator */}
          {saveStatus !== 'idle' && (
            <span className={`text-xs flex items-center gap-1 ${
              saveStatus === 'saving' ? 'text-muted-foreground' :
              saveStatus === 'saved' ? 'text-green-600' :
              'text-destructive'
            }`}>
              {saveStatus === 'saving' && <><Loader2 className="h-3 w-3 animate-spin" /> Сохраняется…</>}
              {saveStatus === 'saved' && <><Save className="h-3 w-3" /> Сохранено</>}
              {saveStatus === 'error' && 'Не удалось сохранить'}
            </span>
          )}
        </div>
      )}
      
      {content.instruction && (
        <SafeHtml
          html={content.instruction}
          as="div"
          className="text-sm text-muted-foreground prose prose-sm max-w-none"
        />
      )}

      {/* Currency reminder — все цифры в BYN */}
      <Alert className="border-primary/30 bg-primary/5">
        <Info className="h-4 w-4 text-primary" />
        <AlertDescription className="text-xs">
          Все суммы указывайте в <strong>BYN</strong> (белорусских рублях).
          Если сумма в USD — умножьте на <strong>3</strong> и внесите значение в BYN.
          Если сумма в EUR — используйте курс, указанный в инструкции или администратором.
        </AlertDescription>
      </Alert>

      {/* V2: Summary analytics — ABOVE the rows (edit mode) */}
      {isV2 && content.showAggregates && v2Aggregates && localRows.length > 0 && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="py-3 space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div className="text-center">
                <p className="text-muted-foreground text-xs">Общий доход</p>
                <p className="font-bold text-lg">{v2Aggregates.total_income.toLocaleString()} BYN / мес</p>
              </div>
              <div className="text-center">
                <p className="text-muted-foreground text-xs">Общие часы</p>
                <p className="font-semibold">{v2Aggregates.total_hours} ч</p>
              </div>
              <div className="text-center bg-primary/10 rounded-lg py-1">
                <p className="text-muted-foreground text-xs">Средний доход / час</p>
                <p className="font-bold text-lg text-primary">{v2Aggregates.avg_hourly_income} BYN</p>
              </div>
            </div>

            {/* Compact client table — desktop */}
            {(() => {
              const clientRows = localRows
                .map((row, idx) => ({ row, idx }))
                .filter(({ row }) => String(row.source_type) === 'клиент' && !isRowEmpty(row));
              if (clientRows.length === 0) return null;
              const totalIncome = v2Aggregates.total_income;
              return (
                <div className="border-t pt-3">
                  <p className="text-xs text-muted-foreground mb-2">Обзор клиентов</p>
                  {/* Desktop compact table */}
                  <div className="hidden sm:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs py-1">Клиент</TableHead>
                          <TableHead className="text-xs py-1 text-right">Доход, BYN</TableHead>
                          <TableHead className="text-xs py-1 text-right">Часы</TableHead>
                          <TableHead className="text-xs py-1 text-right">Доля</TableHead>
                          <TableHead className="text-xs py-1">Категория</TableHead>
                          <TableHead className="text-xs py-1">Решение</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {clientRows.map(({ row, idx }) => {
                          const computed = v2ComputedMap?.[idx];
                          const income = Number(row.monthly_income) || 0;
                          const share = totalIncome > 0 ? Math.round((income / totalIncome) * 100) : 0;
                          return (
                            <TableRow key={row._id as string || idx}>
                              <TableCell className="text-xs py-1 font-medium">{String(row.client || '—')}</TableCell>
                              <TableCell className="text-xs py-1 text-right">{income.toLocaleString()}</TableCell>
                              <TableCell className="text-xs py-1 text-right">{computed?.total_hours || 0}</TableCell>
                              <TableCell className="text-xs py-1 text-right">{share}%</TableCell>
                              <TableCell className="text-xs py-1">
                                {computed?.client_category && (
                                  <Badge className={`text-[10px] px-1.5 py-0 ${CATEGORY_COLORS[computed.client_category] || 'bg-muted text-muted-foreground'}`}>
                                    {computed.client_category}
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-xs py-1 max-w-[200px] truncate">{String(row.management_decision || '—')}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  {/* Mobile: category badges only */}
                  <div className="sm:hidden flex flex-wrap gap-2">
                    {Object.entries(v2Aggregates.category_counts).map(([cat, count]) => (
                      <Badge key={cat} className={CATEGORY_COLORS[cat] || 'bg-muted text-muted-foreground'}>
                        {cat}: {count}
                      </Badge>
                    ))}
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* Inline validation summary — calm, no toast */}
      {validationErrors.length > 0 && (
        <Alert variant="default" className="border-amber-300 bg-amber-50 dark:bg-amber-950/30">
          <AlertCircle className="h-4 w-4 text-amber-600" />
          <AlertDescription>
            <p className="font-medium text-sm mb-1">Что нужно заполнить:</p>
            <ul className="text-xs space-y-0.5">
              {validationErrors.map((err, i) => (
                <li key={i}>• {err.message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Vertical card layout — always on mobile, optional on desktop */}
      <div className={effectiveLayout === 'vertical' ? 'block' : 'block sm:hidden'}>
        <div className="space-y-3">
          {localRows.map((row, rowIndex) => (
            <Card key={row._id as string || rowIndex} className={isRowEmpty(row) && isV2 ? 'opacity-60' : ''}>
              <CardContent className="py-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Строка {rowIndex + 1}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteRow(rowIndex)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
                {columns.map(col => {
                  if (!isColumnVisible(col, row)) return null;
                  return (
                    <div key={col.id} className="space-y-1">
                      <Label className="text-xs">
                        {col.name}
                        {col.required && <span className="text-destructive ml-1">*</span>}
                      </Label>
                      <div className="w-full">
                        {renderFieldInput(row, col, rowIndex)}
                      </div>
                    </div>
                  );
                })}
                {/* V2: Show client category badge */}
                {isV2 && String(row.source_type) === 'клиент' && v2ComputedMap?.[rowIndex] && v2ComputedMap[rowIndex].client_category && (
                  <div className="pt-2 border-t">
                    <Badge className={CATEGORY_COLORS[v2ComputedMap[rowIndex].client_category] || 'bg-muted text-muted-foreground'}>
                      {v2ComputedMap[rowIndex].client_category}
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Horizontal table layout */}
      {effectiveLayout !== 'vertical' && (
        <div className="hidden sm:block">
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
                <TableRow key={row._id as string || rowIndex} className={isRowEmpty(row) && isV2 ? 'opacity-60' : ''}>
                  <TableCell className="text-muted-foreground">{rowIndex + 1}</TableCell>
                  {columns.map(col => {
                    if (!isColumnVisible(col, row)) {
                      return (
                        <TableCell key={col.id} className="p-1">
                          <span className="text-muted-foreground text-xs">—</span>
                        </TableCell>
                      );
                    }
                    return (
                      <TableCell key={col.id} className="p-1">
                        {renderFieldInput(row, col, rowIndex, true)}
                      </TableCell>
                    );
                  })}
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteRow(rowIndex)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </div>
      )}

      <Button variant="outline" onClick={addRow} className="w-full">
        <Plus className="h-4 w-4 mr-2" />
        Добавить строку
      </Button>

      {/* V1: Aggregates */}
      {!isV2 && content.showAggregates && totalAggregates && localRows.length > 0 && (
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
      <Button
        onClick={handleV2Complete}
        disabled={!canComplete}
        variant="default"
        className="w-full"
      >
        <CheckCircle2 className="h-4 w-4 mr-2" />
        {content.submitButtonText || 'Диагностика завершена'}
      </Button>

      {!canComplete && (
        <p className="text-center text-sm text-muted-foreground">
          Добавьте минимум {content.minRows || 1} {(content.minRows || 1) === 1 ? 'строку' : 'строки'} для продолжения
        </p>
      )}
    </div>
  );
}
