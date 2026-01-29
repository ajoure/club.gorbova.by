import { useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useBepaidStatementImport } from "@/hooks/useBepaidStatement";
import { toast } from "@/hooks/use-toast";
import { parseISO, parse, isValid } from "date-fns";
import { Json } from "@/integrations/supabase/types";

// Column mapping from Russian headers to DB fields
const COLUMN_MAP: Record<string, string> = {
  'uid': 'uid',
  'id заказа': 'order_id_bepaid',
  'статус': 'status',
  'описание': 'description',
  'сумма': 'amount',
  'валюта': 'currency',
  'комиссия,%': 'commission_percent',
  'комиссия за операцию': 'commission_per_op',
  'сумма комиссий': 'commission_total',
  'перечисленная сумма': 'payout_amount',
  'тип транзакции': 'transaction_type',
  'трекинг id': 'tracking_id',
  'дата создания': 'created_at_bepaid',
  'дата оплаты': 'paid_at',
  'дата перечисления': 'payout_date',
  'действует до': 'expires_at',
  'сообщение': 'message',
  'id магазина': 'shop_id',
  'магазин': 'shop_name',
  'категория бизнеса': 'business_category',
  'id банка': 'bank_id',
  'имя': 'first_name',
  'фамилия': 'last_name',
  'адрес': 'address',
  'страна': 'country',
  'город': 'city',
  'индекс': 'zip',
  'область': 'region',
  'телефон': 'phone',
  'ip': 'ip',
  'e-mail': 'email',
  'email': 'email',
  'способ оплаты': 'payment_method',
  'код продукта': 'product_code',
  'карта': 'card_masked',
  'владелец карты': 'card_holder',
  'карта действует': 'card_expires',
  'bin карты': 'card_bin',
  'банк': 'bank_name',
  'страна банка': 'bank_country',
  '3-d secure': 'secure_3d',
  'результат avs': 'avs_result',
  'fraud': 'fraud',
  'код авторизации': 'auth_code',
  'rrn': 'rrn',
  'причина': 'reason',
  'идентификатор оплаты': 'payment_identifier',
  'провайдер токена': 'token_provider',
  'id торговца': 'merchant_id',
  'страна торговца': 'merchant_country',
  'компания торговца': 'merchant_company',
  'сумма после конвертации': 'converted_amount',
  'валюта после конвертации': 'converted_currency',
  'id шлюза': 'gateway_id',
  'рекуррентный тип': 'recurring_type',
  'card bin (8)': 'card_bin_8',
  'код банка': 'bank_code',
  'код ответа': 'response_code',
  'курс конвертации': 'conversion_rate',
  'перечисленная сумма после конвертации': 'converted_payout',
  'сумма комиссий в валюте после конвертации': 'converted_commission',
};

const DATE_FIELDS = ['created_at_bepaid', 'paid_at', 'payout_date', 'expires_at'];
const NUMBER_FIELDS = ['amount', 'commission_percent', 'commission_per_op', 'commission_total', 'payout_amount', 'converted_amount', 'converted_payout', 'converted_commission', 'conversion_rate'];

interface ParsedRow {
  uid: string;
  [key: string]: unknown;
}

// Parse Excel date - works with Date objects, numbers (Excel serial), or strings
// Note: For Excel serial dates, we use a simple conversion since XLSX.SSF is loaded dynamically
function parseExcelDate(value: unknown): string | null {
  if (!value) return null;
  
  // Handle Date objects (xlsx with cellDates: true returns Date objects)
  if (value instanceof Date) {
    if (!isNaN(value.getTime())) {
      return value.toISOString();
    }
    return null;
  }
  
  // Excel serial date number - simple conversion without XLSX.SSF
  // Excel dates are days since 1900-01-01 (with a bug for 1900 leap year)
  if (typeof value === 'number') {
    // Excel epoch is 1899-12-30 (accounting for the leap year bug)
    const excelEpoch = new Date(1899, 11, 30);
    const msPerDay = 24 * 60 * 60 * 1000;
    const date = new Date(excelEpoch.getTime() + value * msPerDay);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
    return null;
  }
  
  // String date
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    
    // Method 1: Try native Date parsing (handles "2026-01-03 19:07:25 +0300" well)
    const nativeDate = new Date(trimmed);
    if (!isNaN(nativeDate.getTime())) {
      return nativeDate.toISOString();
    }
    
    // Method 2: Try ISO format
    const isoDate = parseISO(trimmed);
    if (isValid(isoDate)) return isoDate.toISOString();
    
    // Method 3: Try common formats
    const formats = ['dd.MM.yyyy HH:mm:ss', 'dd.MM.yyyy HH:mm', 'dd.MM.yyyy', 'yyyy-MM-dd HH:mm:ss', 'yyyy-MM-dd'];
    for (const fmt of formats) {
      try {
        const parsed = parse(trimmed, fmt, new Date());
        if (isValid(parsed)) return parsed.toISOString();
      } catch {
        // continue
      }
    }
  }
  
  return null;
}

function parseNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }
  return null;
}

