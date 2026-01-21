import { useState, useCallback, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Upload, FileSpreadsheet, AlertCircle, CheckCircle2, 
  Loader2, X, FileText, ArrowRight, User, Mail, CreditCard, ShoppingCart,
  AlertTriangle, Plus, RefreshCw, GitCompare, ArrowUp, ArrowDown, Equal, FileWarning
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBepaidMappings, useBepaidQueueActions } from "@/hooks/useBepaidMappings";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import * as XLSX from "xlsx";
import { transliterateToCyrillic } from "@/utils/transliteration";
import { cn } from "@/lib/utils";
import { 
  parseCSVContent, 
  normalizeStatus, 
  parseAmount, 
  parseDate, 
  detectPaymentMethod,
  extractCardLast4,
  detectCardBrand
} from "@/lib/csv-parser";

interface SmartImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface ParsedTransaction {
  uid: string;
  bepaid_order_id?: string;
  status: string;
  status_normalized: 'successful' | 'failed' | 'pending' | 'refund' | 'cancel' | 'refunded' | 'cancelled';
  transaction_type: string;
  amount: number;
  currency: string;
  description?: string;
  tracking_id?: string;
  created_at?: string;
  paid_at?: string;
  customer_email?: string;
  card_last4?: string;
  card_holder?: string;
  card_brand?: string;
  payment_method?: string;
  fee_percent?: number;
  fee_amount?: number;
  total_fee?: number;
  transferred_amount?: number;
  transferred_at?: string;
  valid_until?: string;
  message?: string;
  shop_id?: string;
  shop_name?: string;
  business_category?: string;
  customer_name?: string;
  customer_surname?: string;
  customer_address?: string;
  customer_country?: string;
  customer_city?: string;
  customer_zip?: string;
  customer_state?: string;
  customer_phone?: string;
  ip_address?: string;
  product_code?: string;
  card_valid_until?: string;
  card_bin?: string;
  card_bank?: string;
  card_bank_country?: string;
  three_d_secure?: boolean;
  avs_result?: string;
  fraud_result?: string;
  auth_code?: string;
  rrn?: string;
  reason?: string;
  matched_profile_id?: string;
  matched_profile_name?: string;
  matched_by?: 'email' | 'card' | 'name' | 'none';
  auto_created_order?: boolean;
  order_id?: string;
  // Reconciliation status
  reconcile_status?: 'new' | 'match' | 'update' | 'conflict';
  existing_record?: any;
  import_status?: 'pending' | 'exists' | 'imported' | 'error' | 'order_created';
  import_error?: string;
}

interface ReconciliationReport {
  totalInFile: number;
  newRecords: ParsedTransaction[];
  updates: ParsedTransaction[];
  matches: ParsedTransaction[];
  conflicts: ParsedTransaction[];
}

type ImportPhase = 'upload' | 'parsing' | 'reconciliation' | 'importing' | 'complete';

const BATCH_SIZE = 50;

// Sheet detection by name (case-insensitive)
interface DetectedSheet {
  name: string;
  type: 'report' | 'cards' | 'erip' | 'memo' | 'unknown';
  rowCount: number;
  hasUid: boolean;
}

function detectSheetsByName(workbook: XLSX.WorkBook): DetectedSheet[] {
  const detected: DetectedSheet[] = [];
  
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '', raw: false });
    const hasUid = rows.length > 0 && ('UID' in rows[0] || 'uid' in rows[0]);
    const nameLower = sheetName.toLowerCase();
    
    let type: DetectedSheet['type'] = 'unknown';
    
    // Detect by sheet name
    if (nameLower.includes('отчет') || nameLower.includes('report') || nameLower.includes('summary')) {
      type = 'report';
    } else if (nameLower.includes('карточ') || nameLower.includes('card')) {
      type = 'cards';
    } else if (nameLower.includes('ерип') || nameLower.includes('erip')) {
      type = 'erip';
    } else if (nameLower.includes('мемориальн') || nameLower.includes('memo')) {
      type = 'memo';
    } else if (hasUid) {
      // Try to detect by content columns
      const firstRow = rows[0] || {};
      if (firstRow['Номер операции ЕРИП'] || firstRow['Расчетный агент'] || firstRow['Код услуги']) {
        type = 'erip';
      } else if (firstRow['Карта'] || firstRow['Card'] || firstRow['Владелец карты']) {
        type = 'cards';
      }
    }
    
    detected.push({
      name: sheetName,
      type,
      rowCount: rows.length,
      hasUid,
    });
  }
  
  return detected;
}

