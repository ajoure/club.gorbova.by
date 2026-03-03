import { useState, useCallback, useRef } from "react";
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
  Loader2, X, Play, Eye
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { assertExcelAllowedOrThrow } from "@/lib/iosPreviewHardStops";
import { normalizeGCName } from "@/lib/nameUtils";

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

interface CountsChunk {
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
}

interface ChunkResponse {
  success: boolean;
  mode: string;
  batch_id: string;
  chunk: { index: number; total: number };
  counts_chunk: CountsChunk;
  aborted: boolean;
  preview: RowResult[];
  conflicts: RowResult[];
  error?: string;
}

// Header auto-detection
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

function sumCounts(a: CountsChunk, b: CountsChunk): CountsChunk {
  return {
    total: a.total + b.total,
    filtered_out: a.filtered_out + b.filtered_out,
    invalid: a.invalid + b.invalid,
    will_create: a.will_create + b.will_create,
    will_update: a.will_update + b.will_update,
    will_skip_active: a.will_skip_active + b.will_skip_active,
    will_skip_exists: a.will_skip_exists + b.will_skip_exists,
    conflicts: a.conflicts + b.conflicts,
    errors: a.errors + b.errors,
    created: a.created + b.created,
    updated: a.updated + b.updated,
  };
}

const EMPTY_COUNTS: CountsChunk = {
  total: 0, filtered_out: 0, invalid: 0, will_create: 0, will_update: 0,
  will_skip_active: 0, will_skip_exists: 0, conflicts: 0, errors: 0, created: 0, updated: 0,
};

const DRY_RUN_CHUNK_SIZE = 2000;
const EXECUTE_CHUNK_SIZE = 1000;

type Step = 'upload' | 'mapping' | 'dry_run' | 'execute' | 'done';

