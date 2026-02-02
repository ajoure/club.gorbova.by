import { useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2, Info, Eye, Play } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

const MAX_FILE_SIZE_MB = 10;

interface ImportStats {
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  invalid_rate: number;
  duplicates_merged: number;
}

interface DryRunResponse {
  success: boolean;
  mode: 'dry_run';
  build_id: string;
  stats: ImportStats;
  sample_errors?: Array<{ row: number; reason: string }>;
  sample_parsed?: Array<{ uid: string; amount: number; status: string; paid_at: string }>;
}

interface ExecuteResponse {
  success: boolean;
  mode: 'execute' | 'execute_blocked';
  build_id: string;
  stats: ImportStats;
  upserted?: number;
  errors?: number;
  error?: string;
  error_details?: string[];
  sample_errors?: Array<{ row: number; reason: string }>;
}

interface BepaidStatementImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BepaidStatementImportDialog({ open, onOpenChange }: BepaidStatementImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState<string>('');
  const [parseStatus, setParseStatus] = useState<'idle' | 'reading' | 'ready' | 'error'>('idle');
  const [parseError, setParseError] = useState<string | null>(null);
  
  const [dryRunResult, setDryRunResult] = useState<DryRunResponse | null>(null);
  const [importResult, setImportResult] = useState<ExecuteResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  const queryClient = useQueryClient();

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    
    // STOP-guard: file size limit
    const fileSizeMB = selectedFile.size / (1024 * 1024);
    if (fileSizeMB > MAX_FILE_SIZE_MB) {
      setParseStatus('error');
      setParseError(`Файл слишком большой (${fileSizeMB.toFixed(1)} MB). Максимум: ${MAX_FILE_SIZE_MB} MB. Разбейте период на части.`);
      return;
    }
    
    setFile(selectedFile);
    setParseStatus('reading');
    setParseError(null);
    setCsvText('');
    setDryRunResult(null);
    setImportResult(null);
    
    try {
      // Read file as text (UTF-8)
      const text = await selectedFile.text();
      
      if (!text.trim()) {
        setParseStatus('error');
        setParseError('Файл пуст');
        return;
      }
      
      // Basic validation: check if it looks like CSV
      const lines = text.trim().split(/\r?\n/);
      if (lines.length < 2) {
        setParseStatus('error');
        setParseError('Файл должен содержать заголовки и хотя бы одну строку данных');
        return;
      }
      
      // Check for UID column
      const firstLine = lines[0].toLowerCase();
      if (!firstLine.includes('uid')) {
        setParseStatus('error');
        setParseError('Не найден столбец UID. Убедитесь, что это выписка bePaid в формате CSV.');
        return;
      }
      
      setCsvText(text);
      setParseStatus('ready');
      
    } catch (err) {
      console.error('File read error:', err);
      setParseStatus('error');
      setParseError(`Ошибка чтения файла: ${err instanceof Error ? err.message : 'Неизвестная ошибка'}`);
    }
  }, []);

  const handleDryRun = async () => {
    if (!csvText) return;
    
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
          csv_text: csvText,
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
          description: `Готово к импорту: ${result.stats.valid_rows} строк`,
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
    if (!csvText || !dryRunResult?.success) return;
    
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
          csv_text: csvText,
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
        
        // PATCH-2: Correct React Query refresh
        // Use predicate to find all bepaid-statement related queries
        const predicate = (query: { queryKey: readonly unknown[] }) => {
          const key = String(query.queryKey?.[0] ?? '');
          return key.startsWith('bepaid-statement');
        };
        
        // First invalidate all related queries
        queryClient.invalidateQueries({ predicate });
        
        // Remove paginated queries to reset infinite cursor/pages
        queryClient.removeQueries({ 
          queryKey: ['bepaid-statement-paginated'], 
          exact: false 
        });
        
        // Refetch active queries (stats will refetch immediately)
        await queryClient.refetchQueries({ predicate, type: 'active' });
        
        // Close after success
        setTimeout(() => {
          handleClose();
        }, 1500);
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

  const handleClose = () => {
    onOpenChange(false);
    setFile(null);
    setCsvText('');
    setParseStatus('idle');
    setParseError(null);
    setDryRunResult(null);
    setImportResult(null);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Импорт выписки bePaid
          </DialogTitle>
          <DialogDescription>
            Загрузите CSV файл с выпиской bePaid (UTF-8). Транзакции с одинаковым UID будут обновлены.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          {/* File input */}
          <div className="flex flex-col gap-2">
            <Input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="cursor-pointer"
              disabled={isLoading}
            />
            {file && (
              <p className="text-xs text-muted-foreground">
                Файл: {file.name} ({(file.size / 1024).toFixed(1)} KB)
              </p>
            )}
          </div>
          
          {/* Read status */}
          {parseStatus === 'reading' && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Чтение файла...</span>
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
              <span>Файл прочитан, готов к проверке</span>
            </div>
          )}
          
          {/* Dry-run results */}
          {dryRunResult && (
            <div className="rounded-lg bg-muted/50 p-3 space-y-2">
              <p className="text-sm font-medium flex items-center gap-2">
                <Eye className="h-4 w-4" />
                Результат проверки (dry-run):
              </p>
              
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>Всего строк: <span className="font-medium">{dryRunResult.stats.total_rows}</span></div>
                <div>Валидных: <span className="font-medium text-emerald-500">{dryRunResult.stats.valid_rows}</span></div>
                <div>Невалидных: <span className="font-medium text-amber-500">{dryRunResult.stats.invalid_rows}</span></div>
                <div>Дубликатов: <span className="font-medium text-blue-500">{dryRunResult.stats.duplicates_merged}</span></div>
              </div>
              
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
                  {dryRunResult.sample_errors.slice(0, 3).map((err, i) => (
                    <div key={i} className="text-xs text-muted-foreground">
                      Строка {err.row}: {err.reason}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          
          {/* Execute result - PATCH-4: Detailed report */}
          {importResult && (
            <div className="rounded-lg bg-muted/50 p-3 space-y-2">
              <p className="text-sm font-medium">Результат импорта:</p>
              {importResult.success ? (
                <>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>Всего строк: <span className="font-medium">{importResult.stats.total_rows}</span></div>
                    <div>Валидных: <span className="font-medium text-emerald-500">{importResult.stats.valid_rows}</span></div>
                    <div>Импортировано: <span className="font-medium text-emerald-500">{importResult.upserted ?? 0}</span></div>
                    <div>Дубликатов: <span className="font-medium text-blue-500">{importResult.stats.duplicates_merged}</span></div>
                    <div>Невалидных: <span className="font-medium text-amber-500">{importResult.stats.invalid_rows}</span></div>
                    <div>Ошибок БД: <span className="font-medium text-destructive">{importResult.errors || 0}</span></div>
                  </div>
                  {importResult.sample_errors && importResult.sample_errors.length > 0 && (
                    <div className="mt-2 border-t border-border/50 pt-2">
                      <p className="text-xs text-amber-500 mb-1">Примеры ошибок:</p>
                      {importResult.sample_errors.slice(0, 5).map((err, i) => (
                        <div key={i} className="text-xs text-muted-foreground">
                          Строка {err.row}: {err.reason}
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
              <p>Экспортируйте выписку из bePaid в формате CSV (UTF-8). Это обеспечивает стабильный импорт на любых устройствах.</p>
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
