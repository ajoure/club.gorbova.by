import { useState, useCallback, useMemo, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  FileSearch, Upload, Play, CheckCircle2, AlertTriangle, XCircle, 
  Download, Loader2, FileSpreadsheet, Clock, Copy, ExternalLink
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useVirtualizer } from "@tanstack/react-virtual";
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

interface MissingItem {
  uid: string;
  status: string;
  amount: number;
  transaction_type: string;
  paid_at?: string;
  customer_email?: string;
  card_last4?: string;
}

interface MismatchItem {
  uid: string;
  file_status: string;
  db_status: string;
  file_amount?: number;
  db_amount?: number;
  file_type?: string;
  db_type?: string;
  mismatch_type: string;
  paid_at?: string;
  customer_email?: string;
  db_id?: string;
}

interface ExtraItem {
  uid: string;
  amount: number;
  status: string;
  db_id?: string;
  paid_at?: string;
  customer_email?: string;
}

interface ReconcileResult {
  success: boolean;
  dry_run: boolean;
  stats: ReconcileStats;
  missing: MissingItem[];
  extra: ExtraItem[];
  mismatches: MismatchItem[];
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
        
        for (const sheetName of sheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
          
          if (!jsonData || jsonData.length < 2) {
            continue;
          }
          
          let headerRowIdx = -1;
          let headers: string[] = [];
          
          for (let i = 0; i < Math.min(15, jsonData.length); i++) {
            const row = jsonData[i];
            if (!row) continue;
            
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
          
          if (headerRowIdx === -1) {
            continue;
          }
          
          console.log(`[parseExcelFile] Sheet "${sheetName}": found UID at row ${headerRowIdx}`);
          sheetsProcessed.push(sheetName);
          
          const uidIdx = headers.findIndex(h => h === 'uid' || h.includes('id транз'));
          const statusIdx = headers.findIndex(h => h.includes('статус') || h.includes('status'));
          const typeIdx = headers.findIndex(h => h.includes('тип') || h.includes('type') || h.includes('операц'));
          const amountIdx = headers.findIndex(h => h.includes('сумма') || h.includes('amount'));
          const currencyIdx = headers.findIndex(h => h.includes('валют') || h.includes('currency'));
          const dateIdx = headers.findIndex(h => h.includes('дата') || h.includes('date') || h.includes('время'));
          const emailIdx = headers.findIndex(h => h.includes('email') || h.includes('почт'));
          const cardIdx = headers.findIndex(h => h.includes('карт') || h.includes('card') || h.includes('pan'));
          
          for (let i = headerRowIdx + 1; i < jsonData.length; i++) {
            const row = jsonData[i];
            if (!row || row.length === 0) continue;
            
            const uid = uidIdx >= 0 ? String(row[uidIdx] || '').trim() : '';
            if (!uid || !UUID_REGEX.test(uid)) continue;
            
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
          }
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

// Copy to clipboard helper
function copyToClipboard(text: string, toast: any) {
  navigator.clipboard.writeText(text).then(() => {
    toast({ title: "Скопировано", description: text.slice(0, 30) + "..." });
  }).catch(() => {
    toast({ title: "Ошибка копирования", variant: "destructive" });
  });
}

// Virtualized table row component for Missing items
function MissingRow({ item, onCopy }: { item: MissingItem; onCopy: (uid: string) => void }) {
  return (
    <div className="grid grid-cols-[1fr_100px_100px_100px_120px_80px_60px] gap-2 px-3 py-2 text-xs border-b border-slate-700/30 hover:bg-slate-800/30 items-center">
      <div className="flex items-center gap-1.5 min-w-0">
        <button onClick={() => onCopy(item.uid)} className="text-slate-500 hover:text-slate-300 shrink-0">
          <Copy className="h-3 w-3" />
        </button>
        <span className="font-mono text-slate-300 truncate">{item.uid.slice(0, 8)}...{item.uid.slice(-4)}</span>
      </div>
      <div className="text-slate-400 truncate">{item.paid_at?.split(' ')[0] || '—'}</div>
      <div className="text-emerald-400 tabular-nums text-right">{item.amount.toLocaleString('ru-RU', { minimumFractionDigits: 2 })}</div>
      <div className="text-emerald-400 truncate">{item.status || '—'}</div>
      <div className="text-slate-400 truncate">{item.customer_email || '—'}</div>
      <div className="text-slate-500 truncate">{item.card_last4 ? `****${item.card_last4}` : '—'}</div>
      <div className="text-amber-400 text-[10px]">Добавить</div>
    </div>
  );
}

// Virtualized table row component for Mismatch items
function MismatchRow({ item, onCopy }: { item: MismatchItem; onCopy: (uid: string) => void }) {
  const amountDiff = (item.file_amount || 0) - (item.db_amount || 0);
  return (
    <div className="grid grid-cols-[1fr_100px_100px_100px_100px_100px_80px_60px] gap-2 px-3 py-2 text-xs border-b border-slate-700/30 hover:bg-slate-800/30 items-center">
      <div className="flex items-center gap-1.5 min-w-0">
        <button onClick={() => onCopy(item.uid)} className="text-slate-500 hover:text-slate-300 shrink-0">
          <Copy className="h-3 w-3" />
        </button>
        <span className="font-mono text-slate-300 truncate">{item.uid.slice(0, 8)}...{item.uid.slice(-4)}</span>
      </div>
      <div className="text-slate-400 truncate">{item.paid_at?.split(' ')[0] || '—'}</div>
      <div className="text-emerald-400 tabular-nums text-right">{(item.file_amount || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2 })}</div>
      <div className="text-rose-400 tabular-nums text-right">{(item.db_amount || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2 })}</div>
      <div className="text-emerald-400 truncate">{item.file_status}</div>
      <div className="text-rose-400 truncate">{item.db_status}</div>
      <div className={`tabular-nums text-right ${amountDiff > 0 ? 'text-emerald-400' : amountDiff < 0 ? 'text-rose-400' : 'text-slate-500'}`}>
        {amountDiff !== 0 ? `${amountDiff > 0 ? '+' : ''}${amountDiff.toLocaleString('ru-RU', { minimumFractionDigits: 2 })}` : '—'}
      </div>
      <div className="text-amber-400 text-[10px]">Исправить</div>
    </div>
  );
}

// Virtualized table row component for Extra items
function ExtraRow({ item, onCopy }: { item: ExtraItem; onCopy: (uid: string) => void }) {
  return (
    <div className="grid grid-cols-[1fr_100px_100px_100px_120px_60px] gap-2 px-3 py-2 text-xs border-b border-slate-700/30 hover:bg-slate-800/30 items-center">
      <div className="flex items-center gap-1.5 min-w-0">
        <button onClick={() => onCopy(item.uid)} className="text-slate-500 hover:text-slate-300 shrink-0">
          <Copy className="h-3 w-3" />
        </button>
        <span className="font-mono text-slate-300 truncate">{item.uid.slice(0, 8)}...{item.uid.slice(-4)}</span>
      </div>
      <div className="text-slate-400 truncate">{item.paid_at?.split(' ')[0] || '—'}</div>
      <div className="text-rose-400 tabular-nums text-right">{item.amount.toLocaleString('ru-RU', { minimumFractionDigits: 2 })}</div>
      <div className="text-rose-400 truncate">{item.status}</div>
      <div className="text-slate-400 truncate">{item.customer_email || '—'}</div>
      <div className="text-sky-400 text-[10px]">Пометить</div>
    </div>
  );
}

// Virtualized list component
function VirtualizedList<T>({ 
  items, 
  renderRow,
  headerRow,
  parentRef,
}: { 
  items: T[];
  renderRow: (item: T, index: number) => React.ReactNode;
  headerRow: React.ReactNode;
  parentRef: React.RefObject<HTMLDivElement>;
}) {
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 15,
  });

  return (
    <div className="flex flex-col h-full">
      {/* Sticky header */}
      <div className="shrink-0 bg-slate-800/80 backdrop-blur-sm border-b border-slate-700/50 sticky top-0 z-10">
        {headerRow}
      </div>
      {/* Virtualized content */}
      <div 
        ref={parentRef}
        className="flex-1 overflow-auto"
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const item = items[virtualRow.index];
            return (
              <div
                key={virtualRow.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {renderRow(item, virtualRow.index)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
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
  const [activeTab, setActiveTab] = useState("missing");
  
  const missingListRef = useRef<HTMLDivElement>(null);
  const mismatchListRef = useRef<HTMLDivElement>(null);
  const extraListRef = useRef<HTMLDivElement>(null);
  
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
        description: `Найдено ${parsed.length} транзакций`,
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
      setActiveTab("missing");
      
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
  
  const handleCopyUid = useCallback((uid: string) => {
    copyToClipboard(uid, toast);
  }, [toast]);
  
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
      '=== MISSING ===',
      ...result.missing.map(m => `${m.uid} | ${m.status} | ${m.amount} BYN | ${m.transaction_type}`),
      '',
      '=== EXTRA ===',
      ...result.extra.map(e => `${e.uid} | ${e.status} | ${e.amount} BYN`),
      '',
      '=== MISMATCHES ===',
      ...result.mismatches.map(m => `${m.uid} | File: ${m.file_status}/${m.file_amount} | DB: ${m.db_status}/${m.db_amount}`),
    ];
    
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reconcile-report-${fromDate}-${toDate}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result, fromDate, toDate]);
  
  const totalToFix = result ? (result.stats.missing_in_db + result.stats.status_mismatches + result.stats.amount_mismatches) : 0;
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl h-[90vh] flex flex-col p-0 gap-0 overflow-hidden bg-slate-900/95 backdrop-blur-xl border-slate-700/50">
        {/* Header */}
        <DialogHeader className="shrink-0 px-6 py-4 border-b border-slate-700/50">
          <DialogTitle className="flex items-center gap-2 text-slate-100">
            <FileSearch className="h-5 w-5 text-purple-400" />
            Сверка с эталоном bePaid
          </DialogTitle>
        </DialogHeader>
        
        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Upload & Date Section */}
          <div className="shrink-0 px-6 py-4 border-b border-slate-700/30 bg-slate-800/30">
            <div className="flex items-center gap-6 flex-wrap">
              {/* File Upload */}
              <div className="flex items-center gap-3">
                <Input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileChange}
                  className="hidden"
                  id="reconcile-file-input"
                />
                <label
                  htmlFor="reconcile-file-input"
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-600/50 hover:border-purple-500/50 transition-colors cursor-pointer bg-slate-800/50"
                >
                  {isParsing ? (
                    <Loader2 className="h-4 w-4 animate-spin text-purple-400" />
                  ) : (
                    <Upload className="h-4 w-4 text-slate-400" />
                  )}
                  <span className="text-sm text-slate-300">
                    {file ? file.name : "Выберите файл"}
                  </span>
                </label>
                {transactions.length > 0 && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                    <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="text-xs font-medium text-emerald-400">
                      {transactions.length} транзакций
                    </span>
                  </div>
                )}
              </div>
              
              {/* Date Range */}
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-slate-500" />
                <Input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-36 h-9 bg-slate-800/50 border-slate-600/50 text-slate-300 text-sm"
                />
                <span className="text-slate-500">—</span>
                <Input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-36 h-9 bg-slate-800/50 border-slate-600/50 text-slate-300 text-sm"
                />
              </div>
            </div>
          </div>
          
          {/* Results Section */}
          {result ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Stats Summary */}
              <div className="shrink-0 px-6 py-3 border-b border-slate-700/30 bg-slate-800/20">
                <div className="flex items-center gap-6 flex-wrap text-sm">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    <span className="text-slate-400">Matched:</span>
                    <span className="font-semibold text-emerald-400 tabular-nums">{result.stats.matched}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-rose-400" />
                    <span className="text-slate-400">Missing:</span>
                    <span className="font-semibold text-rose-400 tabular-nums">{result.stats.missing_in_db}</span>
                    <span className="text-slate-500 text-xs">
                      ({result.missing.reduce((s, m) => s + Math.abs(m.amount), 0).toLocaleString('ru-RU', { minimumFractionDigits: 2 })} BYN)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-400" />
                    <span className="text-slate-400">Mismatch:</span>
                    <span className="font-semibold text-amber-400 tabular-nums">{result.stats.status_mismatches + result.stats.amount_mismatches}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-sky-400" />
                    <span className="text-slate-400">Extra:</span>
                    <span className="font-semibold text-sky-400 tabular-nums">{result.stats.extra_in_db}</span>
                  </div>
                  {result.dry_run && (
                    <span className="text-amber-500 font-medium text-xs uppercase tracking-wider">DRY-RUN</span>
                  )}
                </div>
              </div>
              
              {/* Tabs */}
              <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
                <TabsList className="shrink-0 mx-6 mt-3 bg-slate-800/50 border border-slate-700/30 h-9">
                  <TabsTrigger value="missing" className="text-xs data-[state=active]:bg-rose-500/20 data-[state=active]:text-rose-300">
                    Missing ({result.missing.length})
                  </TabsTrigger>
                  <TabsTrigger value="mismatch" className="text-xs data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-300">
                    Mismatch ({result.mismatches.length})
                  </TabsTrigger>
                  <TabsTrigger value="extra" className="text-xs data-[state=active]:bg-sky-500/20 data-[state=active]:text-sky-300">
                    Extra ({result.extra.length})
                  </TabsTrigger>
                </TabsList>
                
                <div className="flex-1 overflow-hidden mx-6 mt-3 mb-3 rounded-lg border border-slate-700/30 bg-slate-800/20">
                  {/* Missing Tab */}
                  <TabsContent value="missing" className="h-full m-0 data-[state=inactive]:hidden">
                    {result.missing.length === 0 ? (
                      <div className="flex items-center justify-center h-full text-slate-500 text-sm">
                        Нет отсутствующих записей
                      </div>
                    ) : (
                      <VirtualizedList
                        items={result.missing}
                        parentRef={missingListRef}
                        headerRow={
                          <div className="grid grid-cols-[1fr_100px_100px_100px_120px_80px_60px] gap-2 px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                            <div>UID</div>
                            <div>Дата</div>
                            <div className="text-right">Сумма (File)</div>
                            <div>Статус (File)</div>
                            <div>Email</div>
                            <div>Карта</div>
                            <div>Действие</div>
                          </div>
                        }
                        renderRow={(item) => <MissingRow item={item} onCopy={handleCopyUid} />}
                      />
                    )}
                  </TabsContent>
                  
                  {/* Mismatch Tab */}
                  <TabsContent value="mismatch" className="h-full m-0 data-[state=inactive]:hidden">
                    {result.mismatches.length === 0 ? (
                      <div className="flex items-center justify-center h-full text-slate-500 text-sm">
                        Нет расхождений
                      </div>
                    ) : (
                      <VirtualizedList
                        items={result.mismatches}
                        parentRef={mismatchListRef}
                        headerRow={
                          <div className="grid grid-cols-[1fr_100px_100px_100px_100px_100px_80px_60px] gap-2 px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                            <div>UID</div>
                            <div>Дата</div>
                            <div className="text-right">File</div>
                            <div className="text-right">DB</div>
                            <div>Статус File</div>
                            <div>Статус DB</div>
                            <div className="text-right">Δ</div>
                            <div>Действие</div>
                          </div>
                        }
                        renderRow={(item) => <MismatchRow item={item} onCopy={handleCopyUid} />}
                      />
                    )}
                  </TabsContent>
                  
                  {/* Extra Tab */}
                  <TabsContent value="extra" className="h-full m-0 data-[state=inactive]:hidden">
                    {result.extra.length === 0 ? (
                      <div className="flex items-center justify-center h-full text-slate-500 text-sm">
                        Нет лишних записей в БД
                      </div>
                    ) : (
                      <VirtualizedList
                        items={result.extra}
                        parentRef={extraListRef}
                        headerRow={
                          <div className="grid grid-cols-[1fr_100px_100px_100px_120px_60px] gap-2 px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                            <div>UID</div>
                            <div>Дата</div>
                            <div className="text-right">Сумма (DB)</div>
                            <div>Статус (DB)</div>
                            <div>Email</div>
                            <div>Действие</div>
                          </div>
                        }
                        renderRow={(item) => <ExtraRow item={item} onCopy={handleCopyUid} />}
                      />
                    )}
                  </TabsContent>
                </div>
              </Tabs>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
              Загрузите файл и запустите сверку
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="shrink-0 px-6 py-4 border-t border-slate-700/50 bg-slate-800/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="text-xs text-slate-500">
                <span className="font-mono">{whoami.email}</span>
                <span className="mx-2">•</span>
                <span className="font-mono">{whoami.roles}</span>
              </div>
              {result && (
                <Button variant="ghost" size="sm" onClick={downloadReport} className="gap-1.5 text-slate-400 hover:text-slate-200">
                  <Download className="h-3.5 w-3.5" />
                  Отчёт
                </Button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                Закрыть
              </Button>
              <Button
                variant="secondary"
                onClick={() => runReconcile(true)}
                disabled={isLoading || transactions.length === 0}
                className="gap-2 bg-slate-700 hover:bg-slate-600 text-slate-200"
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                DRY-RUN
              </Button>
              {result && result.dry_run && totalToFix > 0 && (
                <Button
                  onClick={() => runReconcile(false)}
                  disabled={isLoading}
                  className="gap-2 bg-purple-600 hover:bg-purple-500 text-white"
                >
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Применить ({totalToFix})
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
