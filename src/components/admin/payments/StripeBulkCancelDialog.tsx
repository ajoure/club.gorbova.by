// STRIPE-FINAL-CLOSURE-SPRINT-V1 / Workstream B — Bulk cancel admin dialog.
//
// MVP: ручной ввод/вставка списка UUID + dry-run + execute с двумя подтверждениями.
// Multi-select интеграция в StripeSubscriptionsList — следующий шаг (не блокирует).
//
// Контракт UI:
//   1) admin вводит UUID (по одному на строке) + выбирает mode + reason
//   2) dry-run → показываем preview eligibility + batch_id
//   3) execute требует явный клик на «Подтвердить отмену»
//   4) immediate-mode требует ещё одного отдельного confirm
//
// Никакой client-side eligibility — всё считает backend.

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AlertTriangle, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { normalizeEdgeFunctionError } from "@/utils/normalizeEdgeFunctionError";

type Mode = "period_end" | "immediate";

interface PerItem {
  subscription_v2_id: string;
  eligibility: string;
  current_status: string | null;
  provider: string | null;
  provider_subscription_id: string | null;
  cancel_at_period_end?: boolean;
  skip_reason?: string;
  execute_status?: string;
  detail?: string;
}

interface DryRunResponse {
  ok: boolean;
  batch_id: string;
  expires_in_ms: number;
  mode: Mode;
  counts: { selected: number; eligible: number; skipped: number };
  items: PerItem[];
}

