import { useState, useCallback, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  FileSearch, Upload, Play, CheckCircle2, AlertTriangle, XCircle, 
  ChevronDown, Download, Loader2, FileSpreadsheet, Clock
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import * as XLSX from "xlsx";

interface ReconcileFileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface FileTransaction {
  uid: string;
  status: string;
  transaction_type: string;
  amount: number;
  currency?: string;
  paid_at?: string;
  description?: string;
  customer_email?: string;
  card_last4?: string;
  card_holder?: string;
  card_brand?: string;
}

interface ReconcileStats {
  file_count: number;
  db_count: number;
  matched: number;
  missing_in_db: number;
  extra_in_db: number;
  status_mismatches: number;
  amount_mismatches: number;
  type_mismatches: number;
  overrides_created: number;
  inserts_created: number;
  errors: number;
}

interface ReconcileResult {
  success: boolean;
  dry_run: boolean;
  stats: ReconcileStats;
  missing: Array<{ uid: string; status: string; amount: number; transaction_type: string }>;
  extra: Array<{ uid: string; amount: number; status: string }>;
  mismatches: Array<{ 
    uid: string; 
    file_status: string; 
    db_status: string; 
    file_amount?: number;
    db_amount?: number;
    mismatch_type: string;
  }>;
  errors: string[];
  summary: {
    file: { successful: number; failed: number; refunded: number; cancelled: number; total_amount: number };
    db: { successful: number; failed: number; refunded: number; cancelled: number; total_amount: number };
    net_revenue: number;
  };
}

// UUID validation regex (8-4-4-4-12 format)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Parse bePaid Excel file - processes ALL sheets looking for UID column
function parseExcelFile(file: File): Promise<{ transactions: FileTransaction[]; sheetsProcessed: string[] }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        const transactions: FileTransaction[] = [];
        const sheetsProcessed: string[] = [];
        const sheetNames = workbook.SheetNames;
        
        console.log(`[parseExcelFile] Found ${sheetNames.length} sheets:`, sheetNames);
        
        // Process ALL sheets, not just "Cards"/"ERIP"
        for (const sheetName of sheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
          
          // Skip empty sheets
          if (!jsonData || jsonData.length < 2) {
            console.log(`[parseExcelFile] Sheet "${sheetName}": empty, skipping`);
            continue;
          }
          
          // Find header row with UID column (check first 15 rows)
          let headerRowIdx = -1;
          let headers: string[] = [];
          
          for (let i = 0; i < Math.min(15, jsonData.length); i++) {
            const row = jsonData[i];
            if (!row) continue;
            
            // Look for UID column specifically
            const rowStr = row.map((c: any) => String(c || '').toLowerCase().trim());
            const hasUid = rowStr.some((h: string) => 
              h === 'uid' || 
              h.includes('id транз') ||
              h.startsWith('uid')
            );
            
            if (hasUid) {
              headerRowIdx = i;
              headers = rowStr;
              break;
            }
          }
          
          // If no UID column found in this sheet, skip it
          if (headerRowIdx === -1) {
            console.log(`[parseExcelFile] Sheet "${sheetName}": no UID column found, skipping`);
            continue;
          }
          
          console.log(`[parseExcelFile] Sheet "${sheetName}": found UID at row ${headerRowIdx}, parsing...`);
          sheetsProcessed.push(sheetName);
          
          // Find column indices
          const uidIdx = headers.findIndex(h => h === 'uid' || h.includes('id транз'));
          const statusIdx = headers.findIndex(h => h.includes('статус') || h.includes('status'));
          const typeIdx = headers.findIndex(h => h.includes('тип') || h.includes('type') || h.includes('операц'));
          const amountIdx = headers.findIndex(h => h.includes('сумма') || h.includes('amount'));
          const currencyIdx = headers.findIndex(h => h.includes('валют') || h.includes('currency'));
          const dateIdx = headers.findIndex(h => h.includes('дата') || h.includes('date') || h.includes('время'));
          const emailIdx = headers.findIndex(h => h.includes('email') || h.includes('почт'));
          const cardIdx = headers.findIndex(h => h.includes('карт') || h.includes('card') || h.includes('pan'));
          
          console.log(`[parseExcelFile] Column indices: UID=${uidIdx}, Status=${statusIdx}, Amount=${amountIdx}`);
          
          // Parse data rows
          let validCount = 0;
          let skippedInvalidUid = 0;
          
          for (let i = headerRowIdx + 1; i < jsonData.length; i++) {
            const row = jsonData[i];
            if (!row || row.length === 0) continue;
            
            const uid = uidIdx >= 0 ? String(row[uidIdx] || '').trim() : '';
            if (!uid) continue;
            
            // Validate UUID format
            if (!UUID_REGEX.test(uid)) {
              skippedInvalidUid++;
              continue;
            }
            
            const amountRaw = amountIdx >= 0 ? row[amountIdx] : 0;
            const amount = typeof amountRaw === 'number' ? amountRaw : parseFloat(String(amountRaw).replace(/[^\d.-]/g, '')) || 0;
            
            transactions.push({
              uid,
              status: statusIdx >= 0 ? String(row[statusIdx] || '') : '',
              transaction_type: typeIdx >= 0 ? String(row[typeIdx] || '') : 'Платеж',
              amount,
              currency: currencyIdx >= 0 ? String(row[currencyIdx] || 'BYN') : 'BYN',
              paid_at: dateIdx >= 0 ? String(row[dateIdx] || '') : undefined,
              customer_email: emailIdx >= 0 ? String(row[emailIdx] || '') : undefined,
              card_last4: cardIdx >= 0 ? String(row[cardIdx] || '').slice(-4) : undefined,
            });
            validCount++;
          }
          
          console.log(`[parseExcelFile] Sheet "${sheetName}": parsed ${validCount} transactions, skipped ${skippedInvalidUid} invalid UIDs`);
        }
        
        console.log(`[parseExcelFile] Total: ${transactions.length} transactions from ${sheetsProcessed.length} sheets`);
        resolve({ transactions, sheetsProcessed });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Ошибка чтения файла'));
    reader.readAsArrayBuffer(file);
  });
}

