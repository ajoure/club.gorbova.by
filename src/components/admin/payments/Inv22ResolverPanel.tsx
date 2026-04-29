import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, AlertTriangle, CheckCircle2, RefreshCw, Settings } from "lucide-react";
import { toast } from "sonner";
import { normalizeEdgeFunctionError } from "@/utils/normalizeEdgeFunctionError";

interface PlanItem {
  subscription_id: string;
  user_id: string;
  product_id: string;
  provider_subscription_id: string | null;
  ps_state: string;
  bucket: string;
  age_hours: number;
  access_end_at: string;
  planned_action: "skip_too_fresh" | "pull_then_decide" | "close_local_provider_dead";
  rationale: string;
}

interface PlanResponse {
  ok: boolean;
  total_count: number;
  by_bucket: Record<string, number>;
  plan: PlanItem[];
}

interface ResolveResultItem {
  subscription_id: string;
  outcome: string;
  pull_result: string;
  notes: string;
}

const BUCKET_LABEL: Record<string, string> = {
  never_charged_expired: "Мёртвая (без оплаты)",
  previously_charged_expired: "Истекла после списаний",
  never_charged_redirecting: "Застряла на 3DS",
  previously_charged_redirecting: "3DS после списаний",
  active_no_dates: "Active без дат",
  other: "Прочее",
};

const ACTION_LABEL: Record<string, { text: string; tone: "default" | "secondary" | "destructive" }> = {
  skip_too_fresh: { text: "Пропустить (свежая)", tone: "secondary" },
  pull_then_decide: { text: "Pull → решить", tone: "default" },
  close_local_provider_dead: { text: "Закрыть локально", tone: "destructive" },
};

/**
 * Inv22ResolverPanel — кнопка-шестерёнка с badge-счётчиком зомби-подписок INV-22.
 * При клике открывает диалог с планом и возможностью разбора.
 * Доступ не отзывается.
 */
