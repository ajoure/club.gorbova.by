/**
 * RetroApplyPanel — Universal engine for retroactively applying access_rules
 * to historical subscriptions/orders.
 * 
 * NOT tied to any specific product/tariff/club.
 * Rule is selected by launch parameters.
 * Two modes: grant missing access (default) / recalculate existing access.
 */

import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RefreshCw, Eye, Play, AlertTriangle, CheckCircle2, XCircle, MinusCircle, HelpCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { AccessRule } from "@/hooks/useAccessRules";

interface RetroApplyPanelProps {
  productId: string;
  rules: AccessRule[];
  tariffs: Array<{ id: string; name: string }>;
}

interface UserAction {
  user_id: string;
  profile_id: string | null;
  email: string;
  rule_id: string;
  rule_target_type: string;
  target_product_id: string;
  target_product_code: string;
  target_product_name: string;
  category: string;
  planned_expires_at: string | null;
  current_expires_at: string | null;
  source_subscription_id: string | null;
  skip_reason: string | null;
}

interface RetroApplyResult {
  mode: string;
  rules_found: number;
  summary: {
    total: number;
    missing_access: number;
    aligned_update_needed: number;
    conflict_existing: number;
    already_satisfied: number;
    condition_not_met: number;
    no_source_window: number;
  };
  executed?: { created: number; updated: number; skipped: number };
  actions: UserAction[];
  error?: string;
  stop_reasons?: string[];
}

const CATEGORY_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  missing_access: { label: "Будет создано", color: "text-green-600 bg-green-50 border-green-200", icon: CheckCircle2 },
  aligned_update_needed: { label: "Будет обновлено", color: "text-amber-600 bg-amber-50 border-amber-200", icon: RefreshCw },
  already_satisfied: { label: "Уже есть", color: "text-muted-foreground bg-muted/30 border-muted", icon: MinusCircle },
  conflict_existing: { label: "Конфликт", color: "text-red-600 bg-red-50 border-red-200", icon: XCircle },
  condition_not_met: { label: "Условие не выполнено", color: "text-muted-foreground bg-muted/30 border-muted", icon: HelpCircle },
  no_source_window: { label: "Нет source window", color: "text-red-600 bg-red-50 border-red-200", icon: AlertTriangle },
};

type ScopeMode = "rule" | "product" | "tariff";