export default function ReconcileFileDialog({ open, onOpenChange, onSuccess }: ReconcileFileDialogProps) {
  const { toast } = useToast();
  const { user, role } = useAuth();
  
  const [file, setFile] = useState<File | null>(null);
  const [transactions, setTransactions] = useState<FileTransaction[]>([]);
  const [sheetsInfo, setSheetsInfo] = useState<string[]>([]);
  const [fromDate, setFromDate] = useState("2026-01-01");
  const [toDate, setToDate] = useState("2026-01-25");
  const [isLoading, setIsLoading] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  
  const whoami = useMemo(() => ({
    email: user?.email || 'unknown',
    uid: user?.id || 'unknown',
    roles: role || 'user',
  }), [user, role]);
  
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    
    setFile(selectedFile);
    setIsParsing(true);
    setResult(null);
    setSheetsInfo([]);
    
    try {
      const { transactions: parsed, sheetsProcessed } = await parseExcelFile(selectedFile);
      setTransactions(parsed);
      setSheetsInfo(sheetsProcessed);
      toast({
        title: "Файл загружен",
        description: `Найдено ${parsed.length} транзакций из листов: ${sheetsProcessed.join(', ') || 'нет'}`,
      });
    } catch (err: any) {
      toast({
        title: "Ошибка парсинга",
        description: err.message,
        variant: "destructive",
      });
      setTransactions([]);
      setSheetsInfo([]);
    } finally {
      setIsParsing(false);
    }
  }, [toast]);
  
  const runReconcile = useCallback(async (dryRun: boolean) => {
    if (transactions.length === 0) {
      toast({ title: "Нет транзакций", variant: "destructive" });
      return;
    }
    
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('bepaid-reconcile-file', {
        body: {
          transactions,
          dry_run: dryRun,
          from_date: fromDate,
          to_date: toDate,
          include_queue: true,
        },
      });
      
      if (error) throw error;
      
      setResult(data as ReconcileResult);
      
      toast({
        title: dryRun ? "Сверка завершена (DRY-RUN)" : "Исправления применены",
        description: `Matched: ${data.stats.matched}, Missing: ${data.stats.missing_in_db}, Mismatch: ${data.stats.status_mismatches}`,
      });
      
      if (!dryRun && onSuccess) {
        onSuccess();
      }
    } catch (err: any) {
      toast({
        title: "Ошибка сверки",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [transactions, fromDate, toDate, toast, onSuccess]);
  
  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };
  
  const downloadReport = useCallback(() => {
    if (!result) return;
    
    const lines = [
      'RECONCILIATION REPORT',
      `Date: ${new Date().toISOString()}`,
      `Period: ${fromDate} to ${toDate}`,
      `Mode: ${result.dry_run ? 'DRY-RUN' : 'EXECUTE'}`,
      '',
      '=== SUMMARY ===',
      `File count: ${result.stats.file_count}`,
      `DB count: ${result.stats.db_count}`,
      `Matched: ${result.stats.matched}`,
      `Missing in DB: ${result.stats.missing_in_db}`,
      `Extra in DB: ${result.stats.extra_in_db}`,
      `Status mismatches: ${result.stats.status_mismatches}`,
      `Amount mismatches: ${result.stats.amount_mismatches}`,
      '',
      '=== MISSING (in file, not in DB) ===',
      ...result.missing.map(m => `${m.uid} | ${m.status} | ${m.amount} BYN | ${m.transaction_type}`),
      '',
      '=== EXTRA (in DB, not in file) ===',
      ...result.extra.map(e => `${e.uid} | ${e.status} | ${e.amount} BYN`),
      '',
      '=== MISMATCHES ===',
      ...result.mismatches.map(m => `${m.uid} | File: ${m.file_status} | DB: ${m.db_status} | Type: ${m.mismatch_type}`),
      '',
      '=== ERRORS ===',
      ...result.errors,
    ];
    
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reconcile-report-${fromDate}-${toDate}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result, fromDate, toDate]);
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSearch className="h-5 w-5 text-primary" />
            Сверка с эталоном bePaid
          </DialogTitle>
          <DialogDescription>
            Загрузите выписку bePaid и сравните с базой данных
          </DialogDescription>
        </DialogHeader>
        
        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-6 pb-4">
            {/* Step 1: File Upload */}
            <div className="space-y-3">
              <Label className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                1. Загрузка файла
              </Label>
              <div className="flex items-center gap-4">
                <div className="relative flex-1">
                  <Input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleFileChange}
                    className="hidden"
                    id="reconcile-file-input"
                  />
                  <label
                    htmlFor="reconcile-file-input"
                    className="flex items-center gap-3 px-4 py-3 rounded-2xl border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 transition-colors cursor-pointer bg-muted/20 backdrop-blur-sm"
                  >
                    {isParsing ? (
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    ) : (
                      <Upload className="h-5 w-5 text-muted-foreground" />
                    )}
                    <span className="text-sm text-muted-foreground">
                      {file ? file.name : "Выберите файл Excel/CSV"}
                    </span>
                  </label>
                </div>
                {transactions.length > 0 && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                    <FileSpreadsheet className="h-4 w-4 text-emerald-500" />
                    <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                      {transactions.length} транзакций
                    </span>
                  </div>
                )}
              </div>
            </div>
            
            {/* Step 2: Date Range */}
            <div className="space-y-3">
              <Label className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                2. Период сверки (Europe/Minsk)
              </Label>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <Input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="w-40"
                  />
                </div>
                <span className="text-muted-foreground">—</span>
                <Input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-40"
                />
              </div>
            </div>
            
            {/* Step 3: Results */}
            {result && (
              <div className="space-y-4">
                <Label className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  3. Результат сверки {result.dry_run && <span className="text-amber-500">(DRY-RUN)</span>}
                </Label>
                
                {/* Summary Table */}
                <div className="rounded-2xl border border-border/50 overflow-hidden bg-card/50 backdrop-blur-sm">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/30">
                        <th className="text-left px-4 py-2 font-semibold">Категория</th>
                        <th className="text-right px-4 py-2 font-semibold">Кол-во</th>
                        <th className="text-right px-4 py-2 font-semibold">Сумма BYN</th>
                        <th className="text-left px-4 py-2 font-semibold">Действие</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t border-border/30">
                        <td className="px-4 py-2 flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          Matched
                        </td>
                        <td className="text-right px-4 py-2 tabular-nums">{result.stats.matched}</td>
                        <td className="text-right px-4 py-2 tabular-nums">—</td>
                        <td className="px-4 py-2 text-muted-foreground text-xs">Без изменений</td>
                      </tr>
                      <tr className="border-t border-border/30">
                        <td className="px-4 py-2 flex items-center gap-2">
                          <XCircle className="h-4 w-4 text-red-500" />
                          Missing
                        </td>
                        <td className="text-right px-4 py-2 tabular-nums font-semibold text-red-600">{result.stats.missing_in_db}</td>
                        <td className="text-right px-4 py-2 tabular-nums">
                          {result.missing.reduce((sum, m) => sum + Math.abs(m.amount), 0).toLocaleString('ru-RU', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground text-xs">Добавить в БД</td>
                      </tr>
                      <tr className="border-t border-border/30">
                        <td className="px-4 py-2 flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-amber-500" />
                          Mismatch
                        </td>
                        <td className="text-right px-4 py-2 tabular-nums font-semibold text-amber-600">
                          {result.stats.status_mismatches + result.stats.amount_mismatches}
                        </td>
                        <td className="text-right px-4 py-2 tabular-nums">—</td>
                        <td className="px-4 py-2 text-muted-foreground text-xs">Исправить</td>
                      </tr>
                      <tr className="border-t border-border/30">
                        <td className="px-4 py-2 flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-blue-500" />
                          Extra
                        </td>
                        <td className="text-right px-4 py-2 tabular-nums font-semibold text-blue-600">{result.stats.extra_in_db}</td>
                        <td className="text-right px-4 py-2 tabular-nums">
                          {result.extra.reduce((sum, e) => sum + Math.abs(e.amount), 0).toLocaleString('ru-RU', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground text-xs">Пометить</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                
                {/* Collapsible Details */}
                <div className="space-y-2">
                  {result.missing.length > 0 && (
                    <Collapsible open={expandedSections['missing']} onOpenChange={() => toggleSection('missing')}>
                      <CollapsibleTrigger className="flex items-center justify-between w-full px-4 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/15 transition-colors">
                        <span className="font-medium text-red-600 dark:text-red-400">
                          Missing ({result.missing.length})
                        </span>
                        <ChevronDown className={`h-4 w-4 transition-transform ${expandedSections['missing'] ? 'rotate-180' : ''}`} />
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2">
                        <div className="max-h-48 overflow-auto rounded-xl bg-muted/30 p-3 text-xs font-mono space-y-1">
                          {result.missing.map((m, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <span className="text-muted-foreground">{m.uid.slice(0, 12)}...</span>
                              <span className="text-foreground">{m.amount} BYN</span>
                              <span className="text-muted-foreground">{m.status}</span>
                            </div>
                          ))}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                  
                  {result.mismatches.length > 0 && (
                    <Collapsible open={expandedSections['mismatch']} onOpenChange={() => toggleSection('mismatch')}>
                      <CollapsibleTrigger className="flex items-center justify-between w-full px-4 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/15 transition-colors">
                        <span className="font-medium text-amber-600 dark:text-amber-400">
                          Mismatch ({result.mismatches.length})
                        </span>
                        <ChevronDown className={`h-4 w-4 transition-transform ${expandedSections['mismatch'] ? 'rotate-180' : ''}`} />
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2">
                        <div className="max-h-48 overflow-auto rounded-xl bg-muted/30 p-3 text-xs font-mono space-y-1">
                          {result.mismatches.map((m, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <span className="text-muted-foreground">{m.uid.slice(0, 12)}...</span>
                              <span className="text-emerald-600">File: {m.file_status}</span>
                              <span className="text-red-600">DB: {m.db_status}</span>
                              <span className="text-muted-foreground">({m.mismatch_type})</span>
                            </div>
                          ))}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                  
                  {result.extra.length > 0 && (
                    <Collapsible open={expandedSections['extra']} onOpenChange={() => toggleSection('extra')}>
                      <CollapsibleTrigger className="flex items-center justify-between w-full px-4 py-2 rounded-xl bg-blue-500/10 hover:bg-blue-500/15 transition-colors">
                        <span className="font-medium text-blue-600 dark:text-blue-400">
                          Extra ({result.extra.length})
                        </span>
                        <ChevronDown className={`h-4 w-4 transition-transform ${expandedSections['extra'] ? 'rotate-180' : ''}`} />
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2">
                        <div className="max-h-48 overflow-auto rounded-xl bg-muted/30 p-3 text-xs font-mono space-y-1">
                          {result.extra.map((e, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <span className="text-muted-foreground">{e.uid.slice(0, 12)}...</span>
                              <span className="text-foreground">{e.amount} BYN</span>
                              <span className="text-muted-foreground">{e.status}</span>
                            </div>
                          ))}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </div>
                
                {/* Download Report */}
                <Button variant="outline" size="sm" onClick={downloadReport} className="gap-2">
                  <Download className="h-4 w-4" />
                  Скачать отчёт
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>
        
        {/* Footer */}
        <div className="pt-4 border-t border-border/50 space-y-3">
          {/* Whoami */}
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <span className="font-mono">{whoami.email}</span>
            <span>•</span>
            <span className="font-mono">{whoami.roles}</span>
          </div>
          
          {/* Actions */}
          <div className="flex items-center justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Закрыть
            </Button>
            <Button
              variant="secondary"
              onClick={() => runReconcile(true)}
              disabled={isLoading || transactions.length === 0}
              className="gap-2"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Запустить сверку (DRY-RUN)
            </Button>
            {result && result.dry_run && (
              <Button
                variant="default"
                onClick={() => runReconcile(false)}
                disabled={isLoading}
                className="gap-2"
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Применить исправления
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
