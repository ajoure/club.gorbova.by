import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Upload, FileSpreadsheet, AlertCircle, CheckCircle2,
  Loader2, X, ArrowRight, Play, Eye
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { assertExcelAllowedOrThrow } from "@/lib/iosPreviewHardStops";

interface GetCourseContactsImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface ParsedRow {
  gc_user_id?: string;
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  tg_id?: string;
  tg_username?: string;
  country?: string;
  city?: string;
  birth_date?: string;
  instagram_url?: string;
  gc_registered_at?: string;
}

interface RowResult {
  row_index: number;
  email?: string;
  name?: string;
  action: 'create' | 'update' | 'skip' | 'conflict' | 'filtered' | 'invalid';
  reason?: string;
  profile_id?: string;
}

interface ImportResponse {
  success: boolean;
  mode: string;
  batch_id: string;
  counts: {
    total: number;
    filtered_out: number;
    invalid: number;
    will_create: number;
    will_update: number;
    will_skip_active: number;
    will_skip_exists: number;
    conflicts: number;
    errors: number;
    created: number;
    updated: number;
  };
  truncated: boolean;
  preview: RowResult[];
  conflicts: RowResult[];
}

// Header auto-detection mapping
const HEADER_MAP: Record<string, keyof ParsedRow> = {};
const HEADER_PATTERNS: { patterns: RegExp[]; field: keyof ParsedRow }[] = [
  { patterns: [/^id$/i, /^ID$/i, /^user_id$/i, /^ID пользователя$/i], field: 'gc_user_id' },
  { patterns: [/^e-?mail$/i], field: 'email' },
  { patterns: [/^телефон$/i, /^phone$/i], field: 'phone' },
  { patterns: [/^имя$/i, /^first\s*name$/i], field: 'first_name' },
  { patterns: [/^фамилия$/i, /^last\s*name$/i], field: 'last_name' },
  { patterns: [/^фио$/i, /^full\s*name$/i], field: 'full_name' },
  { patterns: [/^tg_id$/i, /^telegram_id$/i], field: 'tg_id' },
  { patterns: [/^tg_nickname$/i, /^telegram_username$/i, /^ник\s*телеграм/i], field: 'tg_username' },
  { patterns: [/^страна$/i, /^country$/i], field: 'country' },
  { patterns: [/^город$/i, /^city$/i], field: 'city' },
  { patterns: [/^дата\s*рождения$/i, /^birth\s*date$/i], field: 'birth_date' },
  { patterns: [/^instagram$/i, /^инстаграм$/i], field: 'instagram_url' },
  { patterns: [/^дата\s*регистрации$/i, /^registration\s*date$/i, /^registered$/i], field: 'gc_registered_at' },
];

function detectField(header: string): keyof ParsedRow | null {
  const trimmed = header.trim();
  for (const { patterns, field } of HEADER_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(trimmed)) return field;
    }
  }
  return null;
}

type Step = 'upload' | 'mapping' | 'dry_run' | 'execute' | 'done';

