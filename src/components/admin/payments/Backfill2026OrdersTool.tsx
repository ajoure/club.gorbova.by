import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { GlassCard } from "@/components/ui/GlassCard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, AlertTriangle, CheckCircle2, XCircle, Play, Eye, FileText } from "lucide-react";

interface BackfillResult {
  success: boolean;
  dry_run: boolean;
  total_candidates: number;
  processed: number;
  created: number;
  skipped: number;
  failed: number;
  needs_mapping: number;
  sample_ids?: string[];
  created_orders?: string[];
  errors?: string[];
}

interface Backfill2026OrdersToolProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function Backfill2026OrdersTool({ open, onOpenChange }: Backfill2026OrdersToolProps) {
  const [limit, setLimit] = useState(50);
  const [dryRunResult, setDryRunResult] = useState<BackfillResult | null>(null);
  const [executeResult, setExecuteResult] = useState<BackfillResult | null>(null);

  const getInvokeErrorMessage = (err: unknown): string => {
    const e: any = err;
    const base = e?.message || "Unknown error";
    const ctx = e?.context;
    const status = ctx?.status;
    let rb = ctx?.responseBody;

    if (typeof rb === "string") {
      try {
        rb = JSON.parse(rb);
      } catch {
        // keep as string
      }
    }

    if (status && rb && typeof rb === "object") {
      const debugEmail = rb?.debug?.authenticated_email;
      const debugUserId = rb?.debug?.authenticated_user_id;
      const debugRole = rb?.debug?.role_checked;
      if (debugEmail || debugUserId) {
        return `${base} (HTTP ${status}). Вы авторизованы как ${debugEmail || "(email неизвестен)"} / ${debugUserId || "(uid неизвестен)"}${debugRole ? `; требуется роль: ${debugRole}` : ""}`;
      }
      if (rb?.error) {
        return `${rb.error} (HTTP ${status})`;
      }
    }

    return base;
  };

  // Dry-run mutation
  const dryRunMutation = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not authenticated");

      const response = await supabase.functions.invoke("admin-backfill-2026-orders", {
        body: { dry_run: true, limit },
      });

