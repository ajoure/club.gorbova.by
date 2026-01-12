import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";

interface CleanupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: "telegram" | "demo";
  onSuccess?: () => void;
}

interface TelegramResult {
  status: string;
  mode: string;
  corruption_fixed: number;
  orphans_deleted: number;
  expired_tokens_deleted: number;
  sample_ids: { corruption: string[]; orphans: string[]; expired_tokens: string[] };
  audit_log_id?: string;
  error?: string;
}

interface DemoResult {
  status: string;
  mode: string;
  safeguard: { orders: number; payments: number; entitlements_nonrevoked: number };
  stop_reason?: string;
  demo_profiles_count: number;
  counts: Record<string, number>;
  sample_profiles: Array<{ id: string; email: string | null }>;
  failed_auth_users?: Array<{ userId: string; error: string }>;
  audit_log_id?: string;
  error?: string;
}

export function CleanupDialog({ open, onOpenChange, type, onSuccess }: CleanupDialogProps) {
  const [dryRunResult, setDryRunResult] = useState<TelegramResult | DemoResult | null>(null);
  const [step, setStep] = useState<"idle" | "dry-run" | "confirm" | "executing" | "done">("idle");

  const functionName = type === "telegram" ? "cleanup-telegram-orphans" : "cleanup-demo-contacts";
  const title = type === "telegram" ? "Очистка Telegram-привязок" : "Удаление Demo-контактов";

  const cleanupMutation = useMutation({
    mutationFn: async (mode: "dry-run" | "execute") => {
      const { data, error } = await supabase.functions.invoke(functionName, {
        body: { mode },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data, mode) => {
      if (mode === "dry-run") {
        setDryRunResult(data);
        setStep("confirm");
      } else {
        setStep("done");
        if (data.status === "success") {
          toast.success(`Очистка завершена. Audit ID: ${data.audit_log_id}`);
          onSuccess?.();
        } else if (data.status === "STOP") {
          toast.warning("Очистка остановлена: " + data.stop_reason);
        }
      }
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
      setStep("idle");
    },
  });

  const handleDryRun = () => {
    setStep("dry-run");
    cleanupMutation.mutate("dry-run");
  };

  const handleExecute = () => {
    setStep("executing");
    cleanupMutation.mutate("execute");
  };

  const handleClose = () => {
    setStep("idle");
    setDryRunResult(null);
    onOpenChange(false);
  };

  const isTelegramResult = (r: any): r is TelegramResult => "corruption_fixed" in r;
  const isDemoResult = (r: any): r is DemoResult => "safeguard" in r;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {type === "telegram" 
              ? "Исправление битых привязок и удаление истёкших токенов"
              : "Удаление демо-профилей (user+*@example.com)"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {step === "idle" && (
            <p className="text-sm text-muted-foreground">
              Нажмите "Проверить" для просмотра записей, которые будут затронуты.
            </p>
          )}

          {(step === "dry-run" || step === "executing") && (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{step === "dry-run" ? "Анализ данных..." : "Выполнение..."}</span>
            </div>
          )}

          {step === "confirm" && dryRunResult && (
            <div className="space-y-3">
              {dryRunResult.status === "STOP" && isDemoResult(dryRunResult) && (
                <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-md">
                  <div className="flex items-center gap-2 text-destructive font-medium">
                    <XCircle className="h-4 w-4" />
                    Предохранитель не пройден
                  </div>
                  <p className="text-sm mt-1">{dryRunResult.stop_reason}</p>
                </div>
              )}

              {isTelegramResult(dryRunResult) && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Исправить corruption:</span>
                    <Badge variant="secondary">{dryRunResult.corruption_fixed}</Badge>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Удалить orphans:</span>
                    <Badge variant="secondary">{dryRunResult.orphans_deleted}</Badge>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Удалить expired tokens:</span>
                    <Badge variant="secondary">{dryRunResult.expired_tokens_deleted}</Badge>
                  </div>
                </div>
              )}

              {isDemoResult(dryRunResult) && dryRunResult.status !== "STOP" && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Demo-профилей:</span>
                    <Badge variant="secondary">{dryRunResult.demo_profiles_count}</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Будут удалены: {Object.entries(dryRunResult.counts)
                      .filter(([, v]) => v > 0)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(", ")}
                  </div>
                  {dryRunResult.sample_profiles.length > 0 && (
                    <div className="text-xs text-muted-foreground max-h-32 overflow-auto">
                      Примеры: {dryRunResult.sample_profiles.slice(0, 5).map(p => p.email).join(", ")}
                    </div>
                  )}
                </div>
              )}

              {dryRunResult.status !== "STOP" && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-md">
                  <div className="flex items-center gap-2 text-amber-600 font-medium">
                    <AlertTriangle className="h-4 w-4" />
                    Подтвердите выполнение
                  </div>
                  <p className="text-sm mt-1">Это действие нельзя отменить.</p>
                </div>
              )}
            </div>
          )}

          {step === "done" && dryRunResult && (
            <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-md">
              <div className="flex items-center gap-2 text-green-600 font-medium">
                <CheckCircle className="h-4 w-4" />
                Очистка завершена
              </div>
              {dryRunResult.audit_log_id && (
                <p className="text-sm mt-1">Audit ID: {dryRunResult.audit_log_id}</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {step === "idle" && (
            <>
              <Button variant="outline" onClick={handleClose}>Отмена</Button>
              <Button onClick={handleDryRun}>Проверить (dry-run)</Button>
            </>
          )}
          {step === "confirm" && (
            <>
              <Button variant="outline" onClick={handleClose}>Отмена</Button>
              {dryRunResult?.status !== "STOP" && (
                <Button variant="destructive" onClick={handleExecute}>
                  EXECUTE
                </Button>
              )}
            </>
          )}
          {step === "done" && (
            <Button onClick={handleClose}>Закрыть</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
