import { useState, useCallback } from "react";
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
import { 
  Upload, FileSpreadsheet, AlertCircle, CheckCircle2, 
  Loader2, X, FileText, ArrowRight, User, Mail, CreditCard, ShoppingCart
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBepaidMappings, useBepaidQueueActions } from "@/hooks/useBepaidMappings";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import * as XLSX from "xlsx";
import { transliterateToCyrillic } from "@/utils/transliteration";

interface BepaidImportDialogProps {
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
  // Extended bePaid fields
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
  // Matching results
  matched_profile_id?: string;
  matched_profile_name?: string;
  matched_by?: 'email' | 'card' | 'name' | 'none';
  // Auto-create order results
  auto_created_order?: boolean;
  order_id?: string;
  // Import status
  import_status?: 'pending' | 'exists' | 'imported' | 'error' | 'order_created';
  import_error?: string;
}

interface ImportStats {
  total: number;
  payments: number;
  refunds: number;
  cancels: number;
  errors: number;
  matched: number;
  unmatched: number;
}

// Re-export from shared utility for backwards compatibility
export { transliterateToCyrillic } from "@/utils/transliteration";

// Parse bePaid CSV row with all fields from export
function parseCSVRow(row: Record<string, string>): ParsedTransaction | null {
  const uid = row['UID'] || row['uid'] || row['ID транзакции'];
  if (!uid) return null;

  const statusRaw = (row['Статус'] || row['Status'] || '').toLowerCase();
  const typeRaw = row['Тип транзакции'] || row['Transaction type'] || 'Платеж';
  const messageRaw = (row['Сообщение'] || row['Message'] || '').toLowerCase();
  
  // Определяем тип транзакции
  const isRefund = typeRaw.includes('Возврат') || typeRaw.toLowerCase().includes('refund');
  const isCancel = typeRaw.includes('Отмен') || typeRaw.toLowerCase().includes('cancel');
  const isDeclined = messageRaw.includes('declined') || messageRaw.includes('отклон') || 
                     messageRaw.includes('error') || messageRaw.includes('insufficient');
  
  let status_normalized: ParsedTransaction['status_normalized'] = 'pending';
  
  // 1. Сначала проверяем тип транзакции (refund имеет приоритет)
  if (isRefund) {
    status_normalized = 'refund';
  }
  // 2. Затем проверяем cancel
  else if (isCancel) {
    status_normalized = 'cancel';
  }
  // 3. Проверяем declined в message (даже если статус "успешный")
  else if (isDeclined) {
    status_normalized = 'failed';
  }
  // 4. Проверяем неуспешный статус
  else if (statusRaw.includes('неуспеш') || statusRaw.includes('ошибк') || statusRaw === 'failed' || statusRaw === 'error') {
    status_normalized = 'failed';
  }
  // 5. Наконец проверяем успешный статус
  else if (statusRaw.includes('успеш') || statusRaw === 'successful') {
    status_normalized = 'successful';
  }

  // Parse numeric with comma as decimal separator
  const parseNum = (val: any): number | undefined => {
    if (val === undefined || val === null || val === '') return undefined;
    const str = typeof val === 'number' ? String(val) : String(val);
    const num = parseFloat(str.replace(',', '.').replace(/[^\d.-]/g, ''));
    return isNaN(num) ? undefined : num;
  };

  const amount = parseNum(row['Сумма'] || row['Amount']) || 0;

  // Parse card mask to get last 4 digits (formats: "49169896 xxxx 9310" or "**** 1234")
  const cardMask = row['Карта'] || row['Card'] || '';
  const cardLast4Match = cardMask.match(/(\d{4})\s*$/);
  const card_last4 = cardLast4Match ? cardLast4Match[1] : undefined;

  // Determine card brand from card number or method
  const paymentMethod = row['Способ оплаты'] || row['Payment method'] || '';
  let card_brand = paymentMethod.toLowerCase();
  if (cardMask.startsWith('4')) card_brand = 'visa';
  else if (cardMask.startsWith('5')) card_brand = 'mastercard';

  // Parse dates (multiple formats supported)
  const parseDate = (dateStr: string | undefined): string | undefined => {
    if (!dateStr) return undefined;
    
    // Try DD.MM.YYYY HH:mm:ss format
    let match = dateStr.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):?(\d{2})?/);
    if (match) {
      const [, day, month, year, hour, min, sec = '00'] = match;
      return `${year}-${month}-${day}T${hour}:${min}:${sec}`;
    }
    
    // Try YYYY-MM-DD HH:mm:ss +0300 format (bePaid Excel export)
    match = dateStr.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s*([+-]\d{4})?/);
    if (match) {
      const [, year, month, day, hour, min, sec] = match;
      return `${year}-${month}-${day}T${hour}:${min}:${sec}`;
    }
    
    return dateStr;
  };

  // Parse 3-D Secure field
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
    transaction_type: typeRaw,
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
    payment_method: paymentMethod.toLowerCase() || undefined,
    // Extended bePaid fields
    fee_percent: parseNum(row['Комиссия,%'] || row['Fee %']),
    fee_amount: parseNum(row['Комиссия за операцию'] || row['Fee amount']),
    total_fee: parseNum(row['Сумма комиссий'] || row['Total fee']),
    transferred_amount: parseNum(row['Перечисленная сумма'] || row['Transferred amount']),
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