      if (response.error) throw new Error(response.error.message);
      return response.data as BackfillResult;
    },
    onSuccess: (data) => {
      setDryRunResult(data);
      setExecuteResult(null);
    },
  });

  // Execute mutation
  const executeMutation = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not authenticated");

      const response = await supabase.functions.invoke("admin-backfill-2026-orders", {
        body: { dry_run: false, limit },
      });

      if (response.error) throw new Error(response.error.message);
      return response.data as BackfillResult;
    },
    onSuccess: (data) => {
      setExecuteResult(data);
    },
  });

  // Guard conditions for Execute button
  const canExecute = 
    dryRunResult !== null && 
    dryRunResult.success &&
    (dryRunResult.total_candidates ?? 0) > 0;

  const getExecuteDisabledReason = (): string | null => {
    if (!dryRunResult) return "Сначала запустите Dry-run";
    if (!dryRunResult.success) return "Dry-run завершился с ошибкой";
    if ((dryRunResult.total_candidates ?? 0) === 0) return "Нет кандидатов для обработки";
    return null;
  };

  const handleClose = () => {
    setDryRunResult(null);
    setExecuteResult(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Backfill Orders 2026+
          </DialogTitle>
          <DialogDescription>
            Создаёт сделки для платежей 2026+ без order_id (succeeded, amount&gt;0, profile_id not null).
          </DialogDescription>
        </DialogHeader>

        {/* Warning */}
        <Alert variant="destructive" className="border-orange-500/50 bg-orange-500/10">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Массовая операция</AlertTitle>
          <AlertDescription>
            Используйте dry-run перед execute. Создаёт renewal orders для orphan-платежей.
          </AlertDescription>
        </Alert>

        {/* Input fields */}
        <div className="space-y-2">
          <Label htmlFor="limit">limit</Label>
          <Input
            id="limit"
            type="number"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            min={1}
            max={200}
          />
          <p className="text-xs text-muted-foreground">Сколько платежей обработать за один вызов</p>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={() => dryRunMutation.mutate()}
            disabled={dryRunMutation.isPending || executeMutation.isPending}
            className="flex-1"
          >
            {dryRunMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Eye className="h-4 w-4 mr-2" />
            )}
            Dry-run
          </Button>
          <Button
            onClick={() => executeMutation.mutate()}
            disabled={!canExecute || executeMutation.isPending || dryRunMutation.isPending}
            className="flex-1"
            variant={canExecute ? "default" : "secondary"}
          >
            {executeMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            Execute
          </Button>
        </div>

        {/* Execute disabled reason */}
        {!canExecute && getExecuteDisabledReason() && (
          <p className="text-xs text-muted-foreground text-center">
            Execute заблокирован: {getExecuteDisabledReason()}
          </p>
        )}

        {/* Error display */}
        {(dryRunMutation.error || executeMutation.error) && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertTitle>Ошибка</AlertTitle>
            <AlertDescription>
              {getInvokeErrorMessage(dryRunMutation.error || executeMutation.error)}
            </AlertDescription>
          </Alert>
        )}

        {/* Dry-run result */}
        {dryRunResult && (
          <GlassCard className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span className="font-medium">Результат Dry-run</span>
              <Badge variant="secondary">dry_run: true</Badge>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">total_candidates:</span>{" "}
                <span className="font-mono font-bold">{dryRunResult.total_candidates ?? 0}</span>
              </div>
              <div>
                <span className="text-muted-foreground">processed:</span>{" "}
                <span className="font-mono">{dryRunResult.processed ?? 0}</span>
              </div>
              <div>
                <span className="text-muted-foreground">would_create:</span>{" "}
                <span className="font-mono">{dryRunResult.created ?? 0}</span>
              </div>
              <div>
                <span className="text-muted-foreground">needs_mapping:</span>{" "}
                <span className="font-mono">{dryRunResult.needs_mapping ?? 0}</span>
              </div>
              <div>
                <span className="text-muted-foreground">skipped:</span>{" "}
                <span className="font-mono">{dryRunResult.skipped ?? 0}</span>
              </div>
              <div>
                <span className="text-muted-foreground">failed:</span>{" "}
                <span className="font-mono">{dryRunResult.failed ?? 0}</span>
              </div>
            </div>
            {dryRunResult.sample_ids && dryRunResult.sample_ids.length > 0 && (
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">sample_ids (первые 10):</span>
                <div className="flex flex-wrap gap-1">
                  {dryRunResult.sample_ids.map((id) => (
                    <code key={id} className="text-[10px] px-1 py-0.5 bg-muted rounded">
                      {id.slice(0, 8)}…
                    </code>
                  ))}
                </div>
              </div>
            )}
          </GlassCard>
        )}

        {/* Execute result */}
        {executeResult && (
          <GlassCard className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              {executeResult.success && (executeResult.failed ?? 0) === 0 ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-orange-500" />
              )}
              <span className="font-medium">Результат Execute</span>
              <Badge>dry_run: false</Badge>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">total_candidates:</span>{" "}
                <span className="font-mono">{executeResult.total_candidates ?? 0}</span>
              </div>
              <div>
                <span className="text-muted-foreground">processed:</span>{" "}
                <span className="font-mono">{executeResult.processed ?? 0}</span>
              </div>
              <div>
                <span className="text-muted-foreground">created:</span>{" "}
                <span className="font-mono font-bold text-green-500">{executeResult.created ?? 0}</span>
              </div>
              <div>
                <span className="text-muted-foreground">needs_mapping:</span>{" "}
                <span className="font-mono">{executeResult.needs_mapping ?? 0}</span>
              </div>
              <div>
                <span className="text-muted-foreground">skipped:</span>{" "}
                <span className="font-mono">{executeResult.skipped ?? 0}</span>
              </div>
              <div>
                <span className="text-muted-foreground">failed:</span>{" "}
                <span className={`font-mono ${(executeResult.failed ?? 0) > 0 ? "text-destructive font-bold" : ""}`}>
                  {executeResult.failed ?? 0}
                </span>
              </div>
            </div>
            {executeResult.created_orders && executeResult.created_orders.length > 0 && (
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">created_orders:</span>
                <div className="flex flex-wrap gap-1">
                  {executeResult.created_orders.slice(0, 10).map((id) => (
                    <code key={id} className="text-[10px] px-1 py-0.5 bg-muted rounded">
                      {id.slice(0, 8)}…
                    </code>
                  ))}
                </div>
              </div>
            )}
            {executeResult.errors && executeResult.errors.length > 0 && (
              <div className="space-y-1">
                <span className="text-xs text-destructive font-medium">Ошибки:</span>
                <div className="text-xs font-mono bg-destructive/10 p-2 rounded max-h-24 overflow-auto">
                  {executeResult.errors.slice(0, 5).map((err, i) => (
                    <div key={i}>{err}</div>
                  ))}
                  {executeResult.errors.length > 5 && (
                    <div className="text-muted-foreground">...и ещё {executeResult.errors.length - 5}</div>
                  )}
                </div>
              </div>
            )}
          </GlassCard>
        )}
      </DialogContent>
    </Dialog>
  );
}