// Parse bePaid CSV/Excel row using improved parser
// CRITICAL: Normalizes ERIP transactions to payment_erip for proper classification
function parseCSVRow(row: Record<string, string>, sheetType?: 'cards' | 'erip'): ParsedTransaction | null {
  const uid = row['UID'] || row['uid'] || row['ID транзакции'];
  if (!uid) return null;

  const statusRaw = row['Статус'] || row['Status'] || '';
  const typeRaw = row['Тип транзакции'] || row['Transaction type'] || 'Платеж';
  const messageRaw = row['Сообщение'] || row['Message'] || '';
  
  // Use improved status normalization
  const status_normalized = normalizeStatus(statusRaw, typeRaw, messageRaw);

  // CRITICAL FIX: For void/cancel transactions, use 'Сумма' column, NOT 'Перечисленная сумма'
  // bePaid file: 'Сумма' = actual transaction amount, 'Перечисленная сумма' = 0 for voids
  const isVoidOrCancel = typeRaw.toLowerCase().includes('отмен') || 
                          typeRaw.toLowerCase().includes('void') ||
                          typeRaw.toLowerCase().includes('cancel');
  
  // Always prefer 'Сумма' column for the actual transaction amount
  const amountRaw = row['Сумма'] || row['Amount'];
  let amount = parseAmount(amountRaw);
  
  // For voids/cancels, amount should be positive (representing the cancelled amount)
  if (isVoidOrCancel && amount < 0) {
    amount = Math.abs(amount);
  }

  const cardMask = row['Карта'] || row['Card'] || '';
  const card_last4 = extractCardLast4(cardMask);
  
  const paymentMethodRaw = row['Способ оплаты'] || row['Payment method'] || '';
  
  // Detect if ERIP - by sheet type, column, or payment method
  const isErip = sheetType === 'erip' || 
                 row['_source'] === 'erip' ||
                 paymentMethodRaw.toLowerCase().includes('erip') ||
                 !!row['Номер операции ЕРИП'] ||
                 !!row['Расчетный агент'] ||
                 !!row['Код услуги'];
  
  const payment_method = isErip ? 'erip' : detectPaymentMethod(row);
  const card_brand = isErip ? 'erip' : detectCardBrand(cardMask, paymentMethodRaw);
  
  // CRITICAL: Normalize transaction_type for ERIP to be recognized by classifyPayment
  let normalizedTransactionType = typeRaw;
  if (isErip) {
    const typeLower = typeRaw.toLowerCase();
    if (typeLower.includes('платеж') || typeLower.includes('payment') || typeLower === '' || typeLower === 'платёж') {
      normalizedTransactionType = 'payment_erip'; // Canonical ERIP payment type
    }
  } else {
    // Normalize card payment types
    const typeLower = typeRaw.toLowerCase();
    if (typeLower.includes('платеж') || typeLower.includes('payment') || typeLower === '' || typeLower === 'платёж') {
      normalizedTransactionType = 'payment_card';
    }
  }

  const parse3DSecure = (val: string | undefined): boolean | undefined => {
    if (!val) return undefined;
    const lower = val.toLowerCase();
    if (lower === 'да' || lower === 'yes' || lower === 'true' || lower === '1') return true;
    if (lower === 'нет' || lower === 'no' || lower === 'false' || lower === '0') return false;
    return undefined;
  };

  return {
    uid,
    bepaid_order_id: row['ID заказа'] || row['Order ID'] || undefined,
    status: row['Статус'] || row['Status'] || 'Unknown',
    status_normalized,
    transaction_type: normalizedTransactionType,
    amount,
    currency: row['Валюта'] || row['Currency'] || 'BYN',
    description: row['Описание'] || row['Description'] || undefined,
    tracking_id: row['Трекинг ID'] || row['Tracking ID'] || undefined,
    created_at: parseDate(row['Дата создания'] || row['Created at']),
    paid_at: parseDate(row['Дата оплаты'] || row['Paid at']),
    customer_email: row['E-mail'] || row['Email'] || undefined,
    card_last4,
    card_holder: row['Владелец карты'] || row['Card holder'] || undefined,
    card_brand,
    payment_method: isErip ? 'erip' : paymentMethodRaw.toLowerCase() || undefined,
    fee_percent: parseAmount(row['Комиссия,%'] || row['Fee %']),
    fee_amount: parseAmount(row['Комиссия за операцию'] || row['Fee amount']),
    total_fee: parseAmount(row['Сумма комиссий'] || row['Total fee']),
    transferred_amount: parseAmount(row['Перечисленная сумма'] || row['Transferred amount']),
    transferred_at: parseDate(row['Дата перечисления'] || row['Transferred at']),
    valid_until: parseDate(row['Действует до'] || row['Valid until']),
    message: row['Сообщение'] || row['Message'] || undefined,
    shop_id: row['ID магазина'] || row['Shop ID'] || undefined,
    shop_name: row['Магазин'] || row['Shop'] || undefined,
    business_category: row['Категория бизнеса'] || row['Business category'] || undefined,
    customer_name: row['Имя'] || row['First name'] || undefined,
    customer_surname: row['Фамилия'] || row['Last name'] || undefined,
    customer_address: row['Адрес'] || row['Address'] || undefined,
    customer_country: row['Страна'] || row['Country'] || undefined,
    customer_city: row['Город'] || row['City'] || undefined,
    customer_zip: row['Индекс'] || row['Zip'] || undefined,
    customer_state: row['Область'] || row['State'] || undefined,
    customer_phone: row['Телефон'] || row['Phone'] || undefined,
    ip_address: row['IP'] || row['IP address'] || undefined,
    product_code: row['Код продукта'] || row['Product code'] || undefined,
    card_valid_until: row['Карта действует'] || row['Card valid until'] || undefined,
    card_bin: row['BIN карты'] || row['Card BIN'] || undefined,
    card_bank: row['Банк'] || row['Bank'] || undefined,
    card_bank_country: row['Страна банка'] || row['Bank country'] || undefined,
    three_d_secure: parse3DSecure(row['3-D Secure'] || row['3DS']),
    avs_result: row['Результат AVS'] || row['AVS result'] || undefined,
    fraud_result: row['Fraud'] || row['Fraud result'] || undefined,
    auth_code: row['Код авторизации'] || row['Auth code'] || undefined,
    rrn: row['RRN'] || undefined,
    reason: row['Причина'] || row['Reason'] || undefined,
    matched_by: 'none',
  };
}

function isFeeTransaction(tx: ParsedTransaction): boolean {
  const type = (tx.transaction_type || '').toLowerCase();
  if (type.includes('отмен') || type.includes('cancel')) return true;
  if (type.includes('возврат') || type.includes('refund')) return false;
  const isPaymentType = type.includes('платеж') || type.includes('payment') || type === '';
  if (!isPaymentType) return true;
  if (tx.amount < 1.0) return true;
  return false;
}

