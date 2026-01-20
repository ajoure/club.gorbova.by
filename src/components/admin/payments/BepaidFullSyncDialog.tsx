import { useState } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, CheckCircle, AlertCircle, Plus, ArrowRight, CreditCard, RefreshCw, ShieldCheck, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface BepaidFullSyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
  defaultFromDate?: string;
}

interface ReconcileResult {
  ok: boolean;
  dry_run: boolean;
  period: { from_date: string; to_date: string };
  runtime_ms?: number;
  error?: string;
  
  // Mode info
  mode_used: 'list' | 'uid_verify';
  fallback_reason?: string;
  endpoint_used?: string;
  
  // LIST mode fields (optional - only present in list mode)
  fetched?: {
    bepaid_total: number;
    pages: number;
  };
  db?: {
    already_in_db: number;
    missing_in_db: number;
    mismatched: number;
  };
  actions?: {
    inserted: number;
    updated: number;
    skipped: number;
    errors: number;
  };
  
  // UID_VERIFY mode fields (optional - only present in uid_verify mode)
  uid_verify_stats?: {
    checked_uids: number;
    verified_ok: number;
    unverifiable: number;
    updated_amount: number;
    updated_status: number;
    updated_paid_at: number;
    updated_card_fields: number;
    refunds_card_filled: number;
    errors: number;
  };
  
  // Samples (structure differs by mode)
  samples?: {
    // LIST mode samples
    inserts?: Array<{ uid: string; amount: number; status: string }>;
    updates?: Array<{ uid: string; changes: string[] }>;
    mismatches?: Array<{ uid: string; changes: string[] }>;
    // UID_VERIFY mode samples
    verified?: Array<{ uid: string; changes: string[] }>;
    unverifiable?: Array<{ uid: string; reason: string }>;
    errors?: Array<{ uid: string; error: string }>;
  };
  
  // Legacy fields for backwards compat
  compared?: { our_total: number };
  changes?: {
    added: number;
    updated_amount: number;
    updated_status: number;
    updated_paid_at: number;
    updated_card_fields?: number;
    brand_normalized?: number;
    refunds_card_filled?: number;
    unchanged: number;
    errors: number;
  };
}