export function GetCourseContactsImportDialog({ open, onOpenChange, onSuccess }: GetCourseContactsImportDialogProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('upload');
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState('');
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [headerMapping, setHeaderMapping] = useState<Record<string, keyof ParsedRow | null>>({});
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [dryRunResult, setDryRunResult] = useState<ImportResponse | null>(null);
  const [executeResult, setExecuteResult] = useState<ImportResponse | null>(null);
  const [conflictsOverride, setConflictsOverride] = useState(false);
  const [batchId, setBatchId] = useState('');

  const reset = useCallback(() => {
    setStep('upload');
    setLoading(false);
    setFileName('');
    setRawHeaders([]);
    setHeaderMapping({});
    setParsedRows([]);
    setDryRunResult(null);
    setExecuteResult(null);
    setConflictsOverride(false);
    setBatchId('');
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onOpenChange(false);
  }, [reset, onOpenChange]);

  // ── Step 1: Upload & Parse ──
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      assertExcelAllowedOrThrow();
    } catch (err: any) {
      toast.error(err.message);
      return;
    }

    setLoading(true);
    setFileName(file.name);

    try {
      const XLSX = await import("xlsx");
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

      if (json.length === 0) {
        toast.error("Файл пустой");
        setLoading(false);
        return;
      }

      // Auto-detect headers
      const headers = Object.keys(json[0]);
      setRawHeaders(headers);

      const mapping: Record<string, keyof ParsedRow | null> = {};
      for (const h of headers) {
        mapping[h] = detectField(h);
      }
      setHeaderMapping(mapping);

      // Parse rows using detected mapping
      const rows: ParsedRow[] = json.map(row => {
        const parsed: ParsedRow = {};
        for (const [header, field] of Object.entries(mapping)) {
          if (field && row[header] != null) {
            const val = String(row[header]).trim();
            if (val) {
              (parsed as any)[field] = val;
            }
          }
        }
        return parsed;
      });

      setParsedRows(rows);
      setStep('mapping');
      toast.success(`Загружено ${rows.length} строк из ${file.name}`);
    } catch (err: any) {
      toast.error(`Ошибка парсинга: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Step 2: Confirm mapping → dry run ──
  const handleDryRun = useCallback(async () => {
    setLoading(true);
    try {
      const newBatchId = crypto.randomUUID();
      setBatchId(newBatchId);

      const { data, error } = await supabase.functions.invoke('import-contacts-gc', {
        body: { mode: 'dry_run', batch_id: newBatchId, rows: parsedRows },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Ошибка dry-run');

      setDryRunResult(data as ImportResponse);
      setStep('dry_run');
    } catch (err: any) {
      toast.error(`Ошибка preview: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [parsedRows]);

  // ── Step 3: Execute ──
  const handleExecute = useCallback(async () => {
    if (!dryRunResult) return;
    if (dryRunResult.counts.conflicts > 0 && !conflictsOverride) {
      toast.error('Есть конфликты. Отметьте чекбокс для подтверждения или устраните конфликты.');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('import-contacts-gc', {
        body: { mode: 'execute', batch_id: batchId, rows: parsedRows },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Ошибка импорта');

      setExecuteResult(data as ImportResponse);
      setStep('done');
      toast.success(`Импорт завершён: создано ${data.counts.created}, обновлено ${data.counts.updated}`);
      queryClient.invalidateQueries({ queryKey: ["admin-contacts"] });
      onSuccess?.();
    } catch (err: any) {
      toast.error(`Ошибка: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [dryRunResult, conflictsOverride, batchId, parsedRows, queryClient, onSuccess]);

  const actionBadge = (action: string) => {
    switch (action) {
      case 'create': return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Создать</Badge>;
      case 'update': return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">Обновить</Badge>;
      case 'skip': return <Badge variant="secondary">Пропустить</Badge>;
      case 'conflict': return <Badge variant="destructive">Конфликт</Badge>;
      case 'filtered': return <Badge variant="outline">Исключён</Badge>;
      case 'invalid': return <Badge variant="outline">Невалидный</Badge>;
      default: return <Badge variant="outline">{action}</Badge>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else onOpenChange(v); }}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5" />
            Импорт контактов GetCourse
          </DialogTitle>
          <DialogDescription>
            {step === 'upload' && 'Загрузите файл «Все пользователи» из GetCourse (XLSX или CSV)'}
            {step === 'mapping' && `Файл: ${fileName} • ${parsedRows.length} строк • Проверьте маппинг колонок`}
            {step === 'dry_run' && 'Предпросмотр: проверьте результат перед импортом'}
            {step === 'execute' && 'Выполняется импорт...'}
            {step === 'done' && 'Импорт завершён'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          {/* ── UPLOAD ── */}
          {step === 'upload' && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Upload className="w-12 h-12 text-muted-foreground" />
              <p className="text-muted-foreground text-sm text-center">
                Поддерживаются файлы .xlsx и .csv<br />
                Экспорт «Все пользователи» из GetCourse
              </p>
              <label>
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileUpload} />
                <Button asChild disabled={loading}>
                  <span>
                    {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
                    Выбрать файл
                  </span>
                </Button>
              </label>
            </div>
          )}

          {/* ── MAPPING ── */}
          {step === 'mapping' && (
            <>
              <Alert>
                <AlertDescription>
                  Найдено {rawHeaders.length} колонок. Автоматически распознано: {Object.values(headerMapping).filter(Boolean).length}.
                  Нераспознанные колонки будут проигнорированы.
                </AlertDescription>
              </Alert>

              <ScrollArea className="h-[300px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Колонка в файле</TableHead>
                      <TableHead>→ Поле в системе</TableHead>
                      <TableHead>Пример</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rawHeaders.map(h => (
                      <TableRow key={h}>
                        <TableCell className="font-medium text-xs">{h}</TableCell>
                        <TableCell>
                          {headerMapping[h] ? (
                            <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                              {headerMapping[h]}
                            </Badge>
                          ) : (
                            <Badge variant="outline">—</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                          {parsedRows[0] && headerMapping[h] ? String((parsedRows[0] as any)[headerMapping[h]!] || '—') : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </>
          )}

          {/* ── DRY RUN RESULTS ── */}
          {step === 'dry_run' && dryRunResult && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-md border bg-card">
                  <div className="text-2xl font-bold">{dryRunResult.counts.total}</div>
                  <div className="text-xs text-muted-foreground">Всего строк</div>
                </div>
                <div className="p-3 rounded-md border bg-card">
                  <div className="text-2xl font-bold text-green-600">{dryRunResult.counts.will_create}</div>
                  <div className="text-xs text-muted-foreground">Будет создано</div>
                </div>
                <div className="p-3 rounded-md border bg-card">
                  <div className="text-2xl font-bold text-blue-600">{dryRunResult.counts.will_update}</div>
                  <div className="text-xs text-muted-foreground">Будет обновлено</div>
                </div>
                <div className="p-3 rounded-md border bg-card">
                  <div className="text-2xl font-bold">{dryRunResult.counts.will_skip_active + dryRunResult.counts.will_skip_exists}</div>
                  <div className="text-xs text-muted-foreground">Пропущено</div>
                </div>
              </div>

              {dryRunResult.counts.conflicts > 0 && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Найдено {dryRunResult.counts.conflicts} конфликтов.
                    Конфликтные строки не будут импортированы.
                  </AlertDescription>
                </Alert>
              )}

              {dryRunResult.counts.filtered_out > 0 && (
                <Alert>
                  <AlertDescription>
                    Исключено фильтрами: {dryRunResult.counts.filtered_out}
                  </AlertDescription>
                </Alert>
              )}

              <ScrollArea className="h-[300px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Имя</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Действие</TableHead>
                      <TableHead>Детали</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dryRunResult.preview.map((r) => (
                      <TableRow key={r.row_index}>
                        <TableCell className="text-xs">{r.row_index + 1}</TableCell>
                        <TableCell className="text-xs">{r.name || '—'}</TableCell>
                        <TableCell className="text-xs">{r.email || '—'}</TableCell>
                        <TableCell>{actionBadge(r.action)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.reason || ''}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>

              {dryRunResult.counts.conflicts > 0 && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="conflicts-override"
                    checked={conflictsOverride}
                    onCheckedChange={(v) => setConflictsOverride(v === true)}
                  />
                  <Label htmlFor="conflicts-override" className="text-sm">
                    Я понимаю: {dryRunResult.counts.conflicts} конфликтных строк будут пропущены. Продолжить импорт.
                  </Label>
                </div>
              )}
            </>
          )}

          {/* ── DONE ── */}
          {step === 'done' && executeResult && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-8 h-8 text-green-500" />
                <div>
                  <div className="font-semibold">Импорт завершён</div>
                  <div className="text-sm text-muted-foreground">Batch: {executeResult.batch_id}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-md border bg-card">
                  <div className="text-2xl font-bold text-green-600">{executeResult.counts.created}</div>
                  <div className="text-xs text-muted-foreground">Создано</div>
                </div>
                <div className="p-3 rounded-md border bg-card">
                  <div className="text-2xl font-bold text-blue-600">{executeResult.counts.updated}</div>
                  <div className="text-xs text-muted-foreground">Обновлено</div>
                </div>
                <div className="p-3 rounded-md border bg-card">
                  <div className="text-2xl font-bold">{executeResult.counts.will_skip_active + executeResult.counts.will_skip_exists}</div>
                  <div className="text-xs text-muted-foreground">Пропущено</div>
                </div>
                <div className="p-3 rounded-md border bg-card">
                  <div className="text-2xl font-bold text-destructive">{executeResult.counts.errors}</div>
                  <div className="text-xs text-muted-foreground">Ошибки</div>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {step === 'mapping' && (
            <>
              <Button variant="outline" onClick={reset}>
                <X className="w-4 h-4 mr-2" />
                Сбросить
              </Button>
              <Button onClick={handleDryRun} disabled={loading || parsedRows.length === 0}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
                Предпросмотр (Dry Run)
              </Button>
            </>
          )}

          {step === 'dry_run' && (
            <>
              <Button variant="outline" onClick={reset}>
                <X className="w-4 h-4 mr-2" />
                Начать заново
              </Button>
              <Button
                onClick={handleExecute}
                disabled={loading || (dryRunResult?.counts.conflicts ?? 0) > 0 && !conflictsOverride}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}
                Импортировать ({dryRunResult?.counts.will_create ?? 0} создать, {dryRunResult?.counts.will_update ?? 0} обновить)
              </Button>
            </>
          )}

          {step === 'done' && (
            <Button onClick={handleClose}>
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Закрыть
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