// Determine if a transaction is an acquiring fee (not a real customer payment)
function isFeeTransaction(tx: ParsedTransaction): boolean {
  const type = (tx.transaction_type || '').toLowerCase();
  
  // Cancellations (Отмена) are fees/adjustments, not real payments
  if (type.includes('отмен') || type.includes('cancel')) {
    return true;
  }
  
  // Refunds are NOT fees - they're relevant for tracking
  if (type.includes('возврат') || type.includes('refund')) {
    return false;
  }
  
  // If transaction type is NOT a payment (Платеж/Payment), it's likely a fee
  const isPaymentType = type.includes('платеж') || type.includes('payment') || type === '';
  if (!isPaymentType) {
    return true;
  }
  
  // Very small amounts (less than 1 BYN) are typically acquiring fees
  if (tx.amount < 1.0) {
    return true;
  }
  
  return false;
}

export default function BepaidImportDialog({ open, onOpenChange, onSuccess }: BepaidImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [transactions, setTransactions] = useState<ParsedTransaction[]>([]);
  const [stats, setStats] = useState<ImportStats | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [skipExisting, setSkipExisting] = useState(true);
  const [autoMatch, setAutoMatch] = useState(true);
  const [autoCreateOrders, setAutoCreateOrders] = useState(true);
  const queryClient = useQueryClient();
  const { mappings } = useBepaidMappings();
  const { createOrderFromQueueAsync } = useBepaidQueueActions();

  const handleFileDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) handleFile(droppedFile);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) handleFile(selectedFile);
  };

  const handleFile = async (selectedFile: File) => {
    const isCSV = selectedFile.name.endsWith('.csv');
    const isXLSX = selectedFile.name.endsWith('.xlsx') || selectedFile.name.endsWith('.xls');
    
    if (!isCSV && !isXLSX) {
      toast.error("Поддерживаются только CSV и Excel файлы");
      return;
    }

    setFile(selectedFile);
    setIsParsing(true);

    try {
      let rows: Record<string, string>[] = [];

      if (isCSV) {
        const text = await selectedFile.text();
        const lines = text.split('\n');
        if (lines.length < 2) {
          throw new Error("Файл пустой или не содержит данных");
        }
        
        // Parse CSV with semicolon separator (bePaid format)
        const headers = lines[0].split(';').map(h => h.trim().replace(/"/g, ''));
        rows = lines.slice(1)
          .filter(line => line.trim())
          .map(line => {
            const values = line.split(';').map(v => v.trim().replace(/"/g, ''));
            const row: Record<string, string> = {};
            headers.forEach((h, i) => { row[h] = values[i] || ''; });
            return row;
          });
      } else {
        // Parse Excel - bePaid exports have 2 sheets: summary (first) and details (second)
        const buffer = await selectedFile.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        
        // Try second sheet first (detailed transactions), fall back to first sheet
        let sheetName = workbook.SheetNames[1] || workbook.SheetNames[0];
        let sheet = workbook.Sheets[sheetName];
        let tempRows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' });
        
        // If second sheet doesn't have UID column, try first sheet
        if (tempRows.length > 0 && !('UID' in tempRows[0]) && workbook.SheetNames.length > 1) {
          // Second sheet didn't have UID, maybe structure is different - try with raw option
          tempRows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '', raw: false });
        }
        
        // Still no UID? Try first sheet
        if (tempRows.length > 0 && !('UID' in tempRows[0]) && workbook.SheetNames[0] !== sheetName) {
          sheetName = workbook.SheetNames[0];
          sheet = workbook.Sheets[sheetName];
          tempRows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' });
        }
        
        rows = tempRows;
        console.log("Excel parsed:", { sheetName, rowCount: rows.length, columns: rows[0] ? Object.keys(rows[0]) : [] });
      }

      // Parse transactions
      const parsed: ParsedTransaction[] = [];
      for (const row of rows) {
        const tx = parseCSVRow(row);
        if (tx) parsed.push(tx);
      }

      if (parsed.length === 0) {
        throw new Error("Не удалось распознать транзакции. Проверьте формат файла.");
      }

      // Auto-match contacts if enabled
      // Filter to only successful payments
      const successfulOnly = parsed.filter(tx => tx.status_normalized === 'successful');

      if (autoMatch) {
        await matchContacts(successfulOnly);
      }

      setTransactions(successfulOnly);
      calculateStats(successfulOnly);
      toast.success(`Загружено ${parsed.length} транзакций`);
    } catch (err: any) {
      toast.error("Ошибка парсинга: " + err.message);
      setFile(null);
    } finally {
      setIsParsing(false);
    }
  };

  const matchContacts = async (txs: ParsedTransaction[]) => {
    // Get unique emails and card info
    const emails = [...new Set(txs.map(t => t.customer_email).filter(Boolean))] as string[];
    const cardInfos = [...new Set(txs.filter(t => t.card_last4 && t.card_holder)
      .map(t => `${t.card_last4}|${t.card_holder}`))] as string[];

    // Fetch profiles by email
    const { data: profilesByEmail } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('email', emails);
    
    const emailMap = new Map<string, { id: string; name: string }>();
    profilesByEmail?.forEach(p => {
      if (p.email) emailMap.set(p.email.toLowerCase(), { id: p.id, name: p.full_name || '' });
    });

    // Fetch card-profile links
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

    // Fetch all profiles for name matching (transliteration)
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

    // Match each transaction
    for (const tx of txs) {
      // Try email match first
      if (tx.customer_email) {
        const match = emailMap.get(tx.customer_email.toLowerCase());
        if (match) {
          tx.matched_profile_id = match.id;
          tx.matched_profile_name = match.name;
          tx.matched_by = 'email';
          continue;
        }
      }

      // Try card match
      if (tx.card_last4 && tx.card_holder) {
        const key = `${tx.card_last4}|${tx.card_holder}`;
        const match = cardMap.get(key);
        if (match) {
          tx.matched_profile_id = match.id;
          tx.matched_profile_name = match.name;
          tx.matched_by = 'card';
          continue;
        }
      }

      // Try transliterated name match
      if (tx.card_holder) {
        const translitName = transliterateToCyrillic(tx.card_holder);
        const match = nameMap.get(translitName.toLowerCase());
        if (match) {
          tx.matched_profile_id = match.id;
          tx.matched_profile_name = match.name;
          tx.matched_by = 'name';
          continue;
        }
      }

      tx.matched_by = 'none';
    }
  };

  const calculateStats = (txs: ParsedTransaction[]) => {
    setStats({
      total: txs.length,
      payments: txs.filter(t => t.status_normalized === 'successful').length,
      refunds: txs.filter(t => t.status_normalized === 'refund').length,
      cancels: txs.filter(t => t.status_normalized === 'cancel').length,
      errors: txs.filter(t => t.status_normalized === 'failed').length,
      matched: txs.filter(t => t.matched_by !== 'none').length,
      unmatched: txs.filter(t => t.matched_by === 'none').length,
    });
  };

  const importMutation = useMutation({
    mutationFn: async () => {
      const results: { uid: string; status: 'imported' | 'updated' | 'exists' | 'error' | 'order_created'; error?: string }[] = [];
      let ordersCreated = 0;
      
      for (const tx of transactions) {
        try {
          // Check if exists
          const { data: existing } = await supabase
            .from('payment_reconcile_queue')
            .select('id, status, matched_profile_id, amount')
            .eq('bepaid_uid', tx.uid)
            .maybeSingle();
          
          if (existing) {
            if (skipExisting) {
              // Check if we need to update (e.g., new match found)
              const needsUpdate = 
                (!existing.matched_profile_id && tx.matched_profile_id) ||
                (existing.amount !== tx.amount);
              
              if (needsUpdate) {
                const { error: updateError } = await supabase
                  .from('payment_reconcile_queue')
                  .update({
                    matched_profile_id: tx.matched_profile_id,
                    amount: tx.amount,
                  })
                  .eq('id', existing.id);
                
                if (updateError) {
                  results.push({ uid: tx.uid, status: 'error', error: updateError.message });
                  tx.import_status = 'error';
                  tx.import_error = updateError.message;
                } else {
                  results.push({ uid: tx.uid, status: 'updated' });
                  tx.import_status = 'exists'; // Show as exists but was updated
                }
              } else {
                results.push({ uid: tx.uid, status: 'exists' });
                tx.import_status = 'exists';
              }
              continue;
            }
          }

          // Insert into queue - save all bePaid fields directly to columns
          // NOTE: Keep this insert loosely typed so it doesn't break when DB types lag behind migrations.
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
            // Card info
            card_last4: tx.card_last4,
            card_holder: tx.card_holder,
            card_brand: tx.card_brand,
            card_valid_until: tx.card_valid_until,
            card_bin: tx.card_bin,
            card_bank: tx.card_bank,
            card_bank_country: tx.card_bank_country,
            payment_method: tx.payment_method,
            product_code: tx.product_code,
            // Customer info
            customer_name: tx.customer_name,
            customer_surname: tx.customer_surname,
            customer_address: tx.customer_address,
            customer_country: tx.customer_country,
            customer_city: tx.customer_city,
            customer_zip: tx.customer_zip,
            customer_state: tx.customer_state,
            customer_phone: tx.customer_phone,
            ip_address: tx.ip_address,
            // Fees & amounts
            fee_percent: tx.fee_percent,
            fee_amount: tx.fee_amount,
            total_fee: tx.total_fee,
            transferred_amount: tx.transferred_amount,
            transferred_at: tx.transferred_at,
            valid_until: tx.valid_until,
            // Shop info
            shop_id: tx.shop_id,
            shop_name: tx.shop_name,
            business_category: tx.business_category,
            message: tx.message,
            // Security & auth
            three_d_secure: tx.three_d_secure,
            avs_result: tx.avs_result,
            fraud_result: tx.fraud_result,
            auth_code: tx.auth_code,
            rrn: tx.rrn,
            reason: tx.reason,
            // Mark as fee if this is an acquiring commission
            is_fee: isFeeTransaction(tx),
            // Keep raw_payload for any additional data
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
              // Check if we should auto-create order
              if (autoCreateOrders && tx.matched_profile_id && insertedRecord) {
                // First check if payment already exists (prevent duplicates)
                const { data: existingPayment } = await supabase
                  .from('payments_v2')
                  .select('id')
                  .eq('provider_payment_id', tx.uid)
                  .maybeSingle();

                if (existingPayment) {
                  // Payment already exists, skip order creation
                  results.push({ uid: tx.uid, status: 'exists' });
                  tx.import_status = 'exists';
                  continue;
                }

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
                    tx.auto_created_order = true;
                    ordersCreated++;
                  } catch (orderError: any) {
                    // Order creation failed, but import succeeded
                    results.push({ uid: tx.uid, status: 'imported' });
                    tx.import_status = 'imported';
                    console.error("Auto-create order failed:", orderError);
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

      return { results, ordersCreated };
    },
    onSuccess: async ({ results, ordersCreated }) => {
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
      onSuccess?.();
      
      // PATCH 14: Auto-fetch receipts after import
      const importedCount = imported + orderCreated + updated;
      if (importedCount > 0) {
        try {
          toast.info("Загружаем чеки...");
          const { data, error } = await supabase.functions.invoke('bepaid-receipts-sync', {
            body: { source: 'queue', batch_size: Math.min(importedCount, 50) }
          });
          if (error) {
            console.warn("Auto-fetch receipts failed:", error);
          } else if (data?.report?.receipts_updated > 0) {
            toast.success(`Загружено чеков: ${data.report.receipts_updated}`);
          }
          queryClient.invalidateQueries({ queryKey: ["bepaid-queue"] });
          queryClient.invalidateQueries({ queryKey: ["unified-payments"] });
        } catch (receiptError) {
          console.warn("Auto-fetch receipts error:", receiptError);
        }
      }
      
      // Update display
      setTransactions([...transactions]);
      
      // Close dialog after successful import
      if (errors === 0) {
        setTimeout(() => {
          resetDialog();
          onOpenChange(false);
        }, 1500);
      }
    },
    onError: (error: any) => {
      toast.error("Ошибка импорта: " + error.message);
    },
  });

  const handleImport = () => {
    if (transactions.length === 0) {
      toast.warning("Нет транзакций для импорта");
      return;
    }
    importMutation.mutate();
  };

  const resetDialog = () => {
    setFile(null);
    setTransactions([]);
    setStats(null);
  };

  const getStatusBadge = (tx: ParsedTransaction) => {
    if (tx.import_status === 'order_created') return <Badge variant="default" className="bg-green-600"><ShoppingCart className="h-3 w-3 mr-1" />Сделка</Badge>;
    if (tx.import_status === 'imported') return <Badge variant="default" className="bg-green-600">Импортировано</Badge>;
    if (tx.import_status === 'exists') return <Badge variant="secondary">Уже есть</Badge>;
    if (tx.import_status === 'error') return <Badge variant="destructive">Ошибка</Badge>;
    
    switch (tx.status_normalized) {
      case 'successful': return <Badge variant="default" className="bg-green-600">Успешно</Badge>;
      case 'failed': return <Badge variant="destructive">Ошибка</Badge>;
      case 'refund': return <Badge variant="outline" className="border-amber-500 text-amber-600">Возврат</Badge>;
      case 'cancel': return <Badge variant="secondary">Отмена</Badge>;
      default: return <Badge variant="outline">{tx.status}</Badge>;
    }
  };

  const getMatchBadge = (tx: ParsedTransaction) => {
    switch (tx.matched_by) {
      case 'email': return <Badge variant="default" className="text-xs"><Mail className="h-3 w-3 mr-1" />Email</Badge>;
      case 'card': return <Badge variant="secondary" className="text-xs"><CreditCard className="h-3 w-3 mr-1" />Карта</Badge>;
      case 'name': return <Badge variant="outline" className="text-xs"><User className="h-3 w-3 mr-1" />Имя</Badge>;
      default: return <Badge variant="outline" className="text-xs text-muted-foreground">—</Badge>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetDialog(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Импорт транзакций bePaid
          </DialogTitle>
          <DialogDescription>
            Загрузите CSV или Excel файл, экспортированный из личного кабинета bePaid
          </DialogDescription>
        </DialogHeader>

        {!file ? (
          // Drop zone
          <div
            className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleFileDrop}
            onClick={() => document.getElementById('file-input')?.click()}
          >
            <input
              id="file-input"
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={handleFileSelect}
            />
            <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-lg font-medium">Перетащите файл сюда</p>
            <p className="text-sm text-muted-foreground mt-1">
              или нажмите для выбора файла (.csv, .xlsx)
            </p>
          </div>
        ) : isParsing ? (
          // Parsing in progress
          <div className="text-center py-8">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
            <p>Обработка файла...</p>
          </div>
        ) : (
          // File loaded, show preview
          <div className="space-y-4">
            {/* File info and stats */}
            <div className="flex items-center justify-between bg-muted/50 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                <span className="font-medium">{file.name}</span>
                <Button variant="ghost" size="icon" onClick={resetDialog}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {stats && (
                <div className="flex items-center gap-3 text-sm">
                  <span>Всего: <strong>{stats.total}</strong></span>
                  <span className="text-green-600">Платежей: {stats.payments}</span>
                  <span className="text-amber-600">Возвратов: {stats.refunds}</span>
                  <span className="text-destructive">Ошибок: {stats.errors}</span>
                  <span className="text-primary">Найдено контактов: {stats.matched}</span>
                </div>
              )}
            </div>

            {/* Options */}
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="skipExisting"
                  checked={skipExisting}
                  onCheckedChange={(v) => setSkipExisting(!!v)}
                />
                <label htmlFor="skipExisting" className="text-sm cursor-pointer">
                  Пропускать существующие
                </label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="autoMatch"
                  checked={autoMatch}
                  onCheckedChange={(v) => setAutoMatch(!!v)}
                  disabled
                />
                <label htmlFor="autoMatch" className="text-sm cursor-pointer text-muted-foreground">
                  Автосопоставление контактов
                </label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="autoCreateOrders"
                  checked={autoCreateOrders}
                  onCheckedChange={setAutoCreateOrders}
                />
                <Label htmlFor="autoCreateOrders" className="text-sm cursor-pointer flex items-center gap-1">
                  <ShoppingCart className="h-3 w-3" />
                  Автосоздание сделок
                </Label>
              </div>
            </div>

            {/* Preview table */}
            <ScrollArea className="h-[350px] border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата</TableHead>
                    <TableHead className="text-right">Сумма</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Карта</TableHead>
                    <TableHead>Контакт</TableHead>
                    <TableHead>Результат</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.slice(0, 50).map((tx, i) => (
                    <TableRow key={tx.uid || i}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {tx.paid_at && format(new Date(tx.paid_at), "dd.MM.yyyy HH:mm", { locale: ru })}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {tx.amount} {tx.currency}
                      </TableCell>
                      <TableCell>{getStatusBadge(tx)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[150px] truncate">
                        {tx.customer_email || "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {tx.card_last4 && (
                          <span className="flex items-center gap-1">
                            <CreditCard className="h-3 w-3" />
                            *{tx.card_last4}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {getMatchBadge(tx)}
                          {tx.matched_profile_name && (
                            <span className="text-xs text-muted-foreground truncate max-w-[100px]">
                              {tx.matched_profile_name}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {tx.import_status && (
                          tx.import_status === 'imported' ? (
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          ) : tx.import_status === 'error' ? (
                            <AlertCircle className="h-4 w-4 text-destructive" />
                          ) : (
                            <span className="text-xs text-muted-foreground">Пропущено</span>
                          )
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {transactions.length > 50 && (
                <div className="text-center py-2 text-sm text-muted-foreground">
                  ...и ещё {transactions.length - 50} транзакций
                </div>
              )}
            </ScrollArea>

            {/* Import progress */}
            {importMutation.isPending && (
              <Progress value={50} className="w-full" />
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => { resetDialog(); onOpenChange(false); }}>
            Отмена
          </Button>
          <Button 
            onClick={handleImport}
            disabled={transactions.length === 0 || importMutation.isPending}
          >
            {importMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <ArrowRight className="h-4 w-4 mr-2" />
            )}
            Импортировать ({transactions.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