export function RetroApplyPanel({ productId, rules, tariffs }: RetroApplyPanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [scopeMode, setScopeMode] = useState<ScopeMode>("product");
  const [selectedRuleId, setSelectedRuleId] = useState<string>("");
  const [selectedTariffId, setSelectedTariffId] = useState<string>("");
  const [recalculateExisting, setRecalculateExisting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<RetroApplyResult | null>(null);
  const [confirmExecute, setConfirmExecute] = useState(false);
  const [forceExecute, setForceExecute] = useState(false);

  const activeRules = useMemo(() =>
    rules.filter(r => r.is_active && ["product_access", "club"].includes(r.grant_target_type)),
    [rules]
  );

  const buildBody = (mode: "preview" | "execute") => {
    const body: Record<string, unknown> = {
      mode,
      recalculate_existing: recalculateExisting,
    };
    if (scopeMode === "rule" && selectedRuleId) {
      body.rule_ids = [selectedRuleId];
    } else if (scopeMode === "tariff" && selectedTariffId) {
      body.source_tariff_id = selectedTariffId;
    } else {
      body.source_product_id = productId;
    }
    if (mode === "execute" && forceExecute) {
      body.force_execute = true;
    }
    return body;
  };

  const runRetroApply = async (mode: "preview" | "execute") => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("rules-retroapply", {
        body: buildBody(mode),
      });

      if (error) {
        toast.error("Ошибка: " + (error.message || "Неизвестная ошибка"));
        return;
      }

      const res = data as RetroApplyResult;
      setResult(res);

      if (res.error || res.stop_reasons?.length) {
        toast.error(res.error || res.stop_reasons?.join("; ") || "Заблокировано stop-guard");
      } else if (mode === "execute") {
        toast.success(`Выполнено: создано ${res.executed?.created || 0}, обновлено ${res.executed?.updated || 0}, пропущено ${res.executed?.skipped || 0}`);
      }
    } catch (err) {
      toast.error("Ошибка вызова RetroApply");
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePreview = () => runRetroApply("preview");
  const handleExecute = () => {
    setConfirmExecute(false);
    setForceExecute(false);
    runRetroApply("execute");
  };
  const handleForceExecute = () => {
    setConfirmExecute(false);
    setForceExecute(true);
    // Re-run with force
    setIsLoading(true);
    supabase.functions.invoke("rules-retroapply", {
      body: { ...buildBody("execute"), force_execute: true },
    }).then(({ data, error }) => {
      if (error) {
        toast.error("Ошибка: " + error.message);
      } else {
        const res = data as RetroApplyResult;
        setResult(res);
        if (res.executed) {
          toast.success(`Выполнено: создано ${res.executed.created}, обновлено ${res.executed.updated}`);
        }
      }
    }).catch(err => {
      toast.error("Ошибка");
      console.error(err);
    }).finally(() => setIsLoading(false));
  };

  const canExecute = result && !result.error && result.summary &&
    (result.summary.missing_access > 0 || result.summary.aligned_update_needed > 0);

  const hasStopGuard = result?.stop_reasons && result.stop_reasons.length > 0;

  const groupedActions = useMemo(() => {
    if (!result?.actions) return {};
    const groups: Record<string, UserAction[]> = {};
    for (const a of result.actions) {
      if (!groups[a.category]) groups[a.category] = [];
      groups[a.category].push(a);
    }
    return groups;
  }, [result]);

  return (
    <>
      <Card>
        <CardHeader className="py-3 px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm">RetroApply правил</CardTitle>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setDialogOpen(true); setResult(null); }}
              className="h-7 text-xs gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Применить правила к историческим подписчикам
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Новые оплаты обрабатываются автоматически. Для старых подписок нужен ручной запуск.
          </p>
        </CardHeader>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>RetroApply — применение правил к историческим данным</DialogTitle>
            <DialogDescription>
              Универсальный механизм. Не привязан к конкретному тарифу или продукту.
              Правило выбирается параметрами запуска.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 overflow-y-auto flex-1 min-h-0 pr-1">
            {/* Scope selection */}
            <div className="space-y-3">
              <Label className="text-xs font-semibold">Область применения</Label>
              <Select value={scopeMode} onValueChange={(v) => setScopeMode(v as ScopeMode)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="product">Все правила продукта</SelectItem>
                  <SelectItem value="tariff">Все правила тарифа</SelectItem>
                  <SelectItem value="rule">Конкретное правило</SelectItem>
                </SelectContent>
              </Select>

              {scopeMode === "rule" && (
                <Select value={selectedRuleId} onValueChange={setSelectedRuleId}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Выберите правило" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeRules.map(r => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.target_label || r.target_ref} ({r.grant_target_type})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {scopeMode === "tariff" && (
                <Select value={selectedTariffId} onValueChange={setSelectedTariffId}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Выберите тариф" />
                  </SelectTrigger>
                  <SelectContent>
                    {tariffs.map(t => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Mode selection */}
            <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/20">
              <Checkbox
                id="recalculate"
                checked={recalculateExisting}
                onCheckedChange={(v) => setRecalculateExisting(!!v)}
              />
              <div>
                <Label htmlFor="recalculate" className="text-xs font-medium cursor-pointer">
                  Пересчитать сроки существующих доступов
                </Label>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Без этого флага — только довыдача отсутствующих (grant missing access).
                  С флагом — ещё и обновление сроков уже выданных доступов (recalculate existing).
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                onClick={handlePreview}
                disabled={isLoading || (scopeMode === "rule" && !selectedRuleId) || (scopeMode === "tariff" && !selectedTariffId)}
                variant="outline"
                size="sm"
                className="gap-1.5"
              >
                <Eye className="h-3.5 w-3.5" />
                {isLoading ? "Загрузка…" : "Preview"}
              </Button>

              {canExecute && !hasStopGuard && (
                <Button
                  onClick={() => setConfirmExecute(true)}
                  disabled={isLoading}
                  size="sm"
                  className="gap-1.5"
                >
                  <Play className="h-3.5 w-3.5" />
                  Применить
                </Button>
              )}
            </div>

            {/* Results */}
            {result && (
              <div className="space-y-3">
                {/* Summary */}
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => {
                    const count = result.summary?.[key as keyof typeof result.summary] ?? 0;
                    if (count === 0 && key !== "missing_access") return null;
                    const Icon = cfg.icon;
                    return (
                      <div key={key} className={cn("flex flex-col items-center p-2 rounded-lg border text-center", cfg.color)}>
                        <Icon className="h-4 w-4 mb-1" />
                        <span className="text-lg font-bold">{count as number}</span>
                        <span className="text-[9px] leading-tight">{cfg.label}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Stop-guard warnings */}
                {hasStopGuard && (
                  <div className="p-3 rounded-lg border border-red-300 bg-red-50 space-y-2">
                    <div className="flex items-center gap-2 text-red-700 font-medium text-xs">
                      <AlertTriangle className="h-4 w-4" />
                      STOP-guard сработал
                    </div>
                    {result.stop_reasons!.map((r, i) => (
                      <p key={i} className="text-xs text-red-600">• {r}</p>
                    ))}
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setConfirmExecute(true)}
                      className="mt-2 text-xs"
                    >
                      Подтвердить и применить принудительно
                    </Button>
                  </div>
                )}

                {/* Executed results */}
                {result.executed && (
                  <div className="p-3 rounded-lg border border-green-300 bg-green-50">
                    <div className="flex items-center gap-2 text-green-700 font-medium text-xs mb-1">
                      <CheckCircle2 className="h-4 w-4" />
                      Выполнено
                    </div>
                    <p className="text-xs text-green-600">
                      Создано: {result.executed.created} · Обновлено: {result.executed.updated} · Пропущено: {result.executed.skipped}
                    </p>
                  </div>
                )}

                {/* Actions table */}
                {result.actions && result.actions.length > 0 && (
                  <div className="border rounded-lg overflow-hidden">
                    <div className="max-h-[300px] overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50 sticky top-0">
                          <tr>
                            <th className="text-left p-2 font-medium">Email</th>
                            <th className="text-left p-2 font-medium">Продукт</th>
                            <th className="text-left p-2 font-medium">Категория</th>
                            <th className="text-left p-2 font-medium">Срок</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.actions.slice(0, 100).map((a, i) => {
                            const cfg = CATEGORY_CONFIG[a.category] || CATEGORY_CONFIG.already_satisfied;
                            return (
                              <tr key={i} className="border-t">
                                <td className="p-2 truncate max-w-[180px]">{a.email}</td>
                                <td className="p-2 truncate max-w-[150px]">{a.target_product_name || a.target_product_code}</td>
                                <td className="p-2">
                                  <Badge variant="outline" className={cn("text-[9px]", cfg.color)}>
                                    {cfg.label}
                                  </Badge>
                                </td>
                                <td className="p-2 text-muted-foreground">
                                  {a.planned_expires_at ? new Date(a.planned_expires_at).toLocaleDateString("ru-RU") : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {result.actions.length > 100 && (
                        <p className="text-center text-[10px] text-muted-foreground py-2">
                          Показано 100 из {result.actions.length}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="flex-shrink-0">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Закрыть</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm execute dialog */}
      <AlertDialog open={confirmExecute} onOpenChange={setConfirmExecute}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Подтвердите применение</AlertDialogTitle>
            <AlertDialogDescription>
              {hasStopGuard ? (
                <>
                  STOP-guard сработал. Вы уверены, что хотите продолжить?
                  <br />
                  {result?.stop_reasons?.map((r, i) => <span key={i} className="block text-red-600 mt-1">• {r}</span>)}
                </>
              ) : (
                <>
                  Будет создано: {result?.summary?.missing_access || 0} доступов.
                  {recalculateExisting && <> Обновлено сроков: {result?.summary?.aligned_update_needed || 0}.</>}
                  <br />Это действие нельзя отменить автоматически.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={hasStopGuard ? handleForceExecute : handleExecute}>
              {hasStopGuard ? "Применить принудительно" : "Применить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}