export default function SmartImportDialog({ open, onOpenChange, onSuccess }: SmartImportDialogProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<ImportPhase>('upload');
  const [transactions, setTransactions] = useState<ParsedTransaction[]>([]);
  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0, message: '' });
  const [selectedCategories, setSelectedCategories] = useState({ new: true, updates: true, conflicts: false });
  const [autoCreateOrders, setAutoCreateOrders] = useState(true);
  const [fileSummary, setFileSummary] = useState<{ cards: number; erip: number; delimiter?: string }>({ cards: 0, erip: 0 });
  const [detectedSheets, setDetectedSheets] = useState<DetectedSheet[]>([]);
  
  const queryClient = useQueryClient();
  const { mappings } = useBepaidMappings();
  const { createOrderFromQueueAsync } = useBepaidQueueActions();

  // Get transactions to import based on selection
  const transactionsToImport = useMemo(() => {
    if (!report) return [];
    let result: ParsedTransaction[] = [];
    if (selectedCategories.new) result = [...result, ...report.newRecords];
    if (selectedCategories.updates) result = [...result, ...report.updates];
    if (selectedCategories.conflicts) result = [...result, ...report.conflicts];
    return result;
  }, [report, selectedCategories]);

  const handleFileDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) handleFiles(droppedFiles);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length > 0) handleFiles(selectedFiles);
  };

  const handleFiles = async (selectedFiles: File[]) => {
    // Filter valid files
    const validFiles = selectedFiles.filter(f => 
      f.name.endsWith('.csv') || f.name.endsWith('.xlsx') || f.name.endsWith('.xls')
    );
    
    if (validFiles.length === 0) {
      toast.error("Поддерживаются только CSV и Excel файлы");
      return;
    }

    setFiles(validFiles);
    setPhase('parsing');
    setProgress({ current: 0, total: 0, message: 'Чтение файлов...' });

    try {
      let allRows: Record<string, string>[] = [];
      let cardCount = 0;
      let eripCount = 0;
      let lastDelimiter: string | undefined;

      for (const selectedFile of validFiles) {
        const isCSV = selectedFile.name.endsWith('.csv');
        
        if (isCSV) {
          const text = await selectedFile.text();
          // Use proper CSV parser with auto-detect delimiter
          const parseResult = parseCSVContent(text);
          
          if (parseResult.errors.length > 0) {
            console.warn('CSV parse warnings:', parseResult.errors.slice(0, 5));
          }
          
          lastDelimiter = parseResult.delimiter;
          
          // Determine if this is ERIP or cards file
          const isEripFile = selectedFile.name.toLowerCase().includes('erip') || 
                             parseResult.rows.some(r => r['Номер операции ЕРИП'] || r['Расчетный агент']);
          
          const rowsWithSource = parseResult.rows.map(row => ({
            ...row,
            ...(isEripFile ? { 'Способ оплаты': 'erip', '_source': 'erip' } : {})
          }));
          
          if (isEripFile) {
            eripCount += rowsWithSource.length;
          } else {
            cardCount += rowsWithSource.length;
          }
          
          allRows = [...allRows, ...rowsWithSource];
          console.log(`CSV parsed: ${parseResult.rows.length} rows from ${selectedFile.name}, delimiter: "${parseResult.delimiter}"`);
        } else {
          // Excel file processing - detect sheets by NAME, not by index
          const buffer = await selectedFile.arrayBuffer();
          const workbook = XLSX.read(buffer, { type: 'array' });
          
          // Detect all sheets and their types
          const sheets = detectSheetsByName(workbook);
          setDetectedSheets(sheets);
          console.log('Detected sheets:', sheets);
          
          // Find cards sheet by name
          const cardSheetInfo = sheets.find(s => s.type === 'cards');
          let cardRows: Record<string, string>[] = [];
          if (cardSheetInfo && cardSheetInfo.hasUid) {
            const cardSheet = workbook.Sheets[cardSheetInfo.name];
            cardRows = XLSX.utils.sheet_to_json<Record<string, string>>(cardSheet, { defval: '', raw: false });
            console.log(`Cards sheet "${cardSheetInfo.name}": ${cardRows.length} rows`);
          }
          
          // Find ERIP sheet by name
          const eripSheetInfo = sheets.find(s => s.type === 'erip');
          let eripRows: Record<string, string>[] = [];
          if (eripSheetInfo && eripSheetInfo.hasUid) {
            const eripSheet = workbook.Sheets[eripSheetInfo.name];
            const rawEripRows = XLSX.utils.sheet_to_json<Record<string, string>>(eripSheet, { defval: '', raw: false });
            eripRows = rawEripRows.map(row => ({
              ...row,
              'Способ оплаты': 'erip',
              '_source': 'erip'
            }));
            console.log(`ERIP sheet "${eripSheetInfo.name}": ${eripRows.length} rows`);
          }
          
          // Log ignored sheets
          const ignoredSheets = sheets.filter(s => s.type === 'report' || s.type === 'memo');
          if (ignoredSheets.length > 0) {
            console.log('Ignored sheets:', ignoredSheets.map(s => `${s.name} (${s.type})`).join(', '));
          }
          
          cardCount += cardRows.length;
          eripCount += eripRows.length;
          allRows = [...allRows, ...cardRows, ...eripRows];
        }
      }

      if (allRows.length === 0) {
        throw new Error("Файлы пустые или не содержат данных");
      }

      setFileSummary({ cards: cardCount, erip: eripCount, delimiter: lastDelimiter });
      setProgress({ current: 0, total: allRows.length, message: 'Разбор транзакций...' });

      // Parse transactions
      const parsed: ParsedTransaction[] = [];
      for (let i = 0; i < allRows.length; i++) {
        const tx = parseCSVRow(allRows[i]);
        if (tx) parsed.push(tx);
        if (i % 100 === 0) {
          setProgress({ current: i, total: allRows.length, message: `Разбор: ${i} из ${allRows.length}` });
        }
      }

      if (parsed.length === 0) {
        throw new Error("Не удалось распознать транзакции. Проверьте формат файла.");
      }

      setTransactions(parsed);
      setProgress({ current: 0, total: parsed.length, message: 'Сопоставление контактов...' });

      // Match contacts
      await matchContacts(parsed);

      // Run reconciliation
      setProgress({ current: 0, total: parsed.length, message: 'Сверка с базой данных...' });
      await runReconciliation(parsed);
      
      setPhase('reconciliation');
      toast.success(`Загружено ${parsed.length} транзакций (карты: ${cardCount}, ЕРИП: ${eripCount})`);
    } catch (err: any) {
      toast.error("Ошибка парсинга: " + err.message);
      resetDialog();
    }
  };

  const matchContacts = async (txs: ParsedTransaction[]) => {
    const emails = [...new Set(txs.map(t => t.customer_email).filter(Boolean))] as string[];
    
    const { data: profilesByEmail } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('email', emails);
    
    const emailMap = new Map<string, { id: string; name: string }>();
    profilesByEmail?.forEach(p => {
      if (p.email) emailMap.set(p.email.toLowerCase(), { id: p.id, name: p.full_name || '' });
    });

    const { data: cardLinks } = await supabase
      .from('card_profile_links')
      .select('card_last4, card_holder, profile_id, profiles:profile_id(full_name)')
      .in('card_last4', txs.map(t => t.card_last4).filter(Boolean) as string[]);
    
    const cardMap = new Map<string, { id: string; name: string }>();
    cardLinks?.forEach(cl => {
      const key = `${cl.card_last4}|${cl.card_holder || ''}`;
      const profileData = cl.profiles as unknown as { full_name: string | null };
      cardMap.set(key, { id: cl.profile_id, name: profileData?.full_name || '' });
    });

    const { data: allProfiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .not('full_name', 'is', null);
    
    const nameMap = new Map<string, { id: string; name: string }>();
    allProfiles?.forEach(p => {
      if (p.full_name) {
        nameMap.set(p.full_name.toLowerCase(), { id: p.id, name: p.full_name });
      }
    });

    for (const tx of txs) {
      if (tx.customer_email) {
        const match = emailMap.get(tx.customer_email.toLowerCase());
        if (match) {
          tx.matched_profile_id = match.id;
          tx.matched_profile_name = match.name;
          tx.matched_by = 'email';
          continue;
        }
      }

      if (tx.card_last4 && tx.card_holder) {
        const cardKey = `${tx.card_last4}|${tx.card_holder}`;
        const match = cardMap.get(cardKey);
        if (match) {
          tx.matched_profile_id = match.id;
          tx.matched_profile_name = match.name;
          tx.matched_by = 'card';
          continue;
        }
      }

      if (tx.card_holder) {
        const cyrillicName = transliterateToCyrillic(tx.card_holder);
        const normalizedCyrillic = cyrillicName.toLowerCase();
        const match = nameMap.get(normalizedCyrillic);
        if (match) {
          tx.matched_profile_id = match.id;
          tx.matched_profile_name = match.name;
          tx.matched_by = 'name';
        }
      }
    }
  };

  // Helper to normalize DB status to our standard
  const normalizeDbStatus = (status: string): string => {
    const s = (status || '').toLowerCase();
    if (s === 'succeeded' || s === 'successful' || s === 'completed') return 'successful';
    if (s === 'failed' || s === 'error' || s === 'declined') return 'failed';
    if (s === 'refunded' || s === 'refund') return 'refund';
    if (s === 'cancelled' || s === 'voided' || s === 'void') return 'cancel';
    return s || 'pending';
  };

  const runReconciliation = async (txs: ParsedTransaction[]) => {
    // Fetch existing UIDs from both tables - batch to avoid query limits
    const uids = txs.map(t => t.uid);
    const batchSize = 500;
    
    let allQueueRecords: any[] = [];
    let allPaymentRecords: any[] = [];
    
    // Batch fetch from queue
    for (let i = 0; i < uids.length; i += batchSize) {
      const batch = uids.slice(i, i + batchSize);
      const { data } = await supabase
        .from('payment_reconcile_queue')
        .select('bepaid_uid, status_normalized, amount, matched_profile_id')
        .in('bepaid_uid', batch);
      if (data) allQueueRecords.push(...data);
    }
    
    // Batch fetch from payments_v2
    for (let i = 0; i < uids.length; i += batchSize) {
      const batch = uids.slice(i, i + batchSize);
      const { data } = await supabase
        .from('payments_v2')
        .select('provider_payment_id, status, amount, transaction_type')
        .in('provider_payment_id', batch);
      if (data) allPaymentRecords.push(...data);
    }
    
    const queueMap = new Map(allQueueRecords.map(r => [r.bepaid_uid, r]));
    const paymentsMap = new Map(allPaymentRecords.map(r => [r.provider_payment_id, r]));

    const newRecords: ParsedTransaction[] = [];
    const updates: ParsedTransaction[] = [];
    const matches: ParsedTransaction[] = [];
    const conflicts: ParsedTransaction[] = [];

    for (const tx of txs) {
      const existingQueue = queueMap.get(tx.uid);
      const existingPayment = paymentsMap.get(tx.uid);

      if (existingPayment) {
        tx.existing_record = existingPayment;
        
        // CRITICAL FIX: Compare CSV status vs DB status
        const dbStatusNormalized = normalizeDbStatus(existingPayment.status);
        const csvStatus = tx.status_normalized;
        
        // Check if statuses conflict (e.g., DB says succeeded, CSV says failed)
        const statusConflict = dbStatusNormalized !== csvStatus;
        
        // FIX: Handle sign differences for refunds/cancellations
        // DB stores negative amounts for refunds/cancellations, CSV may store positive
        const dbAmount = existingPayment.amount || 0;
        const csvAmount = tx.amount;
        
        // If either amount is negative, compare absolute values to avoid false conflicts
        const amountDiff = (dbAmount < 0 || csvAmount < 0) 
          ? Math.abs(Math.abs(dbAmount) - Math.abs(csvAmount)) > 0.01
          : Math.abs(dbAmount - csvAmount) > 0.01;
        
        if (statusConflict || amountDiff) {
          // CRITICAL CONFLICT: payments_v2 has different status than CSV
          tx.reconcile_status = 'conflict';
          conflicts.push(tx);
        } else {
          tx.reconcile_status = 'match';
          matches.push(tx);
        }
      } else if (existingQueue) {
        // In queue - check for updates
        tx.existing_record = existingQueue;
        
        const statusDiff = existingQueue.status_normalized !== tx.status_normalized;
        
        // FIX: Handle sign differences for refunds/cancellations in queue as well
        const queueAmount = existingQueue.amount || 0;
        const csvAmount = tx.amount;
        const amountDiff = (queueAmount < 0 || csvAmount < 0)
          ? Math.abs(Math.abs(queueAmount) - Math.abs(csvAmount)) > 0.01
          : Math.abs(queueAmount - csvAmount) > 0.01;
          
        const profileDiff = existingQueue.matched_profile_id !== tx.matched_profile_id && tx.matched_profile_id;
        
        if (statusDiff || amountDiff) {
          tx.reconcile_status = 'conflict';
          conflicts.push(tx);
        } else if (profileDiff) {
          tx.reconcile_status = 'update';
          updates.push(tx);
        } else {
          tx.reconcile_status = 'match';
          matches.push(tx);
        }
      } else {
        // New record
        tx.reconcile_status = 'new';
        newRecords.push(tx);
      }
    }

    setReport({
      totalInFile: txs.length,
      newRecords,
      updates,
      matches,
      conflicts,
    });
  };

  const importMutation = useMutation({
    mutationFn: async () => {
      const toImport = transactionsToImport;
      const results: { uid: string; status: string; error?: string }[] = [];
      let ordersCreated = 0;
      
      for (let i = 0; i < toImport.length; i += BATCH_SIZE) {
        const batch = toImport.slice(i, i + BATCH_SIZE);
        setProgress({
          current: i,
          total: toImport.length,
          message: `Импорт: ${i} из ${toImport.length}...`
        });

        for (const tx of batch) {
          try {
            // Check if already exists in payments_v2
            const { data: existingPayment } = await supabase
              .from('payments_v2')
              .select('id')
              .eq('provider_payment_id', tx.uid)
              .maybeSingle();

            if (existingPayment) {
              results.push({ uid: tx.uid, status: 'exists' });
              tx.import_status = 'exists';
              continue;
            }

            // For updates/conflicts, update existing queue record
            if (tx.reconcile_status === 'update' || tx.reconcile_status === 'conflict') {
              const { error: updateError } = await supabase
                .from('payment_reconcile_queue')
                .update({
                  matched_profile_id: tx.matched_profile_id,
                  amount: tx.amount,
                  status_normalized: tx.status_normalized,
                })
                .eq('bepaid_uid', tx.uid);
              
              if (updateError) {
                results.push({ uid: tx.uid, status: 'error', error: updateError.message });
                tx.import_status = 'error';
              } else {
                results.push({ uid: tx.uid, status: 'updated' });
                tx.import_status = 'imported';
              }
              continue;
            }

            // Insert new record into queue
            const insertData: any = {
              bepaid_uid: tx.uid,
              bepaid_order_id: tx.bepaid_order_id,
              tracking_id: tx.tracking_id,
              amount: tx.amount,
              currency: tx.currency,
              customer_email: tx.customer_email,
              description: tx.description,
              matched_profile_id: tx.matched_profile_id,
              paid_at: tx.paid_at,
              created_at_bepaid: tx.created_at,
              source: 'file_import',
              status: 'pending',
              status_normalized: tx.status_normalized,
              transaction_type: tx.transaction_type,
              card_last4: tx.card_last4,
              card_holder: tx.card_holder,
              card_brand: tx.card_brand,
              payment_method: tx.payment_method,
              product_code: tx.product_code,
              customer_name: tx.customer_name,
              customer_surname: tx.customer_surname,
              fee_percent: tx.fee_percent,
              fee_amount: tx.fee_amount,
              total_fee: tx.total_fee,
              transferred_amount: tx.transferred_amount,
              shop_id: tx.shop_id,
              rrn: tx.rrn,
              is_fee: isFeeTransaction(tx),
              raw_payload: tx,
            };

            const { data: insertedRecord, error } = await supabase
              .from('payment_reconcile_queue')
              .insert(insertData)
              .select('id')
              .single();

            if (error) {
              results.push({ uid: tx.uid, status: 'error', error: error.message });
              tx.import_status = 'error';
              tx.import_error = error.message;
            } else {
              // Auto-create order if enabled
              if (autoCreateOrders && tx.matched_profile_id && insertedRecord) {
                const mapping = mappings.find(m => 
                  m.bepaid_plan_title === tx.description || 
                  m.bepaid_plan_title === tx.card_holder
                );
                
                if (mapping && mapping.auto_create_order && mapping.product_id) {
                  try {
                    await createOrderFromQueueAsync({
                      queueItemId: insertedRecord.id,
                      profileId: tx.matched_profile_id,
                      productId: mapping.product_id || undefined,
                      tariffId: mapping.tariff_id || undefined,
                      offerId: mapping.offer_id || undefined,
                    });
                    results.push({ uid: tx.uid, status: 'order_created' });
                    tx.import_status = 'order_created';
                    ordersCreated++;
                  } catch {
                    results.push({ uid: tx.uid, status: 'imported' });
                    tx.import_status = 'imported';
                  }
                } else {
                  results.push({ uid: tx.uid, status: 'imported' });
                  tx.import_status = 'imported';
                }
              } else {
                results.push({ uid: tx.uid, status: 'imported' });
                tx.import_status = 'imported';
              }
            }
          } catch (err: any) {
            results.push({ uid: tx.uid, status: 'error', error: err.message });
            tx.import_status = 'error';
            tx.import_error = err.message;
          }
        }
      }

      return { results, ordersCreated };
    },
    onSuccess: ({ results, ordersCreated }) => {
      const imported = results.filter(r => r.status === 'imported').length;
      const orderCreated = results.filter(r => r.status === 'order_created').length;
      const updated = results.filter(r => r.status === 'updated').length;
      const exists = results.filter(r => r.status === 'exists').length;
      const errors = results.filter(r => r.status === 'error').length;

      let message = '';
      if (orderCreated > 0) message += `Создано сделок: ${orderCreated}. `;
      if (imported > 0) message += `Импортировано: ${imported}. `;
      if (updated > 0) message += `Обновлено: ${updated}. `;
      
      if (message) toast.success(message.trim());
      if (exists > 0 && imported === 0 && updated === 0 && orderCreated === 0) toast.info(`Все ${exists} уже в базе`);
      if (errors > 0) toast.error(`Ошибок: ${errors}`);

      queryClient.invalidateQueries({ queryKey: ["bepaid-queue"] });
      queryClient.invalidateQueries({ queryKey: ["bepaid-stats"] });
      queryClient.invalidateQueries({ queryKey: ["bepaid-payments"] });
      queryClient.invalidateQueries({ queryKey: ["unified-payments"] });
      
      setPhase('complete');
      onSuccess?.();
    },
    onError: (error: any) => {
      toast.error("Ошибка импорта: " + error.message);
    },
  });

  const handleImport = () => {
    if (transactionsToImport.length === 0) {
      toast.warning("Выберите категории для импорта");
      return;
    }
    setPhase('importing');
    importMutation.mutate();
  };

  // Map status_normalized to canonical DB values for overrides
  // CRITICAL: Must match RPC exactly
  const toCanonicalStatus = (status: string): string => {
    switch (status) {
      case 'successful': return 'succeeded';
      case 'refund': return 'refunded';
      case 'cancel': return 'canceled';
      case 'cancelled': return 'canceled';
      case 'void': return 'canceled';
      default: return status;
    }
  };

  // Apply status overrides for conflicts with payments_v2
  const applyOverridesMutation = useMutation({
    mutationFn: async () => {
      const conflictsToOverride = report?.conflicts.filter(c => 
        c.existing_record && c.reconcile_status === 'conflict'
      ) || [];
      
      let applied = 0;
      for (const tx of conflictsToOverride) {
        const canonicalStatus = toCanonicalStatus(tx.status_normalized);
        const { error } = await supabase
          .from('payment_status_overrides')
          .upsert({
            provider: 'bepaid',
            uid: tx.uid,
            status_override: canonicalStatus,
            original_status: tx.existing_record?.status,
            reason: `CSV reconciliation: CSV status "${tx.status_normalized}" → "${canonicalStatus}" vs DB status "${tx.existing_record?.status}"`,
            source: 'csv_import',
          }, { onConflict: 'provider,uid' });
        
        if (!error) applied++;
      }
      
      return { applied, total: conflictsToOverride.length };
    },
    onSuccess: ({ applied, total }) => {
      toast.success(`Применено ${applied} из ${total} переопределений статусов`);
      // Invalidate all payment-related queries to refresh totals
      queryClient.invalidateQueries({ queryKey: ['unified-payments'] });
      queryClient.invalidateQueries({ queryKey: ['bepaid-queue'] });
      queryClient.invalidateQueries({ queryKey: ['bepaid-stats'] });
      queryClient.invalidateQueries({ queryKey: ['bepaid-payments'] });
      queryClient.invalidateQueries({ queryKey: ['contact-payments'] });
    },
    onError: (error: any) => {
      toast.error("Ошибка применения переопределений: " + error.message);
    },
  });

  const resetDialog = () => {
    setFiles([]);
    setTransactions([]);
    setReport(null);
    setPhase('upload');
    setProgress({ current: 0, total: 0, message: '' });
    setSelectedCategories({ new: true, updates: true, conflicts: false });
    setFileSummary({ cards: 0, erip: 0 });
    setDetectedSheets([]);
  };

  const StatCard = ({ 
    title, 
    count, 
    icon: Icon, 
    color, 
    selected, 
    onToggle,
    disabled = false 
  }: { 
    title: string; 
    count: number; 
    icon: any; 
    color: string; 
    selected?: boolean; 
    onToggle?: () => void;
    disabled?: boolean;
  }) => (
    <Card 
      className={cn(
        "cursor-pointer transition-all",
        selected && "ring-2 ring-primary",
        disabled && "opacity-50 cursor-not-allowed"
      )}
      onClick={() => !disabled && onToggle?.()}
    >
      <CardContent className="p-4 flex items-center gap-3">
        <div className={cn("p-2 rounded-lg", color)}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-2xl font-bold">{count}</p>
          <p className="text-sm text-muted-foreground">{title}</p>
        </div>
        {onToggle && (
          <Checkbox 
            checked={selected} 
            className="ml-auto"
            disabled={disabled}
          />
        )}
      </CardContent>
    </Card>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetDialog(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[1000px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompare className="h-5 w-5" />
            Умный импорт bePaid
          </DialogTitle>
          <DialogDescription>
            Загрузка с предварительной сверкой и пакетной обработкой
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          {phase === 'upload' && (
            <div
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors h-64 flex flex-col items-center justify-center"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleFileDrop}
              onClick={() => document.getElementById('smart-file-input')?.click()}
            >
              <input
                id="smart-file-input"
                type="file"
                accept=".csv,.xlsx,.xls"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />
              <Upload className="h-12 w-12 mb-4 text-muted-foreground" />
              <p className="text-lg font-medium">Перетащите файлы сюда</p>
              <p className="text-sm text-muted-foreground mt-1">
                CSV (карты + ЕРИП) или Excel экспорт из bePaid
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Можно загрузить несколько CSV файлов одновременно
              </p>
            </div>
          )}

          {phase === 'parsing' && (
            <div className="text-center py-12 space-y-4">
              <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />
              <p className="text-lg font-medium">{progress.message}</p>
              {progress.total > 0 && (
                <div className="max-w-md mx-auto">
                  <Progress value={(progress.current / progress.total) * 100} />
                  <p className="text-sm text-muted-foreground mt-2">
                    {progress.current} из {progress.total}
                  </p>
                </div>
              )}
            </div>
          )}

          {phase === 'reconciliation' && report && (
            <div className="space-y-6">
              {/* Info message when nothing to import but there are conflicts */}
              {report.newRecords.length === 0 && report.updates.length === 0 && report.conflicts.length > 0 && (
                <Card className="border-amber-500/50 bg-amber-50 dark:bg-amber-900/10">
                  <CardContent className="p-4 flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-amber-800 dark:text-amber-200">
                        Все транзакции уже в базе
                      </p>
                      <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                        Импортировать нечего, но есть {report.conflicts.length} конфликтов статусов. 
                        Нажмите <strong>"Применить статусы из CSV"</strong> для выравнивания базы с файлом.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Info message when everything matches */}
              {report.newRecords.length === 0 && report.updates.length === 0 && report.conflicts.length === 0 && (
                <Card className="border-green-500/50 bg-green-50 dark:bg-green-900/10">
                  <CardContent className="p-4 flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-green-800 dark:text-green-200">
                        База данных полностью синхронизирована с файлом
                      </p>
                      <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                        Все {report.matches.length} транзакций совпадают. Никаких действий не требуется.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Stats cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard 
                  title="Новые записи" 
                  count={report.newRecords.length} 
                  icon={Plus} 
                  color="bg-green-100 text-green-600 dark:bg-green-900/30"
                  selected={selectedCategories.new}
                  onToggle={() => setSelectedCategories(s => ({ ...s, new: !s.new }))}
                  disabled={report.newRecords.length === 0}
                />
                <StatCard 
                  title="Обновления" 
                  count={report.updates.length} 
                  icon={ArrowUp} 
                  color="bg-blue-100 text-blue-600 dark:bg-blue-900/30"
                  selected={selectedCategories.updates}
                  onToggle={() => setSelectedCategories(s => ({ ...s, updates: !s.updates }))}
                  disabled={report.updates.length === 0}
                />
                <StatCard 
                  title="Совпадения" 
                  count={report.matches.length} 
                  icon={Equal} 
                  color="bg-gray-100 text-gray-600 dark:bg-gray-900/30"
                  disabled
                />
                <StatCard 
                  title="Конфликты" 
                  count={report.conflicts.length} 
                  icon={AlertTriangle} 
                  color="bg-amber-100 text-amber-600 dark:bg-amber-900/30"
                  selected={selectedCategories.conflicts}
                  onToggle={() => setSelectedCategories(s => ({ ...s, conflicts: !s.conflicts }))}
                  disabled={report.conflicts.length === 0}
                />
              </div>

              {/* CSV Financial Summary */}
              <Card className="bg-primary/5 border-primary/20">
                <CardContent className="p-4">
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Успешные в CSV</p>
                      <p className="text-xl font-bold text-green-600">
                        {transactions.filter(t => t.status_normalized === 'successful' && !['refund', 'void', 'cancel'].includes((t.transaction_type || '').toLowerCase().replace('возврат средств', 'refund').replace('отмена', 'void'))).reduce((s, t) => s + t.amount, 0).toFixed(2)} BYN
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {transactions.filter(t => t.status_normalized === 'successful' && !['refund', 'void', 'cancel'].includes((t.transaction_type || '').toLowerCase())).length} операций
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Возвраты в CSV</p>
                      <p className="text-xl font-bold text-amber-600">
                        {transactions.filter(t => t.status_normalized === 'refund' || (t.transaction_type || '').toLowerCase().includes('возврат')).reduce((s, t) => s + Math.abs(t.amount), 0).toFixed(2)} BYN
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {transactions.filter(t => t.status_normalized === 'refund' || (t.transaction_type || '').toLowerCase().includes('возврат')).length} возвратов
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Отмены в CSV</p>
                      <p className="text-xl font-bold text-orange-600">
                        {transactions.filter(t => t.status_normalized === 'cancel' || (t.transaction_type || '').toLowerCase().includes('отмен')).reduce((s, t) => s + Math.abs(t.amount), 0).toFixed(2)} BYN
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {transactions.filter(t => t.status_normalized === 'cancel' || (t.transaction_type || '').toLowerCase().includes('отмен')).length} отмен
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Неуспешные в CSV</p>
                      <p className="text-xl font-bold text-red-600">
                        {transactions.filter(t => t.status_normalized === 'failed').reduce((s, t) => s + t.amount, 0).toFixed(2)} BYN
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {transactions.filter(t => t.status_normalized === 'failed').length} операций
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Конфликты статусов</p>
                      <p className="text-xl font-bold text-orange-600">
                        {report.conflicts.length}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        CSV ≠ База
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Detected Excel sheets info */}
              {detectedSheets.length > 0 && (
                <Card className="bg-muted/30 border-muted">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Листы в файле:</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {detectedSheets.map(sheet => (
                        <Badge 
                          key={sheet.name}
                          variant={
                            sheet.type === 'cards' || sheet.type === 'erip' 
                              ? 'default' 
                              : sheet.type === 'report' 
                                ? 'secondary' 
                                : 'outline'
                          }
                          className="text-xs"
                        >
                          {sheet.type === 'cards' && '💳 '}
                          {sheet.type === 'erip' && '🏦 '}
                          {sheet.type === 'report' && '📊 '}
                          {sheet.type === 'memo' && '⏭️ '}
                          {sheet.name}
                          {sheet.hasUid && sheet.rowCount > 0 && ` (${sheet.rowCount})`}
                          {sheet.type === 'memo' && ' — игнор.'}
                          {sheet.type === 'report' && ' — сверка'}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              <div className="flex items-center gap-4 flex-wrap p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  <span className="font-medium">
                    {files.length === 1 ? files[0].name : `${files.length} файлов`}
                    {fileSummary.cards > 0 && ` (карты: ${fileSummary.cards})`}
                    {fileSummary.erip > 0 && ` (ЕРИП: ${fileSummary.erip})`}
                  </span>
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <Switch
                    id="autoCreateOrders"
                    checked={autoCreateOrders}
                    onCheckedChange={setAutoCreateOrders}
                  />
                  <Label htmlFor="autoCreateOrders" className="text-sm">
                    Автосоздание сделок
                  </Label>
                </div>
              </div>

              {/* Preview tabs */}
              <Tabs defaultValue="new" className="flex-1">
                <TabsList>
                  <TabsTrigger value="new">
                    Новые ({report.newRecords.length})
                  </TabsTrigger>
                  <TabsTrigger value="updates">
                    Обновления ({report.updates.length})
                  </TabsTrigger>
                  <TabsTrigger value="conflicts">
                    Конфликты ({report.conflicts.length})
                  </TabsTrigger>
                </TabsList>
                
                <TabsContent value="new" className="mt-4">
                  <TransactionPreviewTable transactions={report.newRecords.slice(0, 50)} />
                </TabsContent>
                <TabsContent value="updates" className="mt-4">
                  <TransactionPreviewTable transactions={report.updates.slice(0, 50)} />
                </TabsContent>
                <TabsContent value="conflicts" className="mt-4">
                  <TransactionPreviewTable transactions={report.conflicts.slice(0, 50)} showConflict />
                </TabsContent>
              </Tabs>
            </div>
          )}

          {phase === 'importing' && (
            <div className="text-center py-12 space-y-4">
              <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />
              <p className="text-lg font-medium">{progress.message}</p>
              <div className="max-w-md mx-auto">
                <Progress value={(progress.current / progress.total) * 100} />
                <p className="text-sm text-muted-foreground mt-2">
                  {progress.current} из {progress.total}
                </p>
              </div>
            </div>
          )}

          {phase === 'complete' && (
            <div className="text-center py-12 space-y-4">
              <CheckCircle2 className="h-16 w-16 mx-auto text-green-500" />
              <p className="text-xl font-medium">Импорт завершен!</p>
              <Button onClick={() => { resetDialog(); onOpenChange(false); }}>
                Закрыть
              </Button>
            </div>
          )}
        </div>

        {phase === 'reconciliation' && (
          <DialogFooter className="gap-2 flex-wrap">
            <Button variant="outline" onClick={resetDialog}>
              Отмена
            </Button>
            {report && report.conflicts.length > 0 && (
              <Button 
                variant="secondary"
                onClick={() => applyOverridesMutation.mutate()}
                disabled={applyOverridesMutation.isPending}
              >
                {applyOverridesMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <AlertTriangle className="h-4 w-4 mr-2" />
                )}
                Применить статусы из CSV ({report.conflicts.length})
              </Button>
            )}
            <Button 
              onClick={handleImport} 
              disabled={transactionsToImport.length === 0}
              title={transactionsToImport.length === 0 ? "Все транзакции уже в базе. Для выравнивания статусов нажмите 'Применить статусы из CSV'" : undefined}
            >
              <ArrowRight className="h-4 w-4 mr-2" />
              {transactionsToImport.length === 0 ? 'Нечего импортировать' : `Импортировать (${transactionsToImport.length})`}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TransactionPreviewTable({ 
  transactions, 
  showConflict = false 
}: { 
  transactions: ParsedTransaction[]; 
  showConflict?: boolean;
}) {
  if (transactions.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Нет записей в этой категории
      </div>
    );
  }

  return (
    <ScrollArea className="h-[250px] border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Дата</TableHead>
            <TableHead className="text-right">Сумма</TableHead>
            <TableHead>Статус</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Контакт</TableHead>
            {showConflict && <TableHead>Конфликт</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {transactions.map((tx, i) => (
            <TableRow key={tx.uid || i}>
              <TableCell className="whitespace-nowrap text-sm">
                {tx.paid_at && format(new Date(tx.paid_at), "dd.MM.yyyy HH:mm", { locale: ru })}
              </TableCell>
              <TableCell className="text-right font-medium">
                {tx.amount} {tx.currency}
              </TableCell>
              <TableCell>
                <StatusBadge status={tx.status_normalized} />
              </TableCell>
              <TableCell className="text-sm text-muted-foreground max-w-[150px] truncate">
                {tx.customer_email || '—'}
              </TableCell>
              <TableCell>
                {tx.matched_profile_name ? (
                  <Badge variant="secondary" className="text-xs">
                    <User className="h-3 w-3 mr-1" />
                    {tx.matched_profile_name}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground text-xs">—</span>
                )}
              </TableCell>
              {showConflict && tx.existing_record && (
                <TableCell className="text-xs text-amber-600">
                  DB: {tx.existing_record.amount} / {tx.existing_record.status_normalized}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'successful': return <Badge variant="default" className="bg-green-600 text-xs">Успешно</Badge>;
    case 'failed': return <Badge variant="destructive" className="text-xs">Ошибка</Badge>;
    case 'refund': return <Badge variant="outline" className="border-amber-500 text-amber-600 text-xs">Возврат</Badge>;
    case 'cancel': return <Badge variant="secondary" className="text-xs">Отмена</Badge>;
    default: return <Badge variant="outline" className="text-xs">{status}</Badge>;
  }
}