export default function BepaidFullSyncDialog({ 
  open, 
  onOpenChange, 
  onComplete,
  defaultFromDate = "2026-01-01"
}: BepaidFullSyncDialogProps) {
  const [fromDate, setFromDate] = useState(defaultFromDate);
  const [toDate, setToDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [isChecking, setIsChecking] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [activeTab, setActiveTab] = useState("summary");

  const handleCheck = async () => {
    setIsChecking(true);
    setResult(null);
    
    try {
      const { data, error } = await supabase.functions.invoke("admin-bepaid-full-reconcile", {
        body: {
          from_date: fromDate,
          to_date: toDate,
          dry_run: true,
          mode: 'auto',
        },
      });

      if (error) throw error;
      
      if (data.ok) {
        setResult(data);
        if (data.mode_used === 'list') {
          toast.success(`Найдено ${data.fetched?.bepaid_total || 0} транзакций на bePaid`);
        } else {
          toast.success(`Проверено ${data.uid_verify_stats?.checked_uids || 0} транзакций по UID`);
        }
      } else {
        toast.error(data.error || "Ошибка при проверке");
      }
    } catch (e: any) {
      console.error("Check error:", e);
      toast.error("Ошибка: " + (e.message || "Неизвестная ошибка"));
    } finally {
      setIsChecking(false);
    }
  };

  const handleExecute = async () => {
    if (!result) return;
    
    const totalChanges = getTotalChanges(result);
    if (totalChanges === 0) {
      toast.info("Нет изменений для применения");
      return;
    }

    setIsExecuting(true);
    
    try {
      const { data, error } = await supabase.functions.invoke("admin-bepaid-full-reconcile", {
        body: {
          from_date: fromDate,
          to_date: toDate,
          dry_run: false,
          mode: 'auto',
        },
      });

      if (error) throw error;
      
      if (data.ok) {
        setResult(data);
        
        if (data.mode_used === 'list') {
          const { inserted = 0, updated = 0, errors = 0 } = data.actions || {};
          toast.success(`Готово! Добавлено: ${inserted}, обновлено: ${updated}${errors > 0 ? `, ошибок: ${errors}` : ''}`);
        } else {
          const stats = data.uid_verify_stats || {};
          const updated = (stats.updated_amount || 0) + (stats.updated_status || 0) + (stats.updated_card_fields || 0);
          toast.success(`Готово! Обновлено: ${updated}, недоступно: ${stats.unverifiable || 0}`);
        }
        onComplete?.();
      } else {
        toast.error(data.error || "Ошибка при выполнении");
      }
    } catch (e: any) {
      console.error("Execute error:", e);
      toast.error("Ошибка: " + (e.message || "Неизвестная ошибка"));
    } finally {
      setIsExecuting(false);
    }
  };

  const handleClose = () => {
    setResult(null);
    setActiveTab("summary");
    onOpenChange(false);
  };

  const getTotalChanges = (res: ReconcileResult): number => {
    if (res.mode_used === 'list') {
      return (res.actions?.inserted || 0) + (res.actions?.updated || 0);
    } else {
      const stats = res.uid_verify_stats;
      if (!stats) return 0;
      return stats.updated_amount + stats.updated_status + stats.updated_card_fields;
    }
  };

  const totalChanges = result ? getTotalChanges(result) : 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Полная сверка с bePaid</DialogTitle>
          <DialogDescription>
            bePaid — источник истины. Проверяем и синхронизируем суммы, статусы и данные карт.
          </DialogDescription>
          
          {/* Mode indicator */}
          {result?.mode_used && (
            <div className="flex items-center gap-2 mt-3 p-2 rounded bg-muted/50">
              <Badge variant={result.mode_used === 'list' ? 'default' : 'secondary'} className="gap-1">
                {result.mode_used === 'list' ? (
                  <>
                    <Search className="h-3 w-3" />
                    Полный список
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-3 w-3" />
                    Проверка по UID
                  </>
                )}
              </Badge>
              {result.fallback_reason && (
                <span className="text-xs text-muted-foreground">
                  (ограничение API: {result.fallback_reason.length > 50 ? result.fallback_reason.substring(0, 50) + '...' : result.fallback_reason})
                </span>
              )}
              {result.endpoint_used && result.mode_used === 'list' && (
                <code className="text-xs bg-muted px-1 rounded ml-auto">{result.endpoint_used}</code>
              )}
            </div>
          )}
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
          {/* Date range inputs */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="from-date">С даты</Label>
              <Input
                id="from-date"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                disabled={isChecking || isExecuting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="to-date">По дату</Label>
              <Input
                id="to-date"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                disabled={isChecking || isExecuting}
              />
            </div>
          </div>

          {/* Check button */}
          {!result && (
            <Button 
              onClick={handleCheck} 
              disabled={isChecking}
              className="w-full"
            >
              {isChecking ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Проверяем...
                </>
              ) : (
                "Проверить"
              )}
            </Button>
          )}

          {/* Results */}
          {result && (
            <div className="flex-1 overflow-hidden flex flex-col space-y-4">
              {/* Summary cards - conditional rendering by mode */}
              {result.mode_used === 'list' ? (
                <div className="grid grid-cols-4 gap-2">
                  <div className="p-3 rounded-lg bg-muted/50 text-center">
                    <div className="text-2xl font-bold">{result.fetched?.bepaid_total || 0}</div>
                    <div className="text-xs text-muted-foreground">На bePaid</div>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50 text-center">
                    <div className="text-2xl font-bold">{result.db?.already_in_db || 0}</div>
                    <div className="text-xs text-muted-foreground">Уже есть</div>
                  </div>
                  <div className="p-3 rounded-lg bg-green-500/10 text-center">
                    <div className="text-2xl font-bold text-green-600">{result.actions?.inserted || 0}</div>
                    <div className="text-xs text-muted-foreground">Добавлено</div>
                  </div>
                  <div className="p-3 rounded-lg bg-yellow-500/10 text-center">
                    <div className="text-2xl font-bold text-yellow-600">{result.actions?.updated || 0}</div>
                    <div className="text-xs text-muted-foreground">Обновлено</div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  <div className="p-3 rounded-lg bg-muted/50 text-center">
                    <div className="text-2xl font-bold">{result.uid_verify_stats?.checked_uids || 0}</div>
                    <div className="text-xs text-muted-foreground">Проверено</div>
                  </div>
                  <div className="p-3 rounded-lg bg-green-500/10 text-center">
                    <div className="text-2xl font-bold text-green-600">{result.uid_verify_stats?.verified_ok || 0}</div>
                    <div className="text-xs text-muted-foreground">Совпали</div>
                  </div>
                  <div className="p-3 rounded-lg bg-yellow-500/10 text-center">
                    <div className="text-2xl font-bold text-yellow-600">
                      {(result.uid_verify_stats?.updated_amount || 0) + 
                       (result.uid_verify_stats?.updated_status || 0) +
                       (result.uid_verify_stats?.updated_card_fields || 0)}
                    </div>
                    <div className="text-xs text-muted-foreground">Обновлено</div>
                  </div>
                  <div className="p-3 rounded-lg bg-orange-500/10 text-center">
                    <div className="text-2xl font-bold text-orange-600">{result.uid_verify_stats?.unverifiable || 0}</div>
                    <div className="text-xs text-muted-foreground">Недоступно</div>
                  </div>
                </div>
              )}

              {/* Unverifiable warning */}
              {result.uid_verify_stats && result.uid_verify_stats.unverifiable > 0 && (
                <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-orange-600 shrink-0" />
                  <span className="text-sm">
                    {result.uid_verify_stats.unverifiable} транзакций нельзя подтвердить через bePaid API 
                    (ограничение доступа). Данные оставлены как в импорте.
                  </span>
                </div>
              )}

              {/* Tabs with details */}
              <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
                <TabsList className="grid grid-cols-4 w-full">
                  <TabsTrigger value="summary" className="gap-1">
                    Итого
                  </TabsTrigger>
                  <TabsTrigger value="changes" className="gap-1">
                    Изменения
                    {totalChanges > 0 && (
                      <Badge variant="secondary" className="ml-1 h-5 px-1">
                        {totalChanges}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="unverifiable" className="gap-1">
                    Недоступно
                    {(result.uid_verify_stats?.unverifiable || 0) > 0 && (
                      <Badge variant="secondary" className="ml-1 h-5 px-1">
                        {result.uid_verify_stats?.unverifiable}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="errors" className="gap-1">
                    Ошибки
                    {((result.actions?.errors || 0) + (result.uid_verify_stats?.errors || 0)) > 0 && (
                      <Badge variant="destructive" className="ml-1 h-5 px-1">
                        {(result.actions?.errors || 0) + (result.uid_verify_stats?.errors || 0)}
                      </Badge>
                    )}
                  </TabsTrigger>
                </TabsList>

                <ScrollArea className="flex-1 mt-2">
                  <TabsContent value="summary" className="m-0 space-y-2">
                    {result.mode_used === 'list' ? (
                      <div className="p-4 rounded-lg border space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">Режим</span>
                          <Badge variant="default">Полный список</Badge>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">Период</span>
                          <span>{result.period.from_date} — {result.period.to_date}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">Транзакций на bePaid</span>
                          <span className="font-medium">{result.fetched?.bepaid_total || 0}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">Страниц загружено</span>
                          <span className="font-medium">{result.fetched?.pages || 0}</span>
                        </div>
                        <hr />
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">Уже есть в БД</span>
                          <span className="font-medium">{result.db?.already_in_db || 0}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">Отсутствуют в БД</span>
                          <span className="font-medium">{result.db?.missing_in_db || 0}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">С расхождениями</span>
                          <span className="font-medium">{result.db?.mismatched || 0}</span>
                        </div>
                        <hr />
                        <div className="flex justify-between items-center text-green-600">
                          <span>Добавлено</span>
                          <span className="font-bold">{result.actions?.inserted || 0}</span>
                        </div>
                        <div className="flex justify-between items-center text-yellow-600">
                          <span>Обновлено</span>
                          <span className="font-bold">{result.actions?.updated || 0}</span>
                        </div>
                        {(result.actions?.skipped || 0) > 0 && (
                          <div className="flex justify-between items-center text-muted-foreground">
                            <span>Пропущено</span>
                            <span>{result.actions?.skipped}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="p-4 rounded-lg border space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">Режим</span>
                          <Badge variant="secondary">Проверка по UID</Badge>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">Период</span>
                          <span>{result.period.from_date} — {result.period.to_date}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">Проверено UID</span>
                          <span className="font-medium">{result.uid_verify_stats?.checked_uids || 0}</span>
                        </div>
                        <hr />
                        <div className="flex justify-between items-center text-green-600">
                          <span>Совпадают с bePaid</span>
                          <span className="font-bold">{result.uid_verify_stats?.verified_ok || 0}</span>
                        </div>
                        <div className="flex justify-between items-center text-yellow-600">
                          <span>Обновлено сумм</span>
                          <span className="font-bold">{result.uid_verify_stats?.updated_amount || 0}</span>
                        </div>
                        <div className="flex justify-between items-center text-yellow-600">
                          <span>Обновлено статусов</span>
                          <span className="font-bold">{result.uid_verify_stats?.updated_status || 0}</span>
                        </div>
                        <div className="flex justify-between items-center text-blue-600">
                          <span className="flex items-center gap-1">
                            <CreditCard className="h-3 w-3" />
                            Заполнено карт
                          </span>
                          <span className="font-bold">{result.uid_verify_stats?.updated_card_fields || 0}</span>
                        </div>
                        <hr />
                        <div className="flex justify-between items-center text-orange-600">
                          <span>Недоступно в API</span>
                          <span className="font-bold">{result.uid_verify_stats?.unverifiable || 0}</span>
                        </div>
                        {(result.uid_verify_stats?.errors || 0) > 0 && (
                          <div className="flex justify-between items-center text-red-600">
                            <span>Ошибки</span>
                            <span className="font-bold">{result.uid_verify_stats?.errors}</span>
                          </div>
                        )}
                      </div>
                    )}
                    
                    {result.dry_run && totalChanges > 0 && (
                      <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-yellow-600 shrink-0" />
                        <span className="text-sm">
                          Это предварительный просмотр. Нажмите "Применить" для сохранения изменений.
                        </span>
                      </div>
                    )}

                    {!result.dry_run && (
                      <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
                        <span className="text-sm">Изменения применены успешно!</span>
                      </div>
                    )}

                    {result.runtime_ms && (
                      <div className="text-xs text-muted-foreground text-right">
                        Выполнено за {(result.runtime_ms / 1000).toFixed(1)}с
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="changes" className="m-0">
                    {result.mode_used === 'list' ? (
                      <div className="space-y-2">
                        {/* LIST mode - show mismatches and inserts */}
                        {result.samples?.mismatches && result.samples.mismatches.length > 0 ? (
                          result.samples.mismatches.map((item, idx) => (
                            <div key={idx} className="p-2 rounded border text-sm">
                              <code className="text-xs bg-muted px-1 rounded">{item.uid}</code>
                              <div className="mt-1 space-y-1">
                                {item.changes.map((change, i) => (
                                  <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <ArrowRight className="h-3 w-3" />
                                    {change}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="text-center py-8 text-muted-foreground">
                            Нет изменений
                          </div>
                        )}
                        {result.samples?.inserts && result.samples.inserts.length > 0 && (
                          <>
                            <div className="text-sm font-medium text-muted-foreground mt-4">Новые записи:</div>
                            {result.samples.inserts.map((item, idx) => (
                              <div key={idx} className="p-2 rounded border text-sm flex items-center justify-between bg-green-500/5">
                                <code className="text-xs bg-muted px-1 rounded">{item.uid}</code>
                                <div className="text-right">
                                  <div className="font-medium">{item.amount?.toFixed(2)} BYN</div>
                                  <Badge variant="outline" className="text-xs">{item.status}</Badge>
                                </div>
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {/* UID_VERIFY mode - show verified with changes */}
                        {result.samples?.verified && result.samples.verified.length > 0 ? (
                          result.samples.verified.map((item, idx) => (
                            <div key={idx} className="p-2 rounded border text-sm">
                              <code className="text-xs bg-muted px-1 rounded">{item.uid}</code>
                              <div className="mt-1 space-y-1">
                                {item.changes.map((change, i) => (
                                  <div key={i} className="flex items-center gap-2 text-xs">
                                    <CheckCircle className="h-3 w-3 text-green-600" />
                                    {change}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="text-center py-8 text-muted-foreground">
                            <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500" />
                            Все данные актуальны
                          </div>
                        )}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="unverifiable" className="m-0">
                    {result.samples?.unverifiable && result.samples.unverifiable.length > 0 ? (
                      <div className="space-y-2">
                        {result.samples.unverifiable.map((item, idx) => (
                          <div key={idx} className="p-2 rounded border border-orange-200 bg-orange-50 dark:bg-orange-900/10 text-sm">
                            <code className="text-xs bg-muted px-1 rounded">{item.uid}</code>
                            <div className="text-orange-600 mt-1 text-xs">{item.reason}</div>
                          </div>
                        ))}
                        {(result.uid_verify_stats?.unverifiable || 0) > (result.samples.unverifiable.length) && (
                          <div className="text-center text-sm text-muted-foreground py-2">
                            ...и ещё {(result.uid_verify_stats?.unverifiable || 0) - result.samples.unverifiable.length}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        <ShieldCheck className="h-8 w-8 mx-auto mb-2 text-green-500" />
                        Все транзакции доступны для проверки
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="errors" className="m-0">
                    {result.samples?.errors && result.samples.errors.length > 0 ? (
                      <div className="space-y-2">
                        {result.samples.errors.map((item, idx) => (
                          <div key={idx} className="p-2 rounded border border-red-200 bg-red-50 dark:bg-red-900/10 text-sm">
                            <code className="text-xs bg-muted px-1 rounded">{item.uid}</code>
                            <div className="text-red-600 mt-1 text-xs">{item.error}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500" />
                        Ошибок нет
                      </div>
                    )}
                  </TabsContent>
                </ScrollArea>
              </Tabs>

              {/* Action buttons */}
              <div className="flex gap-2 pt-2 border-t">
                <Button 
                  variant="outline" 
                  onClick={handleCheck}
                  disabled={isChecking || isExecuting}
                  className="flex-1"
                >
                  {isChecking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Проверить заново
                </Button>
                
                {result.dry_run && totalChanges > 0 && (
                  <Button 
                    onClick={handleExecute}
                    disabled={isExecuting}
                    className="flex-1"
                  >
                    {isExecuting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Применяем...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="mr-2 h-4 w-4" />
                        Применить ({totalChanges})
                      </>
                    )}
                  </Button>
                )}
                
                {!result.dry_run && (
                  <Button onClick={handleClose} className="flex-1">
                    Готово
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
