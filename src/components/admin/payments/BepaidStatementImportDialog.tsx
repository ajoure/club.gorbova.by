import { useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2, Info, Eye, Play, X, FileSpreadsheet } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

const MAX_FILE_SIZE_MB = 10;

interface FileStats {
  name: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
}

interface TotalsExpected {
  expected_count?: number;
  expected_amount?: number;
  source_file?: string;
}

interface ImportStats {
  total_files: number;
  per_file: FileStats[];
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  invalid_rate: number;
  duplicates_merged: number;
  uids_unique: number;
  total_amount?: number;
}

interface DryRunResponse {
  success: boolean;
  mode: 'dry_run';
  build_id: string;
  stats: ImportStats;
  totals_expected?: TotalsExpected;
  sample_errors?: Array<{ row: number; file?: string; reason: string }>;
  sample_parsed?: Array<{ uid: string; amount: number; status: string; paid_at: string }>;
  // PATCH-6: explain_mismatch for diagnosing count differences
  explain_mismatch?: Array<{ uid: string; reason: string }>;
}

interface ExecuteResponse {
  success: boolean;
  mode: 'execute' | 'execute_blocked';
  build_id: string;
  stats: ImportStats;
  totals_expected?: TotalsExpected;
  upserted?: number;
  errors?: number;
  error?: string;
  error_details?: string[];
  sample_errors?: Array<{ row: number; file?: string; reason: string }>;
}

interface BepaidStatementImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BepaidStatementImportDialog({ open, onOpenChange }: BepaidStatementImportDialogProps) {
  // PATCH-3: Multi-file state
  const [files, setFiles] = useState<File[]>([]);
  const [csvTexts, setCsvTexts] = useState<Array<{ name: string; text: string }>>([]);
  const [parseStatus, setParseStatus] = useState<'idle' | 'reading' | 'ready' | 'error'>('idle');
  const [parseError, setParseError] = useState<string | null>(null);
  
  const [dryRunResult, setDryRunResult] = useState<DryRunResponse | null>(null);
  const [importResult, setImportResult] = useState<ExecuteResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  const queryClient = useQueryClient();

