import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Upload, FileSpreadsheet, AlertCircle, CheckCircle2, 
  Loader2, X, FileText, ArrowRight, User, Mail, CreditCard 
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import * as XLSX from "xlsx";

interface BepaidImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface ParsedTransaction {
  uid: string;
  bepaid_order_id?: string;
  status: string;
  status_normalized: 'successful' | 'failed' | 'pending' | 'refund' | 'cancel';
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
  // Matching results
  matched_profile_id?: string;
  matched_profile_name?: string;
  matched_by?: 'email' | 'card' | 'name' | 'none';
  // Import status
  import_status?: 'pending' | 'exists' | 'imported' | 'error';
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

// Transliterate Latin card holder name to Cyrillic
function transliterateToCyrillic(name: string): string {
  const map: Record<string, string> = {
    'a': 'а', 'b': 'б', 'c': 'ц', 'd': 'д', 'e': 'е', 'f': 'ф',
    'g': 'г', 'h': 'х', 'i': 'и', 'j': 'й', 'k': 'к', 'l': 'л',
    'm': 'м', 'n': 'н', 'o': 'о', 'p': 'п', 'q': 'к', 'r': 'р',
    's': 'с', 't': 'т', 'u': 'у', 'v': 'в', 'w': 'в', 'x': 'кс',
    'y': 'ы', 'z': 'з',
    'sh': 'ш', 'ch': 'ч', 'zh': 'ж', 'ya': 'я', 'yu': 'ю', 'yo': 'ё',
    'ts': 'ц', 'ks': 'кс', 'kh': 'х',
  };
  
  let result = name.toLowerCase();
  // Replace digraphs first
  ['sh', 'ch', 'zh', 'ya', 'yu', 'yo', 'ts', 'ks', 'kh'].forEach(digraph => {
    result = result.replace(new RegExp(digraph, 'g'), map[digraph]);
  });
  // Then single letters
  result = result.split('').map(c => map[c] || c).join('');
  
  // Capitalize first letter of each word
  return result.split(' ').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ');
}

// Parse bePaid CSV row
function parseCSVRow(row: Record<string, string>): ParsedTransaction | null {
  const uid = row['UID'] || row['uid'] || row['ID транзакции'];
  if (!uid) return null;

  const statusRaw = (row['Статус'] || row['Status'] || '').toLowerCase();
  const typeRaw = row['Тип транзакции'] || row['Transaction type'] || 'Платеж';
  
  let status_normalized: ParsedTransaction['status_normalized'] = 'pending';
  if (statusRaw.includes('успеш') || statusRaw === 'successful') status_normalized = 'successful';
  else if (statusRaw.includes('ошибк') || statusRaw === 'failed' || statusRaw === 'error') status_normalized = 'failed';
  else if (typeRaw.includes('Возврат') || typeRaw.toLowerCase().includes('refund')) status_normalized = 'refund';
  else if (typeRaw.includes('Отмен') || typeRaw.toLowerCase().includes('cancel')) status_normalized = 'cancel';

  // Parse amount (handle comma as decimal separator)
  const amountStr = row['Сумма'] || row['Amount'] || '0';
  const amount = parseFloat(amountStr.replace(',', '.').replace(/[^\d.-]/g, '')) || 0;

  // Parse card mask to get last 4 digits
  const cardMask = row['Карта'] || row['Card'] || '';
  const cardLast4Match = cardMask.match(/(\d{4})\s*$/);
  const card_last4 = cardLast4Match ? cardLast4Match[1] : undefined;

  // Determine card brand from card number or method
  const paymentMethod = row['Способ оплаты'] || row['Payment method'] || '';
  let card_brand = paymentMethod.toLowerCase();
  if (cardMask.startsWith('4')) card_brand = 'visa';
  else if (cardMask.startsWith('5')) card_brand = 'mastercard';

  // Parse dates
  const parseDate = (dateStr: string | undefined): string | undefined => {
    if (!dateStr) return undefined;
    // Try parsing DD.MM.YYYY HH:mm:ss format
    const match = dateStr.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):?(\d{2})?/);
    if (match) {
      const [, day, month, year, hour, min, sec = '00'] = match;
      return `${year}-${month}-${day}T${hour}:${min}:${sec}`;
    }
    return dateStr;
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
    matched_by: 'none',
  };
}

export default function BepaidImportDialog({ open, onOpenChange, onSuccess }: BepaidImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [transactions, setTransactions] = useState<ParsedTransaction[]>([]);
  const [stats, setStats] = useState<ImportStats | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [skipExisting, setSkipExisting] = useState(true);
  const [autoMatch, setAutoMatch] = useState(true);
  const queryClient = useQueryClient();

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
        // Parse Excel
        const buffer = await selectedFile.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' });
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
      if (autoMatch) {
        await matchContacts(parsed);
      }

      setTransactions(parsed);
      calculateStats(parsed);
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
      const results: { uid: string; status: 'imported' | 'exists' | 'error'; error?: string }[] = [];
      
      for (const tx of transactions) {
        try {
          // Check if exists
          if (skipExisting) {
            const { data: existing } = await supabase
              .from('payment_reconcile_queue')
              .select('id')
              .eq('bepaid_uid', tx.uid)
              .maybeSingle();
            
            if (existing) {
              results.push({ uid: tx.uid, status: 'exists' });
              tx.import_status = 'exists';
              continue;
            }
          }

          // Insert into queue - use raw_payload for extra fields
          const { error } = await supabase.from('payment_reconcile_queue').insert({
            bepaid_uid: tx.uid,
            tracking_id: tx.tracking_id,
            amount: tx.amount,
            currency: tx.currency,
            customer_email: tx.customer_email,
            description: tx.description,
            matched_profile_id: tx.matched_profile_id,
            paid_at: tx.paid_at,
            source: 'file_import',
            status: tx.status_normalized === 'successful' ? 'pending' : 'skipped',
            raw_payload: {
              ...tx,
              bepaid_order_id: tx.bepaid_order_id,
              card_last4: tx.card_last4,
              card_holder: tx.card_holder,
              card_brand: tx.card_brand,
              transaction_type: tx.transaction_type,
              payment_method: tx.payment_method,
            } as unknown as Record<string, unknown>,
          });

          if (error) {
            results.push({ uid: tx.uid, status: 'error', error: error.message });
            tx.import_status = 'error';
            tx.import_error = error.message;
          } else {
            results.push({ uid: tx.uid, status: 'imported' });
            tx.import_status = 'imported';
          }
        } catch (err: any) {
          results.push({ uid: tx.uid, status: 'error', error: err.message });
          tx.import_status = 'error';
          tx.import_error = err.message;
        }
      }

      return results;
    },
    onSuccess: (results) => {
      const imported = results.filter(r => r.status === 'imported').length;
      const exists = results.filter(r => r.status === 'exists').length;
      const errors = results.filter(r => r.status === 'error').length;

      if (imported > 0) toast.success(`Импортировано: ${imported} транзакций`);
      if (exists > 0) toast.info(`Уже в базе: ${exists}`);
      if (errors > 0) toast.error(`Ошибок: ${errors}`);

      queryClient.invalidateQueries({ queryKey: ["bepaid-queue"] });
      queryClient.invalidateQueries({ queryKey: ["bepaid-stats"] });
      onSuccess?.();
      
      // Update display
      setTransactions([...transactions]);
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
            <div className="flex items-center gap-4">
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