export function GetCourseContactsImportDialog({ open, onOpenChange, onSuccess }: GetCourseContactsImportDialogProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('upload');
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState('');
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [headerMapping, setHeaderMapping] = useState<Record<string, keyof ParsedRow | null>>({});
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [totalCounts, setTotalCounts] = useState<CountsChunk>(EMPTY_COUNTS);
  const [previewRows, setPreviewRows] = useState<RowResult[]>([]);
  const [conflictRows, setConflictRows] = useState<RowResult[]>([]);
  const [conflictsOverride, setConflictsOverride] = useState(false);
  const [batchId, setBatchId] = useState('');
  const [chunkProgress, setChunkProgress] = useState<{ current: number; total: number } | null>(null);
  const [abortedAtChunk, setAbortedAtChunk] = useState<number | null>(null);
  const abortRef = useRef(false);

  const reset = useCallback(() => {
    setStep('upload');
    setLoading(false);
    setFileName('');
    setRawHeaders([]);
    setHeaderMapping({});
    setParsedRows([]);
    setTotalCounts(EMPTY_COUNTS);
    setPreviewRows([]);
    setConflictRows([]);
    setConflictsOverride(false);
    setBatchId('');
    setChunkProgress(null);
    setAbortedAtChunk(null);
    abortRef.current = false;
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

      const headers = Object.keys(json[0]);
      setRawHeaders(headers);

      const mapping: Record<string, keyof ParsedRow | null> = {};
      for (const h of headers) {
        mapping[h] = detectField(h);
      }
      setHeaderMapping(mapping);

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
        // Нормализация имён из GetCourse (дедуп, порядок first/last)
        const normalized = normalizeGCName({
          first_name: parsed.first_name,
          last_name: parsed.last_name,
          full_name: parsed.full_name,
        });
        parsed.first_name = normalized.first_name || parsed.first_name;
        parsed.last_name = normalized.last_name || parsed.last_name;
        parsed.full_name = normalized.full_name || parsed.full_name;
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

  // ── Chunk sender ──
  const sendChunks = useCallback(async (
    mode: 'dry_run' | 'execute',
    currentBatchId: string,
    allRows: ParsedRow[],
    chunkSize: number,
  ): Promise<{ totals: CountsChunk; preview: RowResult[]; conflicts: RowResult[]; abortedChunk: number | null }> => {
    const totalChunks = Math.ceil(allRows.length / chunkSize);
    let aggregatedCounts = { ...EMPTY_COUNTS };
    const allPreview: RowResult[] = [];
    const allConflicts: RowResult[] = [];
    let abortedChunk: number | null = null;

    for (let i = 0; i < totalChunks; i++) {
      if (abortRef.current) {
        abortedChunk = i;
        break;
      }

      const chunkRows = allRows.slice(i * chunkSize, (i + 1) * chunkSize);
      setChunkProgress({ current: i + 1, total: totalChunks });

      const body: Record<string, unknown> = {
        mode,
        batch_id: currentBatchId,
        rows: chunkRows,
        chunk: { index: i, total: totalChunks },
      };

      const { data, error } = await supabase.functions.invoke('import-contacts-gc', { body });

      if (error) throw new Error(`Чанк ${i + 1}/${totalChunks}: ${error.message}`);
      
      const resp = data as ChunkResponse;
      if (!resp?.success) throw new Error(resp?.error || `Ошибка в чанке ${i + 1}`);

      aggregatedCounts = sumCounts(aggregatedCounts, resp.counts_chunk);

      // Collect preview (first 200 total) and conflicts (first 100)
      if (allPreview.length < 200) {
        const offset = i * chunkSize;
        const adjusted = resp.preview.map(r => ({ ...r, row_index: r.row_index + offset }));
        allPreview.push(...adjusted.slice(0, 200 - allPreview.length));
      }
      if (allConflicts.length < 100) {
        const offset = i * chunkSize;
        const adjusted = resp.conflicts.map(r => ({ ...r, row_index: r.row_index + offset }));
        allConflicts.push(...adjusted.slice(0, 100 - allConflicts.length));
      }

      // Check abort conditions for execute
      if (mode === 'execute' && resp.aborted) {
        abortedChunk = i;
        break;
      }
    }

    return { totals: aggregatedCounts, preview: allPreview, conflicts: allConflicts, abortedChunk };
  }, []);

  // ── Step 2: Dry Run ──
  const handleDryRun = useCallback(async () => {
    setLoading(true);
    abortRef.current = false;
    try {
      const newBatchId = crypto.randomUUID();
      setBatchId(newBatchId);

      const result = await sendChunks('dry_run', newBatchId, parsedRows, DRY_RUN_CHUNK_SIZE);

      setTotalCounts(result.totals);
      setPreviewRows(result.preview);
      setConflictRows(result.conflicts);
      setStep('dry_run');
    } catch (err: any) {
      toast.error(`Ошибка preview: ${err.message}`);
    } finally {
      setLoading(false);
      setChunkProgress(null);
    }
  }, [parsedRows, sendChunks]);

  // ── Step 3: Execute ──
  const handleExecute = useCallback(async () => {
    if (totalCounts.conflicts > 0 && !conflictsOverride) {
      toast.error('Есть конфликты. Отметьте чекбокс для подтверждения.');
      return;
    }

    setLoading(true);
    abortRef.current = false;
    setAbortedAtChunk(null);
    try {
      const result = await sendChunks('execute', batchId, parsedRows, EXECUTE_CHUNK_SIZE);

      setTotalCounts(result.totals);
      setAbortedAtChunk(result.abortedChunk);

      // ── Finalize: write audit log with accurate totals ──
      try {
        await supabase.functions.invoke('import-contacts-gc', {
          body: {
            mode: 'finalize',
            batch_id: batchId,
            rows: [],
            chunk: { index: 0, total: 1 },
            batch_totals: {
              total: result.totals.total,
              created: result.totals.created,
              updated: result.totals.updated,
              filtered_out: result.totals.filtered_out,
              invalid: result.totals.invalid,
              conflicts: result.totals.conflicts,
              errors: result.totals.errors,
              skipped_active: result.totals.will_skip_active,
              skipped_no_changes: result.totals.will_skip_exists,
            },
          },
        });
      } catch (finalizeErr: any) {
        console.error('[GC Import] Finalize audit error:', finalizeErr);
        toast.error('Audit finalize failed — импорт выполнен, но лог не записан');
      }

      setStep('done');
      
      if (result.abortedChunk !== null) {
        toast.error(`Импорт прерван на чанке ${result.abortedChunk + 1}: превышен порог ошибок`);
      } else {
        toast.success(`Импорт завершён: создано ${result.totals.created}, обновлено ${result.totals.updated}`);
      }
      
      queryClient.invalidateQueries({ queryKey: ["admin-contacts"] });
      onSuccess?.();
    } catch (err: any) {
      toast.error(`Ошибка: ${err.message}`);
    } finally {
      setLoading(false);
      setChunkProgress(null);
    }
  }, [totalCounts, conflictsOverride, batchId, parsedRows, queryClient, onSuccess, sendChunks]);

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

  const progressPercent = chunkProgress ? Math.round((chunkProgress.current / chunkProgress.total) * 100) : 0;

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

          {/* ── PROGRESS (during dry_run/execute loading) ── */}
          {loading && chunkProgress && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Чанк {chunkProgress.current} / {chunkProgress.total}</span>
                <span>{progressPercent}%</span>
              </div>
              <Progress value={progressPercent} className="h-2" />
            </div>
          )}

          {/* ── DRY RUN RESULTS ── */}
          {step === 'dry_run' && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-md border bg-card">
                  <div className="text-2xl font-bold">{totalCounts.total}</div>
                  <div className="text-xs text-muted-foreground">Всего строк</div>
                </div>
                <div className="p-3 rounded-md border bg-card">
                  <div className="text-2xl font-bold text-green-600">{totalCounts.will_create}</div>
                  <div className="text-xs text-muted-foreground">Будет создано</div>
                </div>
                <div className="p-3 rounded-md border bg-card">
                  <div className="text-2xl font-bold text-blue-600">{totalCounts.will_update}</div>
                  <div className="text-xs text-muted-foreground">Будет обновлено</div>
                </div>
                <div className="p-3 rounded-md border bg-card">
                  <div className="text-2xl font-bold">{totalCounts.will_skip_active + totalCounts.will_skip_exists}</div>
                  <div className="text-xs text-muted-foreground">Пропущено</div>
                </div>
              </div>

              {totalCounts.conflicts > 0 && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Найдено {totalCounts.conflicts} конфликтов.
                    Конфликтные строки не будут импортированы.
                  </AlertDescription>
                </Alert>
              )}

              {totalCounts.filtered_out > 0 && (
                <Alert>
                  <AlertDescription>
                    Исключено фильтрами: {totalCounts.filtered_out}
                  </AlertDescription>
                </Alert>
              )}

              {totalCounts.invalid > 0 && (
                <Alert>
                  <AlertDescription>
                    Невалидных строк (нет ID/email/phone): {totalCounts.invalid}
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
                    {previewRows.map((r) => (
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

              {totalCounts.conflicts > 0 && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="conflicts-override"
                    checked={conflictsOverride}
                    onCheckedChange={(v) => setConflictsOverride(v === true)}
                  />
                  <Label htmlFor="conflicts-override" className="text-sm">
                    Я понимаю: {totalCounts.conflicts} конфликтных строк будут пропущены. Продолжить импорт.
                  </Label>
                </div>
              )}
            </>
          )}

          {/* ── DONE ── */}
          {step === 'done' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                {abortedAtChunk !== null ? (
                  <>
                    <AlertCircle className="w-8 h-8 text-destructive" />
                    <div>
                      <div className="font-semibold">Импорт прерван</div>
                      <div className="text-sm text-muted-foreground">
                        Остановлен на чанке {abortedAtChunk + 1}: превышен порог ошибок. Batch: {batchId}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-8 h-8 text-green-500" />
                    <div>
                      <div className="font-semibold">Импорт завершён</div>
                      <div className="text-sm text-muted-foreground">Batch: {batchId}</div>
                    </div>
                  </>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-md border bg-card">
                  <div className="text-2xl font-bold text-green-600">{totalCounts.created}</div>
                  <div className="text-xs text-muted-foreground">Создано</div>
                </div>
                <div className="p-3 rounded-md border bg-card">
                  <div className="text-2xl font-bold text-blue-600">{totalCounts.updated}</div>
                  <div className="text-xs text-muted-foreground">Обновлено</div>
                </div>
                <div className="p-3 rounded-md border bg-card">
                  <div className="text-2xl font-bold">{totalCounts.will_skip_active + totalCounts.will_skip_exists}</div>
                  <div className="text-xs text-muted-foreground">Пропущено</div>
                </div>
                <div className="p-3 rounded-md border bg-card">
                  <div className="text-2xl font-bold text-destructive">{totalCounts.errors}</div>
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
                disabled={loading || (totalCounts.conflicts > 0 && !conflictsOverride)}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}
                Импортировать ({totalCounts.will_create} создать, {totalCounts.will_update} обновить)
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
