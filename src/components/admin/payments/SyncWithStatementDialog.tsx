import { useState, useCallback } from "react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { 
  RefreshCw, CheckCircle2, XCircle, AlertTriangle, Play, Loader2,
  Plus, Pencil, Trash2, ChevronDown, ChevronUp, Shield
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// PATCH-3: Batching constants
const BATCH_SIZE = 100;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

interface Difference {
  field: string;
  label: string;
  current: string | number | null;
  statement: string | number | null;
}

interface CascadeInfo {
  orders: { id: string; action: 'update' | 'cancel'; current_status: string; order_number?: string }[];
  subscriptions: { id: string; action: 'cancel' }[];
  entitlements: { id: string; action: 'revoke' }[];
  telegram_access: boolean;
}

interface SyncChange {
  uid: string;
  action: 'create' | 'update' | 'delete';
  differences?: Difference[];
  cascade?: CascadeInfo;
  statement_data: any;
  payment_data?: any;
  contact?: { id: string; name: string; email: string };
  is_dangerous: boolean;
}

interface DetailedStats {
  total: number;
  succeeded: { count: number; amount: number };
  refunded: { count: number; amount: number };
  cancelled: { count: number; amount: number };
  failed: { count: number; amount: number };
  commission_total: number;
}

interface ErrorDetail {
  uid: string;
  action: string;
  error: string;
}

interface SyncStats {
  statement_count: number;
  payments_count: number;
  matched: number;
  to_create: number;
  to_update: number;
  to_delete: number;
  applied: number;
  skipped: number;
  errors?: number;
  error_details?: ErrorDetail[];
  statement_stats?: DetailedStats;
  payments_stats?: DetailedStats;
  projected_stats?: DetailedStats;
}

// Human-readable labels for transaction types
const TX_TYPE_LABELS: Record<string, string> = {
  'payment': 'Платёж',
  'refund': 'Возврат',
  'void': 'Отмена',
};

// Format amount with currency
const formatAmount = (amount: number) => {
  return new Intl.NumberFormat('ru-RU', { 
    minimumFractionDigits: 0, 
    maximumFractionDigits: 2 
  }).format(amount);
};

interface SyncWithStatementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
  defaultFromDate?: string;
  defaultToDate?: string;
}

