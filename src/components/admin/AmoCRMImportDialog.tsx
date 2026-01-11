import { useState, useCallback, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Upload, FileSpreadsheet, AlertCircle, CheckCircle2, 
  Loader2, X, User, Mail, Phone, AtSign, ArrowRight, Search, Cloud, Eye, Shield, RotateCcw
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import FuzzyMatchDialog from "./FuzzyMatchDialog";

interface AmoCRMImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface ParsedContact {
  amo_id: string;
  full_name: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  emails: string[];
  phone?: string;
  phones: string[];
  telegram_username?: string;
  created_at?: string;
  // Matching results
  matched_profile_id?: string;
  matched_profile_name?: string;
  matched_by?: 'email' | 'phone' | 'name' | 'telegram' | 'none';
  // Import status
  import_status?: 'pending' | 'exists' | 'created' | 'updated' | 'error';
  import_error?: string;
}

interface ImportStats {
  total: number;
  matched: number;
  unmatched: number;
  created: number;
  updated: number;
  errors: number;
}

interface ImportJob {
  id: string;
  status: string;
  total: number;
  processed: number;
  created_count: number;
  updated_count: number;
  errors_count: number;
}

interface DryRunResult {
  success: boolean;
  dryRun: boolean;
  jobId: string;
  wouldCreate: number;
  wouldUpdate: number;
  wouldSkip: number;
  errors: number;
  errorLog?: { contact: string; error: string }[];
}

// Normalize phone number for comparison
function normalizePhone(phone: string): string {
  if (!phone) return '';
  let normalized = phone.replace(/[^\d+]/g, '');
  if (normalized.startsWith('+')) normalized = normalized.slice(1);
  if (normalized.startsWith('8') && normalized.length === 11) {
    normalized = '7' + normalized.slice(1);
  }
  if (normalized.length === 9 && (normalized.startsWith('29') || normalized.startsWith('33') || normalized.startsWith('44') || normalized.startsWith('25'))) {
    normalized = '375' + normalized;
  }
  return normalized;
}

// Normalize email for comparison
function normalizeEmail(email: string): string {
  return email?.toLowerCase().trim() || '';
}

// Normalize name for matching
function normalizeName(name: string): string {
  return name?.toLowerCase().replace(/[^\p{L}\s]/gu, '').trim() || '';
}

// Parse amoCRM contact row
function parseContactRow(row: Record<string, unknown>): ParsedContact | null {
  const id = String(row['ID'] || '');
  if (!id || id === '-') return null;
  
  const firstName = String(row['Имя'] || row['First name'] || '').trim();
  const lastName = String(row['Фамилия'] || row['Last name'] || '').trim();
  const fullName = String(row['Наименование'] || row['Name'] || `${firstName} ${lastName}`.trim() || '').trim();
  
  if (!fullName || fullName === '-') return null;
  
  // Collect all emails
  const emails: string[] = [];
  const emailFields = ['Рабочий email', 'Личный email', 'Другой email', 'Work email', 'Personal email', 'Other email'];
  for (const field of emailFields) {
    const email = String(row[field] || '').trim();
    if (email && email !== '-' && email.includes('@')) {
      emails.push(normalizeEmail(email));
    }
  }
  
  // Collect all phones
  const phones: string[] = [];
  const phoneFields = ['Рабочий телефон', 'Рабочий прямой телефон', 'Мобильный телефон', 'Домашний телефон', 'Другой телефон', 'Work phone', 'Mobile phone', 'Home phone', 'Other phone'];
  for (const field of phoneFields) {
    const phone = String(row[field] || '').trim().replace(/'/g, '');
    if (phone && phone !== '-') {
      const normalized = normalizePhone(phone);
      if (normalized.length >= 9) {
        phones.push(normalized);
      }
    }
  }
  
  // Telegram username
  const telegramRaw = String(row['Телеграм (контакт)'] || row['Никнейм Телеграм (контакт)'] || row['Telegram'] || '').trim();
  const telegram_username = telegramRaw && telegramRaw !== '-' ? telegramRaw.replace('@', '') : undefined;
  
  return {
    amo_id: id,
    full_name: fullName,
    first_name: firstName || undefined,
    last_name: lastName || undefined,
    email: emails[0],
    emails,
    phone: phones[0],
    phones,
    telegram_username,
    created_at: String(row['Дата создания'] || ''),
    matched_by: 'none',
    import_status: 'pending',
  };
}

const BACKGROUND_THRESHOLD = 500; // Use background import for files with 500+ contacts

export default function AmoCRMImportDialog({ open, onOpenChange, onSuccess }: AmoCRMImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [contacts, setContacts] = useState<ParsedContact[]>([]);
  const [stats, setStats] = useState<ImportStats | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState(0);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [autoMatch, setAutoMatch] = useState(true);
  const [showFuzzyDialog, setShowFuzzyDialog] = useState(false);
  const [backgroundJob, setBackgroundJob] = useState<ImportJob | null>(null);
  
  // Dry run and confirmation state
  const [isDryRunning, setIsDryRunning] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  
  const queryClient = useQueryClient();

  // Subscribe to background job progress
  useEffect(() => {
    if (!backgroundJob) return;

    const channel = supabase
      .channel(`import-job-${backgroundJob.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'import_jobs',
          filter: `id=eq.${backgroundJob.id}`,
        },
        (payload) => {
          const job = payload.new as ImportJob;
          setBackgroundJob(job);

          if (job.status === 'completed') {
            toast.success(`Импорт завершён: ${job.created_count} создано, ${job.updated_count} обновлено, ${job.errors_count} ошибок`);
            queryClient.invalidateQueries({ queryKey: ['admin-contacts'] });
            onSuccess?.();
          } else if (job.status === 'failed') {
            toast.error('Ошибка фонового импорта');
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [backgroundJob?.id, queryClient, onSuccess]);

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
    const isXLSX = selectedFile.name.endsWith('.xlsx') || selectedFile.name.endsWith('.xls');
    
    if (!isXLSX) {
      toast.error("Поддерживаются только Excel файлы (.xlsx, .xls)");
      return;
    }

    setFile(selectedFile);
    setIsParsing(true);
    setParseProgress(0);
    setDryRunResult(null); // Reset dry run result

    try {
      const buffer = await selectedFile.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

      console.log("amoCRM Excel parsed:", { sheetName, rowCount: rows.length, columns: rows[0] ? Object.keys(rows[0]) : [] });

      // Parse contacts with progress
      const parsed: ParsedContact[] = [];
      const BATCH_SIZE = 100;
      
      for (let i = 0; i < rows.length; i++) {
        const contact = parseContactRow(rows[i]);
        if (contact) parsed.push(contact);
        
        if (i % BATCH_SIZE === 0) {
          setParseProgress((i / rows.length) * 50); // First 50% is parsing
          await new Promise(resolve => setTimeout(resolve, 0)); // Yield to UI
        }
      }

      if (parsed.length === 0) {
        throw new Error("Не удалось распознать контакты. Проверьте формат файла.");
      }

      // Auto-match contacts if enabled
      if (autoMatch) {
        setParseProgress(50);
        await matchContactsOptimized(parsed, (progress) => {
          setParseProgress(50 + progress * 0.5); // Second 50% is matching
        });
      }

      setContacts(parsed);
      calculateStats(parsed);
      toast.success(`Загружено ${parsed.length} контактов`);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      toast.error("Ошибка парсинга: " + errorMessage);
      setFile(null);
    } finally {
      setIsParsing(false);
      setParseProgress(0);
    }
  };

  // Optimized matching: load all profiles once, build indexes on client
  const matchContactsOptimized = async (
    contactsList: ParsedContact[], 
    onProgress?: (progress: number) => void
  ) => {
    // Load ALL profiles once (they're typically just hundreds)
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, email, emails, phone, phones, telegram_username, external_id_amo');

    if (!profiles) return;

    // Build lookup indexes on client side - O(profiles)
    const emailIndex = new Map<string, { id: string; name: string }>();
    const phoneIndex = new Map<string, { id: string; name: string }>();
    const telegramIndex = new Map<string, { id: string; name: string }>();
    const nameIndex = new Map<string, { id: string; name: string }>();
    const amoIdIndex = new Map<string, { id: string; name: string }>();

    for (const p of profiles) {
      // Primary fields
      if (p.email) emailIndex.set(normalizeEmail(p.email), { id: p.id, name: p.full_name || '' });
      if (p.phone) phoneIndex.set(normalizePhone(p.phone), { id: p.id, name: p.full_name || '' });
      if (p.telegram_username) telegramIndex.set(p.telegram_username.toLowerCase(), { id: p.id, name: p.full_name || '' });
      if (p.full_name) nameIndex.set(normalizeName(p.full_name), { id: p.id, name: p.full_name });
      if (p.external_id_amo) amoIdIndex.set(p.external_id_amo, { id: p.id, name: p.full_name || '' });
      
      // Additional emails from JSON array
      const profileEmails = p.emails as string[] | null;
      if (profileEmails) {
        profileEmails.forEach(e => emailIndex.set(normalizeEmail(e), { id: p.id, name: p.full_name || '' }));
      }
      
      // Additional phones from JSON array
      const profilePhones = p.phones as string[] | null;
      if (profilePhones) {
        profilePhones.forEach(ph => phoneIndex.set(normalizePhone(ph), { id: p.id, name: p.full_name || '' }));
      }
    }

    // Match each contact - O(contacts) with O(1) lookups
    for (let i = 0; i < contactsList.length; i++) {
      const contact = contactsList[i];
      
      // 1. Check amoCRM ID first (exact match)
      const amoMatch = amoIdIndex.get(contact.amo_id);
      if (amoMatch) {
        contact.matched_profile_id = amoMatch.id;
        contact.matched_profile_name = amoMatch.name;
        contact.matched_by = 'email'; // Treat as strongest match
        continue;
      }

      // 2. Try email match (highest priority)
      let matched = false;
      for (const email of contact.emails) {
        const match = emailIndex.get(email);
        if (match) {
          contact.matched_profile_id = match.id;
          contact.matched_profile_name = match.name;
          contact.matched_by = 'email';
          matched = true;
          break;
        }
      }
      if (matched) continue;

      // 3. Try phone match
      for (const phone of contact.phones) {
        const match = phoneIndex.get(phone);
        if (match) {
          contact.matched_profile_id = match.id;
          contact.matched_profile_name = match.name;
          contact.matched_by = 'phone';
          matched = true;
          break;
        }
      }
      if (matched) continue;

      // 4. Try telegram match
      if (contact.telegram_username) {
        const match = telegramIndex.get(contact.telegram_username.toLowerCase());
        if (match) {
          contact.matched_profile_id = match.id;
          contact.matched_profile_name = match.name;
          contact.matched_by = 'telegram';
          continue;
        }
      }

      // 5. Try exact normalized name match (no fuzzy - that's separate)
      const normalizedName = normalizeName(contact.full_name);
      const match = nameIndex.get(normalizedName);
      if (match) {
        contact.matched_profile_id = match.id;
        contact.matched_profile_name = match.name;
        contact.matched_by = 'name';
      }

      // Report progress every 100 contacts
      if (i % 100 === 0) {
        onProgress?.(i / contactsList.length);
        await new Promise(resolve => setTimeout(resolve, 0)); // Yield to UI
      }
    }

    onProgress?.(1);
  };

  const calculateStats = (contactsList: ParsedContact[]) => {
    setStats({
      total: contactsList.length,
      matched: contactsList.filter(c => c.matched_by !== 'none').length,
      unmatched: contactsList.filter(c => c.matched_by === 'none').length,
      created: 0,
      updated: 0,
      errors: 0,
    });
  };

  // Run dry run to preview changes
  const runDryRun = async () => {
    setIsDryRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('amocrm-mass-import', {
        body: {
          contacts: contacts.map(c => ({
            amo_id: c.amo_id,
            full_name: c.full_name,
            first_name: c.first_name,
            last_name: c.last_name,
            email: c.email,
            emails: c.emails,
            phone: c.phone,
            phones: c.phones,
            telegram_username: c.telegram_username,
          })),
          options: { updateExisting, dryRun: true },
        },
      });

      if (error) throw error;

      setDryRunResult(data as DryRunResult);
      setShowConfirmDialog(true);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      toast.error("Ошибка предпросмотра: " + errorMessage);
    } finally {
      setIsDryRunning(false);
    }
  };

  // Start background import for large files
  const startBackgroundImport = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast.error("Требуется авторизация");
      return;
    }

    // Create job first
    const { data: job, error: jobError } = await supabase
      .from('import_jobs')
      .insert({
        type: 'amocrm_contacts',
        total: contacts.length,
        status: 'pending',
        created_by: session.user.id,
      })
      .select()
      .single();

    if (jobError || !job) {
      toast.error("Ошибка создания задачи: " + (jobError?.message || 'Unknown'));
      return;
    }

    setBackgroundJob(job as ImportJob);
    setShowConfirmDialog(false);

    // Invoke edge function
    const { error } = await supabase.functions.invoke('amocrm-mass-import', {
      body: {
        contacts: contacts.map(c => ({
          amo_id: c.amo_id,
          full_name: c.full_name,
          first_name: c.first_name,
          last_name: c.last_name,
          email: c.email,
          emails: c.emails,
          phone: c.phone,
          phones: c.phones,
          telegram_username: c.telegram_username,
        })),
        options: { updateExisting },
        jobId: job.id,
      },
    });

    if (error) {
      toast.error("Ошибка запуска импорта: " + error.message);
      setBackgroundJob(null);
    } else {
      toast.success(`Запущен фоновый импорт ${contacts.length} контактов`);
    }
  };

  // Direct import for small files
  const importMutation = useMutation({
    mutationFn: async () => {
      let created = 0;
      let updated = 0;
      let errors = 0;
      
      const BATCH_SIZE = 50;
      for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
        const batch = contacts.slice(i, i + BATCH_SIZE);
        
        for (const contact of batch) {
          try {
            if (contact.matched_profile_id && updateExisting) {
              // Update existing profile
              const updateData: Record<string, unknown> = {
                external_id_amo: contact.amo_id,
              };
              
              if (contact.email) updateData.email = contact.email;
              if (contact.phone) updateData.phone = contact.phone;
              if (contact.telegram_username) updateData.telegram_username = contact.telegram_username;
              if (contact.emails.length > 0) updateData.emails = contact.emails;
              if (contact.phones.length > 0) updateData.phones = contact.phones.map(p => '+' + p);
              
              const { error } = await supabase
                .from('profiles')
                .update(updateData)
                .eq('id', contact.matched_profile_id);
              
              if (error) {
                contact.import_status = 'error';
                contact.import_error = error.message;
                errors++;
              } else {
                contact.import_status = 'updated';
                updated++;
              }
            } else if (!contact.matched_profile_id) {
              // Create new profile
              const { error } = await supabase
                .from('profiles')
                .insert({
                  full_name: contact.full_name,
                  first_name: contact.first_name,
                  last_name: contact.last_name,
                  email: contact.email,
                  emails: contact.emails,
                  phone: contact.phone ? '+' + contact.phone : undefined,
                  phones: contact.phones.map(p => '+' + p),
                  telegram_username: contact.telegram_username,
                  external_id_amo: contact.amo_id,
                  status: 'ghost',
                  source: 'amocrm_import',
                });
              
              if (error) {
                contact.import_status = 'error';
                contact.import_error = error.message;
                errors++;
              } else {
                contact.import_status = 'created';
                created++;
              }
            } else {
              contact.import_status = 'exists';
            }
          } catch (err: unknown) {
            contact.import_status = 'error';
            contact.import_error = err instanceof Error ? err.message : 'Unknown error';
            errors++;
          }
        }
        
        // Update UI every batch
        setContacts([...contacts]);
      }
      
      return { created, updated, errors };
    },
    onSuccess: ({ created, updated, errors }) => {
      setStats(prev => prev ? { ...prev, created, updated, errors } : null);
      queryClient.invalidateQueries({ queryKey: ['admin-contacts'] });
      toast.success(`Импорт завершён: ${created} создано, ${updated} обновлено, ${errors} ошибок`);
      onSuccess?.();
      setShowConfirmDialog(false);
    },
    onError: (error) => {
      toast.error("Ошибка импорта: " + error.message);
    },
  });

  const handleReset = () => {
    setFile(null);
    setContacts([]);
    setStats(null);
    setBackgroundJob(null);
    setDryRunResult(null);
  };

  const getMatchBadge = (matchedBy: ParsedContact['matched_by']) => {
    switch (matchedBy) {
      case 'email':
        return <Badge variant="default" className="bg-blue-500/20 text-blue-600 border-blue-500/30"><Mail className="w-3 h-3 mr-1" />Email</Badge>;
      case 'phone':
        return <Badge variant="default" className="bg-green-500/20 text-green-600 border-green-500/30"><Phone className="w-3 h-3 mr-1" />Телефон</Badge>;
      case 'name':
        return <Badge variant="default" className="bg-purple-500/20 text-purple-600 border-purple-500/30"><User className="w-3 h-3 mr-1" />Имя</Badge>;
      case 'telegram':
        return <Badge variant="default" className="bg-cyan-500/20 text-cyan-600 border-cyan-500/30"><AtSign className="w-3 h-3 mr-1" />Telegram</Badge>;
      default:
        return <Badge variant="outline" className="text-muted-foreground">Не найден</Badge>;
    }
  };

  const getStatusBadge = (status: ParsedContact['import_status']) => {
    switch (status) {
      case 'created':
        return <Badge variant="default" className="bg-green-500/20 text-green-600 border-green-500/30"><CheckCircle2 className="w-3 h-3 mr-1" />Создан</Badge>;
      case 'updated':
        return <Badge variant="default" className="bg-blue-500/20 text-blue-600 border-blue-500/30"><CheckCircle2 className="w-3 h-3 mr-1" />Обновлён</Badge>;
      case 'exists':
        return <Badge variant="outline">Существует</Badge>;
      case 'error':
        return <Badge variant="destructive"><AlertCircle className="w-3 h-3 mr-1" />Ошибка</Badge>;
      default:
        return <Badge variant="outline">Ожидает</Badge>;
    }
  };

  const unmatchedContacts = contacts.filter(c => c.matched_by === 'none');
  const isLargeFile = contacts.length >= BACKGROUND_THRESHOLD;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Импорт контактов из amoCRM
            </DialogTitle>
            <DialogDescription>
              Загрузите XLSX экспорт из amoCRM для добавления/обновления контактов
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-hidden flex flex-col gap-4">
            {!file ? (
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleFileDrop}
                className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer"
                onClick={() => document.getElementById('amocrm-file-input')?.click()}
              >
                <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-lg font-medium mb-2">Перетащите файл сюда</p>
                <p className="text-sm text-muted-foreground mb-4">или нажмите для выбора</p>
                <p className="text-xs text-muted-foreground">Поддерживаются файлы .xlsx, .xls</p>
                <input
                  id="amocrm-file-input"
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>
            ) : isParsing ? (
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-muted-foreground">Обработка файла...</p>
                <Progress value={parseProgress} className="w-64 h-2" />
                <p className="text-sm text-muted-foreground">{Math.round(parseProgress)}%</p>
              </div>
            ) : backgroundJob ? (
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                <Cloud className="h-12 w-12 text-primary animate-pulse" />
                <p className="text-lg font-medium">Фоновый импорт</p>
                <p className="text-muted-foreground">
                  {backgroundJob.status === 'processing' ? 'Обрабатываем контакты...' : 
                   backgroundJob.status === 'completed' ? 'Импорт завершён!' : 
                   backgroundJob.status === 'failed' ? 'Ошибка импорта' : 'Ожидаем...'}
                </p>
                <Progress value={(backgroundJob.processed / backgroundJob.total) * 100} className="w-64 h-2" />
                <p className="text-sm text-muted-foreground">
                  {backgroundJob.processed} / {backgroundJob.total} • 
                  {backgroundJob.created_count} создано • {backgroundJob.updated_count} обновлено
                </p>
                
                {/* Rollback info */}
                {backgroundJob.status === 'completed' && (
                  <Alert className="max-w-md">
                    <RotateCcw className="h-4 w-4" />
                    <AlertDescription>
                      Этот импорт можно откатить. ID задачи: <code className="text-xs">{backgroundJob.id}</code>
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            ) : (
              <>
                {/* Safety notice */}
                <Alert className="border-green-500/30 bg-green-500/10">
                  <Shield className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-green-700">
                    Импорт безопасен: данные только добавляются или обновляются, удаление невозможно. 
                    Каждый импорт можно откатить.
                  </AlertDescription>
                </Alert>

                {/* File info and stats */}
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <FileSpreadsheet className="h-8 w-8 text-primary" />
                    <div>
                      <p className="font-medium">{file.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {stats?.total} контактов • {stats?.matched} совпадений • {stats?.unmatched} новых
                      </p>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={handleReset}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                {/* Options */}
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="update-existing"
                      checked={updateExisting}
                      onCheckedChange={setUpdateExisting}
                    />
                    <Label htmlFor="update-existing" className="text-sm">Обновлять существующие</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="auto-match"
                      checked={autoMatch}
                      onCheckedChange={setAutoMatch}
                    />
                    <Label htmlFor="auto-match" className="text-sm">Автосопоставление</Label>
                  </div>
                </div>

                {/* Stats cards */}
                {stats && (
                  <div className="grid grid-cols-3 gap-4">
                    <div className="p-3 bg-muted/50 rounded-lg text-center">
                      <p className="text-2xl font-bold text-green-600">{stats.matched}</p>
                      <p className="text-sm text-muted-foreground">Совпадений</p>
                    </div>
                    <div className="p-3 bg-muted/50 rounded-lg text-center">
                      <p className="text-2xl font-bold text-blue-600">{stats.unmatched}</p>
                      <p className="text-sm text-muted-foreground">Новых</p>
                    </div>
                    <div className="p-3 bg-muted/50 rounded-lg text-center">
                      <p className="text-2xl font-bold">{stats.total}</p>
                      <p className="text-sm text-muted-foreground">Всего</p>
                    </div>
                  </div>
                )}

                {/* Fuzzy match button */}
                {unmatchedContacts.length > 0 && (
                  <Button 
                    variant="outline" 
                    onClick={() => setShowFuzzyDialog(true)}
                    className="self-start"
                  >
                    <Search className="h-4 w-4 mr-2" />
                    Нечёткий поиск ({unmatchedContacts.length})
                  </Button>
                )}

                {/* Contacts table */}
                <ScrollArea className="flex-1 border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[50px]">ID</TableHead>
                        <TableHead>Имя</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Телефон</TableHead>
                        <TableHead>Совпадение</TableHead>
                        <TableHead>Статус</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {contacts.slice(0, 100).map((contact, idx) => (
                        <TableRow key={idx} className={contact.import_status === 'error' ? 'bg-destructive/10' : ''}>
                          <TableCell className="font-mono text-xs">{contact.amo_id}</TableCell>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-medium">{contact.full_name}</span>
                              {contact.telegram_username && (
                                <span className="text-xs text-muted-foreground">@{contact.telegram_username}</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">{contact.email || '—'}</TableCell>
                          <TableCell className="text-sm font-mono">{contact.phone || '—'}</TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              {getMatchBadge(contact.matched_by)}
                              {contact.matched_profile_name && (
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                  <ArrowRight className="h-3 w-3" />
                                  {contact.matched_profile_name}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {getStatusBadge(contact.import_status)}
                            {contact.import_error && (
                              <p className="text-xs text-destructive mt-1">{contact.import_error}</p>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {contacts.length > 100 && (
                    <div className="p-3 text-center text-sm text-muted-foreground">
                      Показаны первые 100 из {contacts.length} контактов
                    </div>
                  )}
                </ScrollArea>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Закрыть
            </Button>
            {file && contacts.length > 0 && !backgroundJob && (
              <Button 
                onClick={runDryRun} 
                disabled={isDryRunning}
              >
                {isDryRunning ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Анализ...
                  </>
                ) : (
                  <>
                    <Eye className="h-4 w-4 mr-2" />
                    Предпросмотр импорта
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-green-600" />
              Подтверждение импорта
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4">
                <p>Результаты анализа:</p>
                
                {dryRunResult && (
                  <div className="grid grid-cols-3 gap-3 my-4">
                    <div className="p-3 bg-green-500/10 rounded-lg text-center">
                      <p className="text-xl font-bold text-green-600">{dryRunResult.wouldCreate}</p>
                      <p className="text-xs text-muted-foreground">Будет создано</p>
                    </div>
                    <div className="p-3 bg-blue-500/10 rounded-lg text-center">
                      <p className="text-xl font-bold text-blue-600">{dryRunResult.wouldUpdate}</p>
                      <p className="text-xs text-muted-foreground">Будет обновлено</p>
                    </div>
                    <div className="p-3 bg-muted rounded-lg text-center">
                      <p className="text-xl font-bold">{dryRunResult.wouldSkip}</p>
                      <p className="text-xs text-muted-foreground">Без изменений</p>
                    </div>
                  </div>
                )}

                {dryRunResult?.errors ? (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      Обнаружено {dryRunResult.errors} потенциальных ошибок
                    </AlertDescription>
                  </Alert>
                ) : null}

                <Alert className="border-green-500/30 bg-green-500/10">
                  <RotateCcw className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-green-700">
                    Этот импорт можно будет откатить после выполнения
                  </AlertDescription>
                </Alert>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (isLargeFile) {
                  startBackgroundImport();
                } else {
                  importMutation.mutate();
                }
              }}
              disabled={importMutation.isPending}
            >
              {importMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Импорт...
                </>
              ) : isLargeFile ? (
                <>
                  <Cloud className="h-4 w-4 mr-2" />
                  Запустить фоновый импорт
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Импортировать
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <FuzzyMatchDialog
        open={showFuzzyDialog}
        onOpenChange={setShowFuzzyDialog}
        contacts={unmatchedContacts.map(c => ({
          amo_id: c.amo_id,
          full_name: c.full_name,
          email: c.email,
          phone: c.phone,
        }))}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['admin-contacts'] });
        }}
      />
    </>
  );
}