  // PATCH-3: Multi-file handler
  const handleFilesChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length === 0) return;
    
    // STOP-guard: file size limit for each file
    for (const file of selectedFiles) {
      const fileSizeMB = file.size / (1024 * 1024);
      if (fileSizeMB > MAX_FILE_SIZE_MB) {
        setParseStatus('error');
        setParseError(`Файл "${file.name}" слишком большой (${fileSizeMB.toFixed(1)} MB). Максимум: ${MAX_FILE_SIZE_MB} MB.`);
        return;
      }
    }
    
    setFiles(selectedFiles);
    setParseStatus('reading');
    setParseError(null);
    setCsvTexts([]);
    setDryRunResult(null);
    setImportResult(null);
    
    try {
      // Read all files
      const texts: Array<{ name: string; text: string }> = [];
      
      for (const file of selectedFiles) {
        const text = await file.text();
        
        if (!text.trim()) {
          setParseStatus('error');
          setParseError(`Файл "${file.name}" пуст`);
          return;
        }
        
        texts.push({ name: file.name, text });
      }
      
      // Validate at least one file has UID column (skip totals files)
      const dataFiles = texts.filter(f => !isTotalsFile(f.name));
      if (dataFiles.length > 0) {
        let hasUid = false;
        for (const f of dataFiles) {
          const firstLine = f.text.split(/\r?\n/)[0]?.toLowerCase() || '';
          if (firstLine.includes('uid')) {
            hasUid = true;
            break;
          }
        }
        if (!hasUid) {
          setParseStatus('error');
          setParseError('Ни один файл данных не содержит столбец UID. Убедитесь, что это выписка bePaid.');
          return;
        }
      }
      
      setCsvTexts(texts);
      setParseStatus('ready');
      
    } catch (err) {
      console.error('File read error:', err);
      setParseStatus('error');
      setParseError(`Ошибка чтения файла: ${err instanceof Error ? err.message : 'Неизвестная ошибка'}`);
    }
  }, []);

  // PATCH-4: Detect Totals CSV by filename
  const isTotalsFile = (name: string): boolean => {
    const lower = name.toLowerCase();
    return lower.includes('total') || lower.includes('итог') || lower.includes('summary');
  };

  const handleDryRun = async () => {
    if (csvTexts.length === 0) return;
    
    setIsLoading(true);
    setDryRunResult(null);
    setImportResult(null);
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Не авторизован');
      }
      
      const response = await supabase.functions.invoke('admin-import-bepaid-statement-csv', {
        body: {
          dry_run: true,
          source: 'bepaid_csv',
          csv_texts: csvTexts, // PATCH-3: Array of files
          limit: 5000,
        },
      });
      
      if (response.error) {
        throw new Error(response.error.message);
      }
      
      const result = response.data as DryRunResponse;
      setDryRunResult(result);
      
      if (result.success) {
        toast({
          title: "Проверка завершена",
          description: `Готово к импорту: ${result.stats.uids_unique} уникальных строк из ${result.stats.total_files} файлов`,
        });
      }
      
    } catch (err) {
      console.error('Dry run error:', err);
      toast({
        title: "Ошибка проверки",
        description: err instanceof Error ? err.message : 'Неизвестная ошибка',
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleExecute = async () => {
    if (csvTexts.length === 0 || !dryRunResult?.success) return;
    
    setIsLoading(true);
    setImportResult(null);
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Не авторизован');
      }
      
      const response = await supabase.functions.invoke('admin-import-bepaid-statement-csv', {
        body: {
          dry_run: false,
          source: 'bepaid_csv',
          csv_texts: csvTexts, // PATCH-3: Array of files
          limit: 5000,
        },
      });
      
      if (response.error) {
        throw new Error(response.error.message);
      }
      
      const result = response.data as ExecuteResponse;
      setImportResult(result);
      
      if (result.success) {
        toast({
          title: "Импорт завершён",
          description: `Импортировано: ${result.upserted ?? 0}, ошибок: ${result.errors || 0}`,
        });
        
        // PATCH-1: Correct React Query refresh with unified predicate
        const predicate = (query: { queryKey: readonly unknown[] }) => {
          const key = String(query.queryKey?.[0] ?? '');
          return key.startsWith('bepaid-statement');
        };
        
        // 1. Invalidate all related queries (mark stale)
        queryClient.invalidateQueries({ predicate });
        
        // 2. Remove all paginated queries (reset infinite cursor)
        queryClient.removeQueries({ predicate });
        
        // 3. Refetch ALL queries and WAIT for completion
        await queryClient.refetchQueries({ predicate, type: 'all' });
        
        // 4. Close ONLY after refetch completes (no setTimeout)
        handleClose();
      } else {
        toast({
          title: "Импорт заблокирован",
          description: result.error || 'STOP-guard сработал',
          variant: "destructive",
        });
      }
      
    } catch (err) {
      console.error('Execute error:', err);
      toast({
        title: "Ошибка импорта",
        description: err instanceof Error ? err.message : 'Неизвестная ошибка',
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const removeFile = (index: number) => {
    const newFiles = files.filter((_, i) => i !== index);
    const newTexts = csvTexts.filter((_, i) => i !== index);
    setFiles(newFiles);
    setCsvTexts(newTexts);
    if (newFiles.length === 0) {
      setParseStatus('idle');
    }
    setDryRunResult(null);
    setImportResult(null);
  };

  const handleClose = () => {
    onOpenChange(false);
    setFiles([]);
    setCsvTexts([]);
    setParseStatus('idle');
    setParseError(null);
    setDryRunResult(null);
    setImportResult(null);
  };

  // PATCH-5: Render totals comparison
  const renderTotalsComparison = (stats: ImportStats, totalsExpected?: TotalsExpected) => {
    if (!totalsExpected) return null;
    
    const countDelta = totalsExpected.expected_count !== undefined 
      ? stats.uids_unique - totalsExpected.expected_count 
      : null;
    const amountDelta = totalsExpected.expected_amount !== undefined && stats.total_amount !== undefined
      ? stats.total_amount - totalsExpected.expected_amount
      : null;
    const hasDelta = (countDelta !== null && countDelta !== 0) || (amountDelta !== null && Math.abs(amountDelta) > 0.01);
    
    return (
      <div className="mt-3 p-3 border rounded-lg bg-blue-500/10 border-blue-500/20">
        <p className="text-sm font-medium mb-2">Сверка с Totals ({totalsExpected.source_file}):</p>
        <div className="grid grid-cols-2 gap-2 text-xs">
          {totalsExpected.expected_count !== undefined && (
            <>
              <div>Ожидалось транзакций: <span className="font-medium">{totalsExpected.expected_count}</span></div>
              <div>Импортировано уникальных: <span className="font-medium">{stats.uids_unique}</span></div>
            </>
          )}
          {totalsExpected.expected_amount !== undefined && (
            <>
              <div>Ожидаемая сумма: <span className="font-medium">{totalsExpected.expected_amount?.toFixed(2)}</span></div>
              <div>Фактическая сумма: <span className="font-medium">{stats.total_amount?.toFixed(2) ?? '—'}</span></div>
            </>
          )}
        </div>
        {hasDelta && (
          <div className="mt-2 text-amber-500 text-xs">
            ⚠️ Расхождение: 
            {countDelta !== null && countDelta !== 0 && ` ${Math.abs(countDelta)} транзакций`}
            {countDelta !== null && countDelta !== 0 && stats.duplicates_merged > 0 && ` (${stats.duplicates_merged} дубликатов)`}
            {countDelta !== null && countDelta !== 0 && stats.invalid_rows > 0 && ` (${stats.invalid_rows} невалидных)`}
          </div>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Импорт выписки bePaid
          </DialogTitle>
          <DialogDescription>
            Загрузите CSV файлы с выпиской bePaid (UTF-8). Можно выбрать несколько файлов + файл Totals для сверки.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          {/* PATCH-3: Multi-file input */}
          <div className="flex flex-col gap-2">
            <Input
              type="file"
              accept=".csv"
              multiple
              onChange={handleFilesChange}
              className="cursor-pointer"
              disabled={isLoading}
            />
            
            {/* File list */}
            {files.length > 0 && (
              <div className="space-y-1">
                {files.map((file, i) => (
                  <div key={i} className="flex items-center justify-between text-xs p-2 rounded bg-muted/50">
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="h-3 w-3" />
                      <span className="font-medium">{file.name}</span>
                      <span className="text-muted-foreground">({(file.size / 1024).toFixed(1)} KB)</span>
                      {isTotalsFile(file.name) && (
                        <span className="text-blue-500 text-[10px] px-1 py-0.5 bg-blue-500/10 rounded">Totals</span>
                      )}
                    </div>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-5 w-5" 
                      onClick={() => removeFile(i)}
                      disabled={isLoading}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          {/* Read status */}
          {parseStatus === 'reading' && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Чтение файлов...</span>
            </div>
          )}
          
          {parseStatus === 'error' && (
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span>{parseError}</span>
            </div>
          )}
          
          {parseStatus === 'ready' && !dryRunResult && (
            <div className="flex items-center gap-2 text-emerald-500">
              <CheckCircle2 className="h-4 w-4" />
              <span>{files.length} файл(ов) прочитано, готово к проверке</span>
            </div>
          )}
          
          {/* PATCH-5: Dry-run results with per-file breakdown */}
          {dryRunResult && (
            <div className="rounded-lg bg-muted/50 p-3 space-y-2">
              <p className="text-sm font-medium flex items-center gap-2">
                <Eye className="h-4 w-4" />
                Результат проверки (dry-run):
              </p>
              
              {/* Per-file stats */}
              {dryRunResult.stats.per_file && dryRunResult.stats.per_file.length > 1 && (
                <div className="mb-2 space-y-1">
                  <p className="text-xs text-muted-foreground">Файлы:</p>
                  {dryRunResult.stats.per_file.map((f, i) => (
                    <div key={i} className="text-xs pl-2 border-l-2 border-muted">
                      <span className="font-medium">{f.name}</span>: {f.total_rows} строк → {f.valid_rows} валидных
                    </div>
                  ))}
                </div>
              )}
              
              {/* Aggregate stats */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>Всего строк: <span className="font-medium">{dryRunResult.stats.total_rows}</span></div>
                <div>Уникальных UID: <span className="font-medium text-emerald-500">{dryRunResult.stats.uids_unique}</span></div>
                <div>Невалидных: <span className="font-medium text-amber-500">{dryRunResult.stats.invalid_rows}</span></div>
                <div>Дубликатов: <span className="font-medium text-blue-500">{dryRunResult.stats.duplicates_merged}</span></div>
              </div>
              
              {/* PATCH-4: Totals comparison */}
              {renderTotalsComparison(dryRunResult.stats, dryRunResult.totals_expected)}
              
              {dryRunResult.stats.invalid_rate > 0.10 && (
                <div className="flex items-center gap-2 text-destructive text-xs">
                  <AlertCircle className="h-3 w-3" />
                  <span>Высокий % ошибок ({(dryRunResult.stats.invalid_rate * 100).toFixed(1)}%) - импорт будет заблокирован</span>
                </div>
              )}
              
              {dryRunResult.sample_parsed && dryRunResult.sample_parsed.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs text-muted-foreground mb-1">Примеры распознанных строк:</p>
                  {dryRunResult.sample_parsed.map((row, i) => (
                    <div key={i} className="text-xs font-mono bg-background/50 p-1 rounded">
                      UID: {row.uid} | {row.amount} | {row.status}
                    </div>
                  ))}
                </div>
              )}
              
              {dryRunResult.sample_errors && dryRunResult.sample_errors.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs text-amber-500 mb-1">Примеры ошибок:</p>
                  {dryRunResult.sample_errors.slice(0, 5).map((err, i) => (
                    <div key={i} className="text-xs text-muted-foreground">
                      {err.file && `[${err.file}] `}Строка {err.row}: {err.reason}
                    </div>
                  ))}
                </div>
              )}
              
              {/* PATCH-6: Explain mismatch for count differences */}
              {dryRunResult.explain_mismatch && dryRunResult.explain_mismatch.length > 0 && (
                <div className="mt-3 p-2 border rounded bg-amber-500/10 border-amber-500/20">
                  <p className="text-xs text-amber-600 font-medium mb-1">
                    Причины расхождения ({dryRunResult.explain_mismatch.length}):
                  </p>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {dryRunResult.explain_mismatch.map((item, i) => (
                      <div key={i} className="text-xs font-mono text-muted-foreground">
                        {item.uid !== '—' && <span className="text-foreground">{item.uid} — </span>}
                        {item.reason}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          
          {/* PATCH-5: Execute result - detailed report */}
          {importResult && (
            <div className="rounded-lg bg-muted/50 p-3 space-y-2">
              <p className="text-sm font-medium">Результат импорта:</p>
              {importResult.success ? (
                <>
                  {/* Per-file stats */}
                  {importResult.stats.per_file && importResult.stats.per_file.length > 1 && (
                    <div className="mb-2 space-y-1">
                      <p className="text-xs text-muted-foreground">Файлы загружены:</p>
                      {importResult.stats.per_file.map((f, i) => (
                        <div key={i} className="text-xs pl-2 border-l-2 border-muted">
                          • <span className="font-medium">{f.name}</span> — {f.total_rows} строк
                        </div>
                      ))}
                    </div>
                  )}
                  
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>Всего строк: <span className="font-medium">{importResult.stats.total_rows}</span></div>
                    <div>Уникальных UID: <span className="font-medium">{importResult.stats.uids_unique}</span></div>
                    <div>Импортировано: <span className="font-medium text-emerald-500">{importResult.upserted ?? 0}</span></div>
                    <div>Дубликатов: <span className="font-medium text-blue-500">{importResult.stats.duplicates_merged}</span></div>
                    <div>Невалидных: <span className="font-medium text-amber-500">{importResult.stats.invalid_rows}</span></div>
                    <div>Ошибок БД: <span className="font-medium text-destructive">{importResult.errors || 0}</span></div>
                  </div>
                  
                  {/* PATCH-4: Totals comparison */}
                  {renderTotalsComparison(importResult.stats, importResult.totals_expected)}
                  
                  {importResult.sample_errors && importResult.sample_errors.length > 0 && (
                    <div className="mt-2 border-t border-border/50 pt-2">
                      <p className="text-xs text-amber-500 mb-1">Примеры ошибок:</p>
                      {importResult.sample_errors.slice(0, 5).map((err, i) => (
                        <div key={i} className="text-xs text-muted-foreground">
                          {err.file && `[${err.file}] `}Строка {err.row}: {err.reason}
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {importResult.stats.duplicates_merged > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      💡 {importResult.stats.duplicates_merged} дублей UID были объединены в одну запись
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-destructive">
                  ✗ {importResult.error}
                </p>
              )}
            </div>
          )}
          
          {/* Info box */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/10 text-xs">
            <Info className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
            <div className="text-muted-foreground">
              <p className="font-medium text-foreground mb-1">Рекомендация:</p>
              <p>Выберите несколько CSV-файлов (Cards, ERIP, и т.д.). Файл с именем "totals" или "итоги" будет использован только для сверки.</p>
            </div>
          </div>
        </div>
        
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleClose} disabled={isLoading}>
            Отмена
          </Button>
          
          {!dryRunResult ? (
            <Button 
              onClick={handleDryRun}
              disabled={parseStatus !== 'ready' || isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Проверка...
                </>
              ) : (
                <>
                  <Eye className="h-4 w-4 mr-2" />
                  Проверить (Dry-run)
                </>
              )}
            </Button>
          ) : (
            <Button 
              onClick={handleExecute}
              disabled={!dryRunResult.success || isLoading || importResult?.success}
              variant={dryRunResult.success ? "default" : "secondary"}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Импорт...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Импортировать
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