export default function SyncWithStatementDialog({ 
  open, 
  onOpenChange, 
  onComplete,
  defaultFromDate,
  defaultToDate,
}: SyncWithStatementDialogProps) {
  // PATCH-4: Use Europe/Minsk for default dates
  const MINSK_TZ = 'Europe/Minsk';
  const nowMinsk = toZonedTime(new Date(), MINSK_TZ);
  
  const [status, setStatus] = useState<'idle' | 'loading' | 'preview' | 'applying' | 'done' | 'error' | 'partial'>('idle');
  const [stats, setStats] = useState<SyncStats | null>(null);
  const [changes, setChanges] = useState<SyncChange[]>([]);
  const [selectedUids, setSelectedUids] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(true);
  
  // PATCH-3: Batching progress state
  const [progress, setProgress] = useState<{
    currentBatch: number;
    totalBatches: number;
    applied: number;
    errors: number;
  } | null>(null);
  
  // PATCH-5: Separate state for failed batches (persists after completion)
  const [failedBatches, setFailedBatches] = useState<number[]>([]);
  
  // Date range - PATCH-4: default to current month in Minsk
  const [fromDate, setFromDate] = useState(
    defaultFromDate || format(startOfMonth(nowMinsk), "yyyy-MM-dd")
  );
  const [toDate, setToDate] = useState(
    defaultToDate || format(endOfMonth(nowMinsk), "yyyy-MM-dd")
  );
  
  // Expanded sections
  const [expandedSections, setExpandedSections] = useState({
    create: true,
    update: true,
    delete: true,
  });

  const handlePreview = async () => {
    setStatus('loading');
    setError(null);
    
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('sync-payments-with-statement', {
        body: {
          from_date: fromDate,
          to_date: toDate,
          dry_run: true,
        },
      });
      
      if (invokeError) throw new Error(invokeError.message);
      if (!data.success) throw new Error(data.error || 'Unknown error');
      
      setStats(data.stats);
      setChanges(data.changes);
      
      // Select all non-dangerous changes by default
      const safeUids = data.changes
        .filter((c: SyncChange) => !c.is_dangerous)
        .map((c: SyncChange) => c.uid);
      setSelectedUids(new Set(safeUids));
      
      setStatus('preview');
    } catch (err: any) {
      setError(err.message);
      setStatus('error');
      toast.error("Ошибка загрузки", { description: err.message });
    }
  };

  // PATCH-3: Helper for retry with exponential backoff
  const invokeWithRetry = useCallback(async (
    body: any,
    maxRetries: number = MAX_RETRIES
  ): Promise<any> => {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const { data, error: invokeError } = await supabase.functions.invoke('sync-payments-with-statement', { body });
        
        if (invokeError) {
          const isTransportError = invokeError.message?.includes('Failed to send') || 
                                    invokeError.message?.includes('network') ||
                                    invokeError.message?.includes('timeout');
          
          if (isTransportError && attempt < maxRetries) {
            const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
            console.log(`[sync] Retry ${attempt + 1}/${maxRetries} after ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          throw invokeError;
        }
        
        return data;
      } catch (err: any) {
        if (attempt === maxRetries) throw err;
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
        console.log(`[sync] Retry ${attempt + 1}/${maxRetries} after ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }, []);

  const handleApply = async () => {
    if (selectedUids.size === 0) {
      toast.warning("Выберите хотя бы одну транзакцию");
      return;
    }
    
    setStatus('applying');
    setProgress(null);
    
    const allUids = Array.from(selectedUids);
    const totalBatches = Math.ceil(allUids.length / BATCH_SIZE);
    
    // PATCH-3: Process in batches
    // PATCH-5: Clear failed batches at start (not during progress updates)
    setFailedBatches([]);
    let totalApplied = 0;
    let totalErrors = 0;
    const newFailedBatches: number[] = [];
    const allErrorDetails: ErrorDetail[] = [];
    
    for (let i = 0; i < totalBatches; i++) {
      const batchUids = allUids.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
      
      setProgress({
        currentBatch: i + 1,
        totalBatches,
        applied: totalApplied,
        errors: totalErrors,
      });
      
      try {
        const data = await invokeWithRetry({
          from_date: fromDate,
          to_date: toDate,
          dry_run: false,
          selected_uids: batchUids,
          batch_id: `batch_${i + 1}_of_${totalBatches}`,
        });
        
        if (!data.success) {
          throw new Error(data.error || 'Unknown error');
        }
        
        totalApplied += data.stats.applied;
        totalErrors += data.stats.errors || 0;
        if (data.stats.error_details) {
          allErrorDetails.push(...data.stats.error_details);
        }
      } catch (err: any) {
        console.error(`Batch ${i + 1} failed:`, err);
        newFailedBatches.push(i);
        totalErrors += batchUids.length;
      }
    }
    
    // PATCH-5: Save failed batches to persistent state
    setFailedBatches(newFailedBatches);
    
    // Update final stats
    const finalStats: SyncStats = {
      ...(stats || {} as SyncStats),
      applied: totalApplied,
      skipped: allUids.length - totalApplied - totalErrors,
      errors: totalErrors,
      error_details: allErrorDetails.slice(0, 20), // Limit to 20
    };
    setStats(finalStats);
    
    // PATCH-3: Show appropriate result
    // PATCH-5: Use newFailedBatches for conditional (failedBatches state updates async)
    if (newFailedBatches.length === 0) {
      setStatus('done');
      toast.success("Синхронизация завершена", {
        description: `Применено: ${totalApplied}, ошибок: ${totalErrors}`,
      });
    } else if (totalApplied > 0) {
      // Partial success
      setStatus('partial');
      toast.warning("Частично выполнено", {
        description: `Применено: ${totalApplied}, проваленных батчей: ${newFailedBatches.length}`,
      });
    } else {
      // Complete failure
      setStatus('error');
      setError(`Все батчи провалены. Проверьте соединение.`);
      toast.error("Ошибка синхронизации");
    }
    
    setProgress(null);
    onComplete?.();
  };

  // PATCH-5: Handler for retrying failed batches only (uses persistent failedBatches state)
  const handleRetryFailed = async () => {
    if (failedBatches.length === 0) return;
    
    const allUids = Array.from(selectedUids);
    const failedUids: string[] = [];
    
    for (const batchIndex of failedBatches) {
      const batchUids = allUids.slice(batchIndex * BATCH_SIZE, (batchIndex + 1) * BATCH_SIZE);
      failedUids.push(...batchUids);
    }
    
    // Update selectedUids to only failed ones and restart
    setSelectedUids(new Set(failedUids));
    handleApply();
  };

  const handleReset = () => {
    setStatus('idle');
    setStats(null);
    setChanges([]);
    setSelectedUids(new Set());
    setError(null);
    setFailedBatches([]); // PATCH-5: Clear failed batches on reset
  };

  const toggleUid = (uid: string) => {
    const newSet = new Set(selectedUids);
    if (newSet.has(uid)) {
      newSet.delete(uid);
    } else {
      newSet.add(uid);
    }
    setSelectedUids(newSet);
  };

  const selectAll = () => {
    setSelectedUids(new Set(changes.map(c => c.uid)));
  };

  const selectNone = () => {
    setSelectedUids(new Set());
  };

  const selectSafeOnly = () => {
    setSelectedUids(new Set(changes.filter(c => !c.is_dangerous).map(c => c.uid)));
  };

  const createChanges = changes.filter(c => c.action === 'create');
  const updateChanges = changes.filter(c => c.action === 'update');
  const deleteChanges = changes.filter(c => c.action === 'delete');

  const renderChange = (change: SyncChange) => {
    const isSelected = selectedUids.has(change.uid);
    
    return (
      <div 
        key={change.uid}
        className={cn(
          "border rounded-lg p-3 space-y-2 transition-colors",
          isSelected ? "border-primary/50 bg-primary/5" : "border-border/50",
          change.is_dangerous && "border-destructive/30 bg-destructive/5"
        )}
      >
        <div className="flex items-start gap-3">
          <Checkbox 
            checked={isSelected}
            onCheckedChange={() => toggleUid(change.uid)}
            className="mt-1"
          />
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                {change.uid ? `${change.uid.slice(0, 8)}...` : '—'}
              </code>
              {change.is_dangerous && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                  ⚠️ Опасное
                </Badge>
              )}
              {change.contact && (
                <span className="text-xs text-muted-foreground">
                  {change.contact.name}
                </span>
              )}
            </div>
            
            {/* For CREATE - show statement data */}
            {change.action === 'create' && change.statement_data && (
              <div className="text-sm space-y-1">
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                  <span className="font-medium">{change.statement_data.amount} {change.statement_data.currency || 'BYN'}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {change.statement_data.status}
                  </Badge>
                  {change.statement_data.paid_at && (
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(change.statement_data.paid_at), "dd.MM.yyyy HH:mm")}
                    </span>
                  )}
                </div>
              </div>
            )}
            
            {/* For UPDATE - show differences */}
            {change.action === 'update' && change.differences && (
              <div className="space-y-1.5">
                {change.differences.map((diff, i) => {
                  // For transaction_type, show human-readable labels
                  const isTransactionType = diff.field === 'transaction_type';
                  const currentDisplay = isTransactionType 
                    ? TX_TYPE_LABELS[String(diff.current)] || String(diff.current ?? '—')
                    : String(diff.current ?? '—');
                  const statementDisplay = isTransactionType 
                    ? TX_TYPE_LABELS[String(diff.statement)] || String(diff.statement ?? '—')
                    : String(diff.statement ?? '—');
                  
                  return (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground min-w-[100px]">{diff.label}:</span>
                      <span className="text-red-500 dark:text-red-400 line-through">
                        {currentDisplay}
                      </span>
                      <span className="text-muted-foreground">→</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                        {statementDisplay}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            
            {/* For DELETE - show payment data */}
            {change.action === 'delete' && change.payment_data && (
              <div className="text-sm text-red-500 dark:text-red-400">
                <span className="font-medium">{change.payment_data.amount} BYN</span>
                <span className="mx-2">•</span>
                <span>{change.payment_data.status}</span>
                {change.payment_data.paid_at && (
                  <>
                    <span className="mx-2">•</span>
                    <span>{format(new Date(change.payment_data.paid_at), "dd.MM.yyyy HH:mm")}</span>
                  </>
                )}
              </div>
            )}
            
            {/* Cascade warning */}
            {change.cascade && (
              <div className="mt-2 p-2 rounded bg-amber-500/10 border border-amber-500/20 text-xs">
                <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium mb-1">
                  <AlertTriangle className="h-3 w-3" />
                  Каскадные изменения:
                </div>
                <div className="text-muted-foreground space-y-0.5">
                  {change.cascade.orders.length > 0 && (
                    <div>Сделки: {change.cascade.orders.map(o => o.order_number || (o.id ? o.id.slice(0, 8) : '—')).join(', ')}</div>
                  )}
                  {change.cascade.subscriptions.length > 0 && (
                    <div>Подписки: {change.cascade.subscriptions.length} шт.</div>
                  )}
                  {change.cascade.entitlements.length > 0 && (
                    <div>Права доступа: {change.cascade.entitlements.length} шт.</div>
                  )}
                  {change.cascade.telegram_access && (
                    <div className="text-red-500">Telegram доступ будет отозван!</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Синхронизация с Выпиской bePaid
          </DialogTitle>
          <DialogDescription>
            Выписка bePaid = источник истины. Данные в "Платежах" будут обновлены.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-hidden flex flex-col space-y-4">
          {/* Date range - only in idle state */}
          {status === 'idle' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="from-date">С даты</Label>
                  <Input
                    id="from-date"
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="to-date">По дату</Label>
                  <Input
                    id="to-date"
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                  />
                </div>
              </div>
              
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  ⚠️ Убедитесь, что выписка bePaid за период <strong>{fromDate}</strong> — <strong>{toDate}</strong> уже загружена во вкладке "Выписка BePaid".
                </p>
              </div>
            </>
          )}

          {/* Loading */}
          {status === 'loading' && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">Анализ данных...</p>
            </div>
          )}

          {/* Error */}
          {status === 'error' && error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-4">
              <div className="flex items-center gap-2 text-destructive mb-2">
                <XCircle className="h-5 w-5" />
                <span className="font-medium">Ошибка</span>
              </div>
              <p className="text-sm">{error}</p>
            </div>
          )}

          {/* Preview */}
          {(status === 'preview' || status === 'applying') && stats && (
            <>
              {/* Stats summary - basic counts */}
              <div className="grid grid-cols-4 gap-2">
                <div className="text-center p-2 rounded-lg bg-muted/50">
                  <div className="text-lg font-bold">{stats.statement_count}</div>
                  <div className="text-xs text-muted-foreground">В выписке</div>
                </div>
                <div className="text-center p-2 rounded-lg bg-muted/50">
                  <div className="text-lg font-bold">{stats.payments_count}</div>
                  <div className="text-xs text-muted-foreground">В payments</div>
                </div>
                <div className="text-center p-2 rounded-lg bg-muted/50">
                  <div className="text-lg font-bold">{stats.matched}</div>
                  <div className="text-xs text-muted-foreground">Совпало</div>
                </div>
                <div className="text-center p-2 rounded-lg bg-muted/50">
                  <div className="text-lg font-bold text-amber-500">{changes.length}</div>
                  <div className="text-xs text-muted-foreground">Расхождений</div>
                </div>
              </div>

              {/* Detailed statistics comparison table */}
              {stats.statement_stats && stats.payments_stats && stats.projected_stats && (
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-2 font-medium">Метрика</th>
                        <th className="text-center p-2 font-medium text-emerald-600">Выписка 🟢</th>
                        <th className="text-center p-2 font-medium text-red-500">Payments 🔴</th>
                        <th className="text-center p-2 font-medium text-blue-600">После →</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      <tr>
                        <td className="p-2 text-muted-foreground">Всего транзакций</td>
                        <td className="p-2 text-center font-medium">{stats.statement_stats.total}</td>
                        <td className="p-2 text-center">{stats.payments_stats.total}</td>
                        <td className="p-2 text-center font-medium text-blue-600">{stats.projected_stats.total}</td>
                      </tr>
                      <tr>
                        <td className="p-2 text-muted-foreground">Успешные</td>
                        <td className="p-2 text-center">
                          <div className="font-medium">{stats.statement_stats.succeeded.count}</div>
                          <div className="text-xs text-muted-foreground">{formatAmount(stats.statement_stats.succeeded.amount)} BYN</div>
                        </td>
                        <td className="p-2 text-center">
                          <div>{stats.payments_stats.succeeded.count}</div>
                          <div className="text-xs text-muted-foreground">{formatAmount(stats.payments_stats.succeeded.amount)} BYN</div>
                        </td>
                        <td className="p-2 text-center text-blue-600">
                          <div className="font-medium">{stats.projected_stats.succeeded.count}</div>
                          <div className="text-xs">{formatAmount(stats.projected_stats.succeeded.amount)} BYN</div>
                        </td>
                      </tr>
                      <tr>
                        <td className="p-2 text-muted-foreground">Возвраты</td>
                        <td className="p-2 text-center">
                          <div className="font-medium">{stats.statement_stats.refunded.count}</div>
                          <div className="text-xs text-muted-foreground">{formatAmount(stats.statement_stats.refunded.amount)} BYN</div>
                        </td>
                        <td className="p-2 text-center">
                          <div>{stats.payments_stats.refunded.count}</div>
                          <div className="text-xs text-muted-foreground">{formatAmount(stats.payments_stats.refunded.amount)} BYN</div>
                        </td>
                        <td className="p-2 text-center text-blue-600">
                          <div className="font-medium">{stats.projected_stats.refunded.count}</div>
                          <div className="text-xs">{formatAmount(stats.projected_stats.refunded.amount)} BYN</div>
                        </td>
                      </tr>
                      <tr>
                        <td className="p-2 text-muted-foreground">Отмены</td>
                        <td className="p-2 text-center">
                          <div className="font-medium">{stats.statement_stats.cancelled.count}</div>
                          <div className="text-xs text-muted-foreground">{formatAmount(stats.statement_stats.cancelled.amount)} BYN</div>
                        </td>
                        <td className="p-2 text-center">
                          <div>{stats.payments_stats.cancelled.count}</div>
                          <div className="text-xs text-muted-foreground">{formatAmount(stats.payments_stats.cancelled.amount)} BYN</div>
                        </td>
                        <td className="p-2 text-center text-blue-600">
                          <div className="font-medium">{stats.projected_stats.cancelled.count}</div>
                          <div className="text-xs">{formatAmount(stats.projected_stats.cancelled.amount)} BYN</div>
                        </td>
                      </tr>
                      <tr>
                        <td className="p-2 text-muted-foreground">Ошибки</td>
                        <td className="p-2 text-center">
                          <div className="font-medium">{stats.statement_stats.failed.count}</div>
                          <div className="text-xs text-muted-foreground">{formatAmount(stats.statement_stats.failed.amount)} BYN</div>
                        </td>
                        <td className="p-2 text-center">
                          <div>{stats.payments_stats.failed.count}</div>
                          <div className="text-xs text-muted-foreground">{formatAmount(stats.payments_stats.failed.amount)} BYN</div>
                        </td>
                        <td className="p-2 text-center text-blue-600">
                          <div className="font-medium">{stats.projected_stats.failed.count}</div>
                          <div className="text-xs">{formatAmount(stats.projected_stats.failed.amount)} BYN</div>
                        </td>
                      </tr>
                      <tr className="bg-muted/30">
                        <td className="p-2 text-muted-foreground font-medium">Комиссия</td>
                        <td className="p-2 text-center font-medium">{formatAmount(stats.statement_stats.commission_total)} BYN</td>
                        <td className="p-2 text-center text-muted-foreground">—</td>
                        <td className="p-2 text-center font-medium text-blue-600">{formatAmount(stats.projected_stats.commission_total)} BYN</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              {/* Selection controls */}
              {changes.length > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Выбрано: {selectedUids.size} из {changes.length}</span>
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={selectAll}>
                    Все
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={selectNone}>
                    Сбросить
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={selectSafeOnly}>
                    <Shield className="h-3 w-3 mr-1" />
                    Безопасные
                  </Button>
                </div>
              )}

              {/* Changes list - with fixed height for scroll */}
              <ScrollArea className="h-[400px] border rounded-lg">
                <div className="p-3 space-y-4">
                  {/* Create section */}
                  {createChanges.length > 0 && (
                    <Collapsible 
                      open={expandedSections.create}
                      onOpenChange={(open) => setExpandedSections(prev => ({ ...prev, create: open }))}
                    >
                      <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors">
                        <Plus className="h-4 w-4 text-emerald-500" />
                        <span className="font-medium text-sm">Добавить ({createChanges.length})</span>
                        <div className="flex-1" />
                        {expandedSections.create ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pt-2 space-y-2">
                        {createChanges.map(renderChange)}
                      </CollapsibleContent>
                    </Collapsible>
                  )}

                  {/* Update section */}
                  {updateChanges.length > 0 && (
                    <Collapsible 
                      open={expandedSections.update}
                      onOpenChange={(open) => setExpandedSections(prev => ({ ...prev, update: open }))}
                    >
                      <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 transition-colors">
                        <Pencil className="h-4 w-4 text-blue-500" />
                        <span className="font-medium text-sm">Обновить ({updateChanges.length})</span>
                        <div className="flex-1" />
                        {expandedSections.update ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pt-2 space-y-2">
                        {updateChanges.map(renderChange)}
                      </CollapsibleContent>
                    </Collapsible>
                  )}

                  {/* Delete section */}
                  {deleteChanges.length > 0 && (
                    <Collapsible 
                      open={expandedSections.delete}
                      onOpenChange={(open) => setExpandedSections(prev => ({ ...prev, delete: open }))}
                    >
                      <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 transition-colors">
                        <Trash2 className="h-4 w-4 text-red-500" />
                        <span className="font-medium text-sm">Удалить ({deleteChanges.length})</span>
                        <div className="flex-1" />
                        {expandedSections.delete ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pt-2 space-y-2">
                        {deleteChanges.map(renderChange)}
                      </CollapsibleContent>
                    </Collapsible>
                  )}

                  {/* No changes */}
                  {changes.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <CheckCircle2 className="h-12 w-12 text-emerald-500 mb-3" />
                      <p className="font-medium">Данные синхронизированы</p>
                      <p className="text-sm text-muted-foreground">Расхождений не обнаружено</p>
                    </div>
                  )}
                </div>
              </ScrollArea>

              {/* Legend */}
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>Легенда:</span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  Текущее (payments_v2)
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Эталон (выписка)
                </span>
              </div>
            </>
          )}

          {/* Done */}
          {status === 'done' && stats && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-500 mb-3" />
              <p className="font-medium text-lg">Синхронизация завершена</p>
              <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                <div className="p-3 rounded-lg bg-emerald-500/10">
                  <div className="text-2xl font-bold text-emerald-500">{stats.applied}</div>
                  <div className="text-muted-foreground">Применено</div>
                </div>
                <div className="p-3 rounded-lg bg-muted/50">
                  <div className="text-2xl font-bold">{stats.skipped}</div>
                  <div className="text-muted-foreground">Пропущено</div>
                </div>
              </div>
              
              {/* Error details block with scroll */}
              {(stats.errors ?? 0) > 0 && (
                <div className="w-full mt-4 rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-left">
                  <div className="flex items-center gap-2 text-destructive mb-2">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="font-medium">Ошибки: {stats.errors}</span>
                  </div>
                  <ScrollArea className="max-h-40">
                    <div className="space-y-1 pr-2">
                      {stats.error_details?.map((e, i) => (
                        <div key={i} className="text-xs text-muted-foreground py-0.5">
                          <span className="font-mono text-[10px]">{e.uid?.slice(0, 16)}...</span>: {e.error}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 pt-4 border-t">
          {status === 'idle' && (
            <Button onClick={handlePreview} className="gap-2">
              <Play className="h-4 w-4" />
              Проверить
            </Button>
          )}

          {status === 'preview' && (
            <>
              <Button variant="outline" onClick={handleReset}>
                Назад
              </Button>
              <Button 
                onClick={handleApply} 
                disabled={selectedUids.size === 0}
                className="gap-2"
              >
                Применить выбранные ({selectedUids.size})
              </Button>
            </>
          )}

          {status === 'applying' && (
            <div className="flex flex-col items-center gap-3 flex-1">
              {progress && (
                <div className="w-full space-y-2">
                  <Progress value={(progress.currentBatch / progress.totalBatches) * 100} className="h-2" />
                  <p className="text-xs text-muted-foreground text-center">
                    Батч {progress.currentBatch} из {progress.totalBatches} • 
                    Применено: {progress.applied} • Ошибок: {progress.errors}
                  </p>
                </div>
              )}
              <Button disabled className="gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Применение...
              </Button>
            </div>
          )}

          {/* PATCH-3: Partial success state */}
          {status === 'partial' && (
            <>
              <div className="flex-1 text-center">
                <div className="flex items-center justify-center gap-2 text-amber-600">
                  <AlertTriangle className="h-5 w-5" />
                  <span className="font-medium">Частично выполнено</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Применено: {stats?.applied}, ошибок: {stats?.errors}
                </p>
              </div>
              <Button variant="outline" onClick={handleRetryFailed}>
                Повторить ошибки
              </Button>
              <Button onClick={() => onOpenChange(false)}>
                Закрыть
              </Button>
            </>
          )}

          {status === 'done' && (
            <Button onClick={() => onOpenChange(false)}>
              Закрыть
            </Button>
          )}

          {status === 'error' && (
            <>
              <Button variant="outline" onClick={handleReset}>
                Попробовать снова
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Закрыть
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
