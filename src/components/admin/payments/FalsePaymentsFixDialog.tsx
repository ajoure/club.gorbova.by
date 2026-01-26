import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Play, Search, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface FalsePaymentsFixDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface FixCase {
  uid: string;
  contact_email: string;
  action_taken: 'status_fixed' | 'access_revoked' | 'access_kept' | 'skipped' | 'error';
  has_other_valid_access: boolean;
  error?: string;
  details: {
    payment_id: string;
    order_ids: string[];
    subscription_ids: string[];
    entitlement_ids: string[];
  };
}

interface FixResult {
  success: boolean;
  dry_run: boolean;
  cases: FixCase[];
  audit_actions: string[];
  error?: string;
}

export default function FalsePaymentsFixDialog({ open, onOpenChange, onSuccess }: FalsePaymentsFixDialogProps) {
  const [uidsInput, setUidsInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isDryRun, setIsDryRun] = useState(true);
  const [result, setResult] = useState<FixResult | null>(null);
  
  const parseUids = (input: string): string[] => {
    return input
      .split(/[\n,;]/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  };
  
  const handleCheck = async (dryRun: boolean) => {
    const uids = parseUids(uidsInput);
    
    if (uids.length === 0) {
      toast.error("Введите хотя бы один UID транзакции");
      return;
    }
    
    if (uids.length > 50) {
      toast.error("Максимум 50 UID за один раз");
      return;
    }
    
    setIsLoading(true);
    setResult(null);
    setIsDryRun(dryRun);
    
    try {
      const { data, error } = await supabase.functions.invoke('admin-fix-false-payments', {
        body: {
          payment_uids: uids,
          dry_run: dryRun,
        },
      });
      
      if (error) {
        throw new Error(error.message);
      }
      
      setResult(data as FixResult);
      
      if (!dryRun && data?.success) {
        toast.success(`Исправлено ${data.cases.filter((c: FixCase) => c.action_taken !== 'skipped' && c.action_taken !== 'error').length} платежей`);
        onSuccess?.();
      }
    } catch (err: any) {
      toast.error(err.message || "Ошибка выполнения");
      setResult({
        success: false,
        dry_run: dryRun,
        cases: [],
        audit_actions: [],
        error: err.message,
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  const getActionBadge = (action: string) => {
    switch (action) {
      case 'status_fixed':
        return <Badge className="bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30">Статус исправлен</Badge>;
      case 'access_revoked':
        return <Badge className="bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30">Доступ отозван</Badge>;
      case 'access_kept':
        return <Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30">Доступ сохранён</Badge>;
      case 'skipped':
        return <Badge variant="secondary">Пропущен</Badge>;
      case 'error':
        return <Badge variant="destructive">Ошибка</Badge>;
      default:
        return <Badge variant="outline">{action}</Badge>;
    }
  };
  
  const handleClose = () => {
    setResult(null);
    setUidsInput("");
    onOpenChange(false);
  };
  
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Исправить ошибочные платежи
          </DialogTitle>
          <DialogDescription>
            Исправляет транзакции, которые отмечены как успешные в БД, но на самом деле failed/declined в bePaid.
            Отзывает доступы только если нет других валидных оснований.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div>
            <label className="text-sm font-medium mb-2 block">
              UID транзакций (по одному на строку)
            </label>
            <Textarea
              placeholder="d788b73c-defa-4473-8adf-a4dc5e5f160a&#10;34ec7bfa-bcf9-442a-98ac-d182f38ba2ee"
              value={uidsInput}
              onChange={(e) => setUidsInput(e.target.value)}
              className="min-h-[100px] font-mono text-xs"
              disabled={isLoading}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Найдено: {parseUids(uidsInput).length} UID
            </p>
          </div>
          
          {/* Results */}
          {result && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                {result.success ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500" />
                )}
                <span className="font-medium">
                  {result.dry_run ? "Результат проверки (DRY-RUN)" : "Результат выполнения"}
                </span>
                {result.dry_run && (
                  <Badge variant="outline" className="text-xs">Без изменений в БД</Badge>
                )}
              </div>
              
              {result.error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-600 dark:text-red-400">
                  {result.error}
                </div>
              )}
              
              {result.cases.length > 0 && (
                <ScrollArea className="h-[200px] rounded-lg border">
                  <div className="p-3 space-y-2">
                    {result.cases.map((c, idx) => (
                      <div 
                        key={idx} 
                        className="flex items-start justify-between p-2 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors"
                      >
                        <div className="space-y-1">
                          <code className="text-xs font-mono">{c.uid}</code>
                          {c.contact_email && (
                            <p className="text-xs text-muted-foreground">{c.contact_email}</p>
                          )}
                          {c.has_other_valid_access && (
                            <p className="text-xs text-blue-600 dark:text-blue-400">
                              ✓ Есть другие валидные доступы
                            </p>
                          )}
                          {c.error && (
                            <p className="text-xs text-red-500">{c.error}</p>
                          )}
                        </div>
                        {getActionBadge(c.action_taken)}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
              
              {result.cases.length === 0 && !result.error && (
                <div className="text-sm text-muted-foreground text-center py-4">
                  Платежи не найдены или не требуют исправления
                </div>
              )}
            </div>
          )}
        </div>
        
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleClose} disabled={isLoading}>
            Закрыть
          </Button>
          
          <Button 
            variant="secondary" 
            onClick={() => handleCheck(true)}
            disabled={isLoading || parseUids(uidsInput).length === 0}
          >
            {isLoading && isDryRun ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Search className="h-4 w-4 mr-2" />
            )}
            Проверить (DRY-RUN)
          </Button>
          
          <Button 
            onClick={() => handleCheck(false)}
            disabled={isLoading || parseUids(uidsInput).length === 0 || !result?.success || !result?.dry_run}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            {isLoading && !isDryRun ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            Выполнить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