interface ExecuteResponse {
  ok: boolean;
  batch_id: string;
  mode: Mode;
  counts: {
    selected: number;
    eligible_initial: number;
    stale: number;
    success: number;
    skipped: number;
    errors: number;
  };
  results: PerItem[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function StripeBulkCancelDialog() {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const [mode, setMode] = useState<Mode>("period_end");
  const [reason, setReason] = useState("");
  const [dryRunResult, setDryRunResult] = useState<DryRunResponse | null>(null);
  const [executeResult, setExecuteResult] = useState<ExecuteResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [immediateConfirmed, setImmediateConfirmed] = useState(false);

  const reset = () => {
    setRaw("");
    setMode("period_end");
    setReason("");
    setDryRunResult(null);
    setExecuteResult(null);
    setImmediateConfirmed(false);
  };

  const parseIds = (): string[] => {
    return Array.from(
      new Set(
        raw
          .split(/[\s,;]+/)
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    );
  };

  const handleDryRun = async () => {
    const ids = parseIds();
    if (ids.length === 0) {
      toast.error("Введите хотя бы один UUID подписки");
      return;
    }
    if (ids.length > 50) {
      toast.error(`Максимум 50 UUID за batch (введено ${ids.length})`);
      return;
    }
    const bad = ids.find((id) => !UUID_RE.test(id));
    if (bad) {
      toast.error(`Не UUID: ${bad}`);
      return;
    }
    setBusy(true);
    setExecuteResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("admin-stripe-bulk-cancel", {
        body: { subscription_ids: ids, mode, dry_run: true, reason: reason || undefined },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.detail ?? data.error);
      setDryRunResult(data as DryRunResponse);
      toast.success(
        `Dry-run OK: ${data.counts.eligible}/${data.counts.selected} пригодны к отмене`,
      );
    } catch (e) {
      toast.error(normalizeEdgeFunctionError(e));
    } finally {
      setBusy(false);
    }
  };

  const handleExecute = async () => {
    if (!dryRunResult) return;
    if (mode === "immediate" && !immediateConfirmed) {
      toast.error("Подтвердите немедленную отмену (вторая галочка)");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-stripe-bulk-cancel", {
        body: { batch_id: dryRunResult.batch_id, confirm: true, reason: reason || undefined },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.detail ?? data.error);
      setExecuteResult(data as ExecuteResponse);
      toast.success(
        `Execute завершён: success=${data.counts.success}, skipped=${data.counts.skipped}, errors=${data.counts.errors}`,
      );
      setDryRunResult(null);
    } catch (e) {
      toast.error(normalizeEdgeFunctionError(e));
    } finally {
      setBusy(false);
    }
  };

  const eligibleCount = dryRunResult?.counts.eligible ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <ShieldAlert className="h-4 w-4" />
          Bulk Stripe cancel
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
            Массовая отмена Stripe-подписок
          </DialogTitle>
          <DialogDescription>
            Только Stripe. Dry-run обязателен. Доступ через webhook, никаких прямых
            entitlement/Telegram изменений.
          </DialogDescription>
        </DialogHeader>

        {!executeResult && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ids">UUID подписок (по одному на строке, до 50)</Label>
              <Textarea
                id="ids"
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
                className="font-mono text-xs h-32"
                disabled={busy || !!dryRunResult}
              />
            </div>

            <div className="space-y-2">
              <Label>Режим отмены</Label>
              <RadioGroup
                value={mode}
                onValueChange={(v) => {
                  setMode(v as Mode);
                  setImmediateConfirmed(false);
                }}
                disabled={busy || !!dryRunResult}
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="period_end" id="m1" />
                  <Label htmlFor="m1" className="font-normal">
                    В конце периода (cancel_at_period_end) — доступ сохраняется
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="immediate" id="m2" />
                  <Label htmlFor="m2" className="font-normal text-red-600">
                    Немедленно (cancel_now) — требует второго подтверждения
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reason">Причина (для audit)</Label>
              <Input
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Свободный текст — обязателен"
                disabled={busy}
              />
            </div>

            {!dryRunResult && (
              <Button onClick={handleDryRun} disabled={busy || !raw.trim()} className="w-full">
                {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Dry-run
              </Button>
            )}

            {dryRunResult && (
              <div className="space-y-3 rounded-lg border border-border/60 p-4 bg-muted/30">
                <div className="flex items-center gap-2 flex-wrap text-sm">
                  <Badge variant="outline">batch_id: {dryRunResult.batch_id.slice(0, 8)}…</Badge>
                  <Badge>выбрано: {dryRunResult.counts.selected}</Badge>
                  <Badge variant="default" className="bg-green-600">
                    eligible: {dryRunResult.counts.eligible}
                  </Badge>
                  <Badge variant="secondary">skipped: {dryRunResult.counts.skipped}</Badge>
                </div>
                <div className="max-h-64 overflow-y-auto text-xs space-y-1">
                  {dryRunResult.items.map((it) => (
                    <div
                      key={it.subscription_v2_id}
                      className="flex items-center justify-between gap-2 p-2 rounded bg-card"
                    >
                      <code className="truncate" title={it.subscription_v2_id}>
                        {it.subscription_v2_id.slice(0, 8)}…
                      </code>
                      <Badge
                        variant={it.eligibility === "eligible" ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {it.eligibility}
                        {it.skip_reason ? `: ${it.skip_reason}` : ""}
                      </Badge>
                    </div>
                  ))}
                </div>

                {mode === "immediate" && (
                  <div className="rounded-md bg-red-50 dark:bg-red-950/20 p-3 border border-red-300/50">
                    <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-400">
                      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                      <div className="space-y-2">
                        <p>
                          Немедленная отмена удаляет подписку в Stripe сейчас. Доступ
                          пересчитывается стандартным reconcile, но клиенты могут потерять
                          активные привилегии.
                        </p>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={immediateConfirmed}
                            onChange={(e) => setImmediateConfirmed(e.target.checked)}
                          />
                          <span>Понимаю последствия и подтверждаю немедленную отмену</span>
                        </label>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setDryRunResult(null);
                      setImmediateConfirmed(false);
                    }}
                    disabled={busy}
                  >
                    Назад
                  </Button>
                  <Button
                    onClick={handleExecute}
                    disabled={
                      busy ||
                      eligibleCount === 0 ||
                      (mode === "immediate" && !immediateConfirmed)
                    }
                    variant={mode === "immediate" ? "destructive" : "default"}
                    className="flex-1"
                  >
                    {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Подтвердить отмену ({eligibleCount})
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {executeResult && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge>выбрано: {executeResult.counts.selected}</Badge>
              <Badge variant="default" className="bg-green-600">
                success: {executeResult.counts.success}
              </Badge>
              <Badge variant="secondary">skipped: {executeResult.counts.skipped}</Badge>
              {executeResult.counts.stale > 0 && (
                <Badge variant="outline" className="text-amber-600 border-amber-300">
                  stale: {executeResult.counts.stale}
                </Badge>
              )}
              {executeResult.counts.errors > 0 && (
                <Badge variant="destructive">errors: {executeResult.counts.errors}</Badge>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto text-xs space-y-1">
              {executeResult.results.map((it) => (
                <div
                  key={it.subscription_v2_id}
                  className="flex items-center justify-between gap-2 p-2 rounded bg-card"
                >
                  <code className="truncate">{it.subscription_v2_id.slice(0, 8)}…</code>
                  <Badge
                    variant={
                      it.execute_status === "ok"
                        ? "default"
                        : it.execute_status === "error"
                        ? "destructive"
                        : "secondary"
                    }
                    className="text-[10px]"
                  >
                    {it.execute_status}
                    {it.detail && it.execute_status !== "ok" ? `: ${it.detail}` : ""}
                  </Badge>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Закрыть</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