export function Inv22ResolverPanel() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [results, setResults] = useState<ResolveResultItem[] | null>(null);
  const [remainingCount, setRemainingCount] = useState<number | null>(null);
  const [errorCount, setErrorCount] = useState<number | null>(null);

  // Lightweight count fetch for badge — runs on mount without opening dialog
  async function fetchErrorCount() {
    try {
      const { data, error } = await supabase.functions.invoke("system-health-inv22-plan", {
        body: {},
      });
      if (error) throw error;
      const resp = data as PlanResponse;
      setErrorCount(resp.total_count ?? 0);
      // cache the plan so opening the dialog is instant
      setPlan(resp);
    } catch {
      // silent — badge просто не покажется
      setErrorCount(null);
    }
  }

  useEffect(() => {
    fetchErrorCount();
  }, []);

  async function loadPlan() {
    setLoading(true);
    setResults(null);
    try {
      const { data, error } = await supabase.functions.invoke("system-health-inv22-plan", {
        body: {},
      });
      if (error) throw error;
      const resp = data as PlanResponse;
      setPlan(resp);
      setErrorCount(resp.total_count ?? 0);
    } catch (e) {
      toast.error(normalizeEdgeFunctionError(e, "Не удалось получить план INV-22"));
    } finally {
      setLoading(false);
    }
  }

  async function execute() {
    if (!plan) return;
    const targets = plan.plan
      .filter((p) => p.planned_action !== "skip_too_fresh")
      .map((p) => p.subscription_id);
    if (targets.length === 0) {
      toast.info("Нет подписок для разбора (все пропущены по 48-часовому grace).");
      setConfirmOpen(false);
      return;
    }
    setExecuting(true);
    try {
      const { data, error } = await supabase.functions.invoke("system-health-inv22-resolve", {
        body: { subscription_ids: targets, confirm: true },
      });
      if (error) throw error;
      const resp = data as { results: ResolveResultItem[]; remaining_inv22_count: number | null };
      setResults(resp.results);
      setRemainingCount(resp.remaining_inv22_count);
      setErrorCount(resp.remaining_inv22_count ?? 0);
      toast.success(`Разобрано ${resp.results.length} подписок. Осталось INV-22: ${resp.remaining_inv22_count ?? "?"}.`);
      setConfirmOpen(false);
      await loadPlan();
    } catch (e) {
      toast.error(normalizeEdgeFunctionError(e, "Не удалось выполнить разбор INV-22"));
    } finally {
      setExecuting(false);
    }
  }

  const hasErrors = (errorCount ?? 0) > 0;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            onClick={() => setOpen(true)}
            aria-label="INV-22 — настройки разбора зомби-подписок"
          >
            <Settings className="h-5 w-5" />
            {hasErrors && (
              <Badge
                variant="destructive"
                className="absolute -top-1 -right-1 h-5 min-w-5 px-1 rounded-full text-[10px] flex items-center justify-center"
              >
                {errorCount}
              </Badge>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {hasErrors
            ? `INV-22: ${errorCount} рассинхронизированных подписок`
            : "INV-22 — рассинхрон с провайдером (нет проблем)"}
        </TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              INV-22 — рассинхрон подписок с провайдером
            </DialogTitle>
            <DialogDescription>
              Подписки числятся активными и продлеваемыми у нас, но bePaid их уже не считает живыми
              (expired / redirecting / active без дат списаний). Доступ <strong>не</strong> отзывается —
              только закрывается локальная пометка автопродления.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={loadPlan}
                disabled={loading}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                <span className="ml-2">Загрузить план</span>
              </Button>
            </div>

            {plan && (
              <>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant={plan.total_count > 0 ? "destructive" : "secondary"}>
                    Всего: {plan.total_count}
                  </Badge>
                  {Object.entries(plan.by_bucket).map(([k, v]) => (
                    <Badge key={k} variant="outline">
                      {BUCKET_LABEL[k] ?? k}: {v}
                    </Badge>
                  ))}
                </div>

                {plan.plan.length === 0 ? (
                  <Alert>
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertTitle>Зомби-подписок нет</AlertTitle>
                    <AlertDescription>INV-22 на текущий момент чист.</AlertDescription>
                  </Alert>
                ) : (
                  <>
                    <div className="overflow-x-auto rounded border bg-background">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="text-left p-2">Subscription</th>
                            <th className="text-left p-2">bePaid ID</th>
                            <th className="text-left p-2">ps.state</th>
                            <th className="text-left p-2">Bucket</th>
                            <th className="text-left p-2">Возраст</th>
                            <th className="text-left p-2">access_end</th>
                            <th className="text-left p-2">Действие</th>
                          </tr>
                        </thead>
                        <tbody>
                          {plan.plan.map((row) => {
                            const action = ACTION_LABEL[row.planned_action];
                            return (
                              <tr key={row.subscription_id} className="border-t">
                                <td className="p-2 font-mono">{row.subscription_id.slice(0, 8)}…</td>
                                <td className="p-2 font-mono">
                                  {row.provider_subscription_id?.slice(0, 16) ?? "—"}
                                </td>
                                <td className="p-2">{row.ps_state}</td>
                                <td className="p-2">{BUCKET_LABEL[row.bucket] ?? row.bucket}</td>
                                <td className="p-2">{Math.round(row.age_hours)}ч</td>
                                <td className="p-2">{row.access_end_at.slice(0, 10)}</td>
                                <td className="p-2">
                                  <Badge variant={action.tone}>{action.text}</Badge>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex justify-end">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setConfirmOpen(true)}
                        disabled={executing}
                      >
                        Разобрать ({plan.plan.filter((p) => p.planned_action !== "skip_too_fresh").length})
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}

            {results && (
              <Alert className="border-emerald-200">
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>Готово</AlertTitle>
                <AlertDescription>
                  <div>Обработано: {results.length}.</div>
                  <div>Осталось в INV-22: {remainingCount ?? "?"}.</div>
                  <ul className="mt-2 list-disc pl-5 text-xs">
                    {results.map((r) => (
                      <li key={r.subscription_id}>
                        <span className="font-mono">{r.subscription_id.slice(0, 8)}…</span> — {r.outcome} ({r.pull_result})
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Подтвердите разбор INV-22</DialogTitle>
            <DialogDescription>
              Будет выполнено для каждой подписки: pull актуального state из bePaid →
              если провайдер всё ещё считает её мёртвой, локально выставится{" "}
              <code>auto_renew=false</code> и <code>status=canceled</code>.
              Telegram-доступ и <code>access_end_at</code> не меняются.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded border bg-muted/30 p-3 text-xs space-y-1">
            <div>Будет обработано: {plan?.plan.filter((p) => p.planned_action !== "skip_too_fresh").length ?? 0}</div>
            <div>Пропущено по grace 48ч: {plan?.plan.filter((p) => p.planned_action === "skip_too_fresh").length ?? 0}</div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={executing}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={execute} disabled={executing}>
              {executing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Выполнить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