interface BepaidStatementImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BepaidStatementImportDialog({ open, onOpenChange }: BepaidStatementImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [parseStatus, setParseStatus] = useState<'idle' | 'parsing' | 'ready' | 'error'>('idle');
  const [parseError, setParseError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ created: number; errors: number } | null>(null);
  
  const importMutation = useBepaidStatementImport();

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    
    setFile(selectedFile);
    setParseStatus('parsing');
    setParseError(null);
    setParsedRows([]);
    setImportResult(null);
    
    try {
      // Dynamic import of xlsx library to reduce bundle size
      const XLSX = await import('xlsx');
      const buffer = await selectedFile.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      
      // Find transaction sheets
      const cardSheet = workbook.SheetNames.find(name => 
        name.toLowerCase().includes('карточн') || 
        name.toLowerCase().includes('card') ||
        name.toLowerCase().includes('транзакци')
      );
      const eripSheet = workbook.SheetNames.find(name => 
        name.toLowerCase().includes('ерип') || 
        name.toLowerCase().includes('erip')
      );
      
      const sheetsToProcess = [cardSheet, eripSheet].filter(Boolean) as string[];
      
      if (sheetsToProcess.length === 0) {
        // Fallback to first sheet if no match
        sheetsToProcess.push(workbook.SheetNames[0]);
      }
      
      const allRows: ParsedRow[] = [];
      
      for (const sheetName of sheetsToProcess) {
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
        
        if (jsonData.length < 2) continue;
        
        // Find header row (first row with UID or similar)
        let headerRowIndex = 0;
        for (let i = 0; i < Math.min(10, jsonData.length); i++) {
          const row = jsonData[i] as string[];
          if (row.some(cell => String(cell).toLowerCase() === 'uid')) {
            headerRowIndex = i;
            break;
          }
        }
        
        const headers = (jsonData[headerRowIndex] as string[]).map(h => String(h || '').toLowerCase().trim());
        
        // Map headers to DB columns
        const headerMap: { index: number; dbField: string }[] = [];
        headers.forEach((header, index) => {
          const dbField = COLUMN_MAP[header];
          if (dbField) {
            headerMap.push({ index, dbField });
          }
        });
        
        // Process data rows
        for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
          const row = jsonData[i] as unknown[];
          if (!row || row.length === 0) continue;
          
          const rawDataObj: Record<string, unknown> = {};
          headers.forEach((h, idx) => {
            rawDataObj[h] = row[idx];
          });
          
          const rowObj: ParsedRow = {
            uid: '',
            raw_data: rawDataObj as Json,
          };
          
          let hasUid = false;
          
          for (const { index, dbField } of headerMap) {
            const value = row[index];
            
            // Handle different field types
            if (DATE_FIELDS.includes(dbField)) {
              rowObj[dbField] = parseExcelDate(value);
            } else if (NUMBER_FIELDS.includes(dbField)) {
              rowObj[dbField] = parseNumber(value);
            } else {
              rowObj[dbField] = value != null ? String(value) : null;
            }
            
            if (dbField === 'uid' && value) {
              rowObj.uid = String(value);
              hasUid = true;
            }
          }
          
          // Only add rows with UID
          if (hasUid && rowObj.uid) {
            allRows.push(rowObj);
          }
        }
      }
      
      if (allRows.length === 0) {
        setParseStatus('error');
        setParseError('Не найдено строк с UID. Проверьте формат файла.');
        return;
      }
      
      setParsedRows(allRows);
      setParseStatus('ready');
      
    } catch (err) {
      console.error('Parse error:', err);
      setParseStatus('error');
      setParseError(`Ошибка парсинга: ${err instanceof Error ? err.message : 'Неизвестная ошибка'}`);
    }
  }, []);

  const handleImport = async () => {
    if (parsedRows.length === 0) return;
    
    try {
      const result = await importMutation.mutateAsync(parsedRows);
      setImportResult({ created: result.total - result.errors, errors: result.errors });
      
      toast({
        title: "Импорт завершён",
        description: `Импортировано: ${result.total - result.errors}, ошибок: ${result.errors}`,
      });
      
      // Close after success
      setTimeout(() => {
        onOpenChange(false);
        // Reset state
        setFile(null);
        setParsedRows([]);
        setParseStatus('idle');
        setImportResult(null);
      }, 2000);
      
    } catch (err) {
      toast({
        title: "Ошибка импорта",
        description: err instanceof Error ? err.message : 'Неизвестная ошибка',
        variant: "destructive",
      });
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    setFile(null);
    setParsedRows([]);
    setParseStatus('idle');
    setParseError(null);
    setImportResult(null);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Импорт выписки bePaid
          </DialogTitle>
          <DialogDescription>
            Загрузите Excel или CSV файл с выпиской bePaid. Транзакции с одинаковым UID будут обновлены.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          {/* File input */}
          <div className="flex flex-col gap-2">
            <Input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileChange}
              className="cursor-pointer"
            />
            {file && (
              <p className="text-xs text-muted-foreground">
                Файл: {file.name}
              </p>
            )}
          </div>
          
          {/* Parse status */}
          {parseStatus === 'parsing' && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Парсинг файла...</span>
            </div>
          )}
          
          {parseStatus === 'error' && (
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span>{parseError}</span>
            </div>
          )}
          
          {parseStatus === 'ready' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-emerald-500">
                <CheckCircle2 className="h-4 w-4" />
                <span>Готово к импорту: {parsedRows.length} строк</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Данные будут импортированы в базу данных. Существующие записи с таким же UID будут обновлены.
              </p>
            </div>
          )}
          
          {importResult && (
            <div className="rounded-lg bg-muted/50 p-3 space-y-1">
              <p className="text-sm font-medium">Результат импорта:</p>
              <p className="text-xs text-muted-foreground">
                Импортировано: {importResult.created}, ошибок: {importResult.errors}
              </p>
            </div>
          )}
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Отмена
          </Button>
          <Button 
            onClick={handleImport}
            disabled={parseStatus !== 'ready' || importMutation.isPending}
          >
            {importMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Импорт...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Импортировать
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
