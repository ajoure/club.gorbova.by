/**
 * Панель применения правил к историческим данным.
 * Полностью на русском языке, без сырых UUID/техкодов.
 *
 * НЕ привязан к конкретному продукту/тарифу/клубу.
 * Правило выбирается параметрами запуска.
 *
 * Режимы execute:
 *   - Применить безопасные изменения (missing_access + aligned_update_needed)
 *   - Применить с сокращением сроков (+ reducible_by_rule, allow_reduce_access)
 *   - Применить выбранные записи (selected_action_ids)
 */

import { useState, useMemo, useCallback } from "react";
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
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  RefreshCw, Eye, Play, AlertTriangle, CheckCircle2, XCircle,
  MinusCircle, HelpCircle, ChevronDown, ChevronRight, ShieldAlert,
  ArrowDownCircle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { AccessRule } from "@/hooks/useAccessRules";

// ═══════ TYPES ═══════

interface RetroApplyPanelProps {
  productId: string;
  rules: AccessRule[];
  tariffs: Array<{ id: string; name: string }>;
}

interface UserAction {
  action_id: string;
  user_id: string;
  profile_id: string | null;
  email: string;
  full_name: string | null;
  rule_id: string;
  rule_target_type: string;
  rule_target_label: string | null;
  rule_source_product_name: string | null;
  rule_source_tariff_name: string | null;
  rule_duration_mode: string;
  rule_duration_days: number | null;
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
  rules?: Array<{
    id: string;
    grant_target_type: string;
    target_label: string | null;
    source_product_name: string | null;
    source_tariff_name: string | null;
  }>;
  summary: {
    total: number;
    missing_access: number;
    aligned_update_needed: number;
    reducible_by_rule: number;
    requires_manual_review: number;
    conflict_existing: number;
    already_satisfied: number;
    condition_not_met: number;
    no_source_window: number;
  };
  executed?: {
    targeted: number;
    created: number;
    reactivated: number;
    reactivation_candidates_found: number;
    updated: number;
    skipped_idempotent: number;
    skipped_conflict: number;
    skipped_error: number;
    not_selected: number;
    created_action_ids?: string[];
    reactivated_action_ids?: string[];
    updated_action_ids?: string[];
    skipped_action_ids?: string[];
    errors?: Array<{ action_id: string; error: string }>;
  };
  actions: UserAction[];
  error?: string;
  stop_reasons?: string[];
}

// ═══════ LOCALIZATION ═══════

const CATEGORY_CONFIG: Record<string, {
  label: string;
  description: string;
  color: string;
  icon: typeof CheckCircle2;
}> = {
  missing_access: {
    label: "Будет выдан доступ",
    description: "Будет выдан новый доступ",
    color: "text-green-700 bg-green-50 border-green-200",
    icon: CheckCircle2,
  },
  aligned_update_needed: {
    label: "Будет обновлён срок",
    description: "Доступ уже есть, будет обновлён только срок",
    color: "text-amber-700 bg-amber-50 border-amber-200",
    icon: RefreshCw,
  },
  reducible_by_rule: {
    label: "Будет сокращён срок",
    description: "Срок будет сокращён до канонического по правилу",
    color: "text-orange-700 bg-orange-50 border-orange-200",
    icon: ArrowDownCircle,
  },
  requires_manual_review: {
    label: "Требует ручного решения",
    description: "Неоднозначный случай, требует решения администратора",
    color: "text-yellow-700 bg-yellow-50 border-yellow-200",
    icon: HelpCircle,
  },
  already_satisfied: {
    label: "Уже соответствует",
    description: "Доступ уже выдан, менять не нужно",
    color: "text-muted-foreground bg-muted/30 border-muted",
    icon: MinusCircle,
  },
  conflict_existing: {
    label: "Конфликт",
    description: "Реальный конфликт, автоматическое применение невозможно",
    color: "text-red-700 bg-red-50 border-red-200",
    icon: XCircle,
  },
  condition_not_met: {
    label: "Условие не выполнено",
    description: "Правило к этим людям не подходит",
    color: "text-muted-foreground bg-muted/30 border-muted",
    icon: HelpCircle,
  },
  no_source_window: {
    label: "Нельзя определить срок",
    description: "Нельзя рассчитать срок автоматически",
    color: "text-red-700 bg-red-50 border-red-200",
    icon: AlertTriangle,
  },
};

/** Russian translations for skip_reason / stop_reason codes */
const REASON_LABELS: Record<string, string> = {
  prior_purchase_not_found: "Предыдущая покупка не найдена",
  no_access_end_at_and_no_duration_days: "Нет даты окончания и не задан фиксированный срок",
  existing_entitlement_from_different_source: "Существующий доступ от другого источника",
  safe_recalculate_expires_extended: "Срок будет выровнен по правилу",
  safe_recalculate_expires_missing: "Текущий срок отсутствует, будет рассчитан заново",
  safe_recalculate_available_but_disabled: "Срок можно безопасно обновить, но пересчёт сроков сейчас выключен",
  reducible_by_canonical_rule: "Срок будет сокращён до канонического по правилу",
  requires_manual_decision: "Требует решения администратора",
  conflict_manual_source: "Конфликт: доступ выдан вручную",
  conflict_multiple_entitlements: "Конфликт: несколько активных доступов",
  conflict_would_reduce_access: "Конфликт: обновление сократит срок доступа",
  conflict_no_planned_expiry: "Конфликт: невозможно вычислить новый срок",
  conflict_different_rule_source: "Конфликт: доступ выдан по другому правилу",
};

function translateReason(code: string | null): string {
  if (!code) return "";
  return REASON_LABELS[code] || code;
}

function translateStopReason(raw: string): string {
  if (raw.startsWith("too_many_missing:")) {
    const n = raw.split(":")[1];
    return `Слишком много записей для создания: ${n} (лимит 200). Сначала выполните предпросмотр.`;
  }
  if (raw.startsWith("conflicts_detected:")) {
    const n = raw.split(":")[1];
    return `Обнаружено конфликтов: ${n}. Проверьте перед применением.`;
  }
  if (raw.startsWith("no_source_window:")) {
    const n = raw.split(":")[1];
    return `У ${n} контактов невозможно определить срок. Требуется ручная проверка.`;
  }
  return raw;
}

// Categories that support row selection for execute
const SELECTABLE_CATEGORIES = new Set([
  "missing_access", "aligned_update_needed", "reducible_by_rule", "requires_manual_review",
]);

type FilterKey = "all" | "changed" | "missing_access" | "aligned_update_needed" | "reducible_by_rule" | "requires_manual_review" | "conflict_existing" | "already_satisfied" | "condition_not_met" | "no_source_window";

type ScopeMode = "rule" | "product" | "tariff";

const PAGE_SIZE = 50;

// ═══════ HELPERS ═══════

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function contactDisplayName(a: UserAction): string {
  return a.full_name || a.email || a.user_id;
}

function contactHasName(a: UserAction): boolean {
  return !!a.full_name;
}

function ruleBasisLabel(a: UserAction): string {
  const parts: string[] = [];
  if (a.rule_target_label) parts.push(a.rule_target_label);
  if (a.rule_source_tariff_name) {
    parts.push(`тариф: ${a.rule_source_tariff_name}`);
  } else if (a.rule_source_product_name) {
    parts.push(`продукт: ${a.rule_source_product_name}`);
  }
  if (a.rule_duration_mode === "fixed_days" && a.rule_duration_days) {
    parts.push(`фикс. ${a.rule_duration_days} дн.`);
  } else {
    parts.push("по источнику");
  }
  return parts.join(" · ") || "—";
}

function isChangedCategory(cat: string): boolean {
  return cat === "missing_access" || cat === "aligned_update_needed";
}

function isActionableCategory(cat: string): boolean {
  return cat === "missing_access" || cat === "aligned_update_needed" || cat === "reducible_by_rule";
}

// ═══════ COMPONENT ═══════

export function RetroApplyPanel({ productId, rules, tariffs }: RetroApplyPanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [scopeMode, setScopeMode] = useState<ScopeMode>("product");
  const [selectedRuleId, setSelectedRuleId] = useState<string>("");
  const [selectedTariffId, setSelectedTariffId] = useState<string>("");
  const [recalculateExisting, setRecalculateExisting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<RetroApplyResult | null>(null);
  const [confirmExecute, setConfirmExecute] = useState(false);
  const [executeMode, setExecuteMode] = useState<"safe" | "with_reductions" | "selected">("safe");
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const activeRules = useMemo(() =>
    rules.filter(r => r.is_active && ["product_access", "club"].includes(r.grant_target_type)),
    [rules]
  );

  const isExecuted = !!(result?.executed);

  // ── canPreview guard ──
  const canPreview = useMemo(() => {
    if (isLoading) return false;
    if (scopeMode === "rule" && !selectedRuleId) return false;
    if (scopeMode === "tariff" && !selectedTariffId) return false;
    return true;
  }, [isLoading, scopeMode, selectedRuleId, selectedTariffId]);

  const buildBody = (mode: "preview" | "execute", opts?: {
    allowReduceAccess?: boolean;
    selectedActionIds?: string[];
    applyCategories?: string[];
  }) => {
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
    if (opts?.allowReduceAccess) body.allow_reduce_access = true;
    if (opts?.selectedActionIds?.length) body.selected_action_ids = opts.selectedActionIds;
    if (opts?.applyCategories?.length) body.apply_categories = opts.applyCategories;
    return body;
  };

  const runRetroApply = async (mode: "preview" | "execute", opts?: {
    allowReduceAccess?: boolean;
    selectedActionIds?: string[];
    applyCategories?: string[];
  }) => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("rules-retroapply", {
        body: buildBody(mode, opts),
      });

      if (error) {
        toast.error("Ошибка: " + (error.message || "Неизвестная ошибка"));
        return;
      }

      const res = data as RetroApplyResult;
      setResult(res);
      setVisibleCount(PAGE_SIZE);
      setExpandedRows(new Set());

      if (mode === "preview") {
        setActiveFilter("all");
        setSelectedIds(new Set());
      }

      if (res.error || res.stop_reasons?.length) {
        // Don't toast — show inline
      } else if (mode === "execute") {
        toast.success(`Фактически изменено: создано ${res.executed?.created || 0}, обновлено ${res.executed?.updated || 0}`);
        // Auto-refresh preview after execute to show actual state
        autoRefreshPreview();
      }
    } catch (err) {
      toast.error("Ошибка вызова");
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const autoRefreshPreview = useCallback(async () => {
    // Small delay to let DB settle, then re-preview
    setTimeout(async () => {
      try {
        const { data, error } = await supabase.functions.invoke("rules-retroapply", {
          body: buildBody("preview"),
        });
        if (!error && data) {
          setResult(prev => {
            const newRes = data as RetroApplyResult;
            // Preserve executed from previous result
            return {
              ...newRes,
              executed: prev?.executed,
            };
          });
          setExpandedRows(new Set());
          setSelectedIds(new Set());
        }
      } catch {
        // silent — execute already succeeded
      }
    }, 1500);
  }, [scopeMode, selectedRuleId, selectedTariffId, productId, recalculateExisting]);

  const handlePreview = () => {
    setActiveFilter("all");
    setSelectedIds(new Set());
    runRetroApply("preview");
  };

  const handleExecuteSafe = () => {
    setConfirmExecute(false);
    runRetroApply("execute", {
      applyCategories: ["missing_access", "aligned_update_needed"],
    });
  };

  const handleExecuteWithReductions = () => {
    setConfirmExecute(false);
    runRetroApply("execute", {
      allowReduceAccess: true,
      applyCategories: ["missing_access", "aligned_update_needed", "reducible_by_rule"],
    });
  };

  const handleExecuteSelected = () => {
    setConfirmExecute(false);
    const ids = [...selectedIds];
    // Check if any selected are reducible
    const hasReducible = result?.actions?.some(
      a => selectedIds.has(a.action_id) && a.category === "reducible_by_rule"
    );
    runRetroApply("execute", {
      selectedActionIds: ids,
      allowReduceAccess: !!hasReducible,
    });
  };

  // Determine blocking state
  const hasConflicts = (result?.summary?.conflict_existing ?? 0) > 0;
  const hasNoSourceWindow = (result?.summary?.no_source_window ?? 0) > 0;
  const hasStopGuard = !!(result?.stop_reasons?.length);

  const safeCount = useMemo(() => {
    if (!result?.summary) return 0;
    return result.summary.missing_access + result.summary.aligned_update_needed;
  }, [result]);

  const reducibleCount = result?.summary?.reducible_by_rule ?? 0;
  const manualReviewCount = result?.summary?.requires_manual_review ?? 0;

  const canExecuteSafe = result && !result.error && safeCount > 0 && !isExecuted;
  const canExecuteWithReductions = result && !result.error && reducibleCount > 0 && !isExecuted;
  const canExecuteSelected = selectedIds.size > 0 && !isExecuted;

  // Changed count for "changed" filter
  const changedCount = useMemo(() => {
    if (!result?.summary) return 0;
    return result.summary.missing_access + result.summary.aligned_update_needed;
  }, [result]);

  // Filtered actions
  const filteredActions = useMemo(() => {
    if (!result?.actions) return [];
    if (activeFilter === "all") return result.actions;
    if (activeFilter === "changed") return result.actions.filter(a => isChangedCategory(a.category));
    return result.actions.filter(a => a.category === activeFilter);
  }, [result, activeFilter]);

  // Selection helpers
  const selectableInFilter = useMemo(() =>
    filteredActions.filter(a => SELECTABLE_CATEGORIES.has(a.category)),
    [filteredActions]
  );

  const allFilteredSelected = selectableInFilter.length > 0 &&
    selectableInFilter.every(a => selectedIds.has(a.action_id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      // Deselect all in current filter
      setSelectedIds(prev => {
        const next = new Set(prev);
        selectableInFilter.forEach(a => next.delete(a.action_id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        selectableInFilter.forEach(a => next.add(a.action_id));
        return next;
      });
    }
  };

  const toggleSelect = (actionId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(actionId)) next.delete(actionId);
      else next.add(actionId);
      return next;
    });
  };

  const toggleRow = (idx: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  // Scope description text
  const scopeDescription = useMemo(() => {
    if (scopeMode === "rule" && selectedRuleId) {
      const r = activeRules.find(x => x.id === selectedRuleId);
      return `Проверяется одно правило: ${r?.target_label || "выбранное правило"}`;
    }
    if (scopeMode === "tariff" && selectedTariffId) {
      const t = tariffs.find(x => x.id === selectedTariffId);
      return `Проверяются все правила тарифа «${t?.name || "выбранный тариф"}»`;
    }
    return "Проверяются все правила текущего продукта";
  }, [scopeMode, selectedRuleId, selectedTariffId, activeRules, tariffs]);

  const modeDescription = recalculateExisting
    ? "Будут выданы недостающие доступы и пересчитаны сроки уже выданных."
    : "Будут выданы только недостающие доступы. Уже выданные не изменятся.";

  const hasResults = result && result.summary && result.summary.total > 0;
  const hasEmptyResults = result && result.summary && result.summary.total === 0 && !result.error && !result.stop_reasons?.length;

  return (
    <>
      <Card>
        <CardHeader className="py-3 px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm">Применение правил к историческим данным</CardTitle>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setDialogOpen(true); setResult(null); setActiveFilter("all"); setExpandedRows(new Set()); setSelectedIds(new Set()); }}
              className="h-7 text-xs gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Запустить проверку
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Новые оплаты обрабатываются автоматически. Для старых подписок — ручной запуск через предпросмотр и применение.
          </p>
        </CardHeader>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>Применение правил к историческим данным</DialogTitle>
            <DialogDescription>
              Инструмент ручного применения изменённых правил к уже существующим подписчикам.
              Новые правила на старую когорту автоматически не распространяются.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 overflow-y-auto flex-1 min-h-0 pr-1">
            {/* ── Scope selection ── */}
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
                <div className="space-y-1">
                  <Select value={selectedRuleId} onValueChange={setSelectedRuleId}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Выберите правило" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeRules.map(r => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.target_label || r.target_ref}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!selectedRuleId && (
                    <p className="text-[10px] text-amber-600">Выберите правило для запуска предпросмотра</p>
                  )}
                </div>
              )}

              {scopeMode === "tariff" && (
                <div className="space-y-1">
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
                  {!selectedTariffId && (
                    <p className="text-[10px] text-amber-600">Выберите тариф для запуска предпросмотра</p>
                  )}
                </div>
              )}
            </div>

            {/* ── Mode selection ── */}
            <div className="space-y-2 p-3 rounded-lg border bg-muted/20">
              <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                Выдать недостающие доступы
                <Badge variant="outline" className="text-[9px] ml-1">по умолчанию</Badge>
              </div>
              <div className="flex items-start gap-3 mt-2">
                <Checkbox
                  id="recalculate"
                  checked={recalculateExisting}
                  onCheckedChange={(v) => setRecalculateExisting(!!v)}
                />
                <div>
                  <Label htmlFor="recalculate" className="text-xs font-medium cursor-pointer">
                    Также пересчитать сроки уже выданных доступов
                  </Label>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Если включено, у контактов с уже выданными доступами будут обновлены сроки в соответствии с текущими правилами.
                  </p>
                </div>
              </div>
            </div>

            {/* ── Context block BEFORE preview ── */}
            {!result && (
              <div className="p-3 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/10 text-xs text-muted-foreground space-y-1">
                <p>📋 {scopeDescription}</p>
                <p>🔧 {modeDescription}</p>
                <p>👥 Когорта: активные и past_due подписчики выбранного продукта/тарифа.</p>
              </div>
            )}

            {/* ── Preview button ── */}
            {!result && (
              <div className="space-y-1">
                <Button
                  onClick={handlePreview}
                  disabled={!canPreview}
                  variant="default"
                  size="sm"
                  className="gap-1.5"
                >
                  <Eye className="h-3.5 w-3.5" />
                  {isLoading ? "Загрузка…" : "Предпросмотр"}
                </Button>
              </div>
            )}

            {/* ── Empty results state ── */}
            {hasEmptyResults && (
              <div className="text-center py-8 space-y-2">
                <MinusCircle className="h-8 w-8 text-muted-foreground mx-auto" />
                <p className="text-sm text-muted-foreground">
                  Не найдено записей, подходящих под выбранные правила
                </p>
                <Button
                  onClick={handlePreview}
                  disabled={!canPreview}
                  variant="outline"
                  size="sm"
                  className="gap-1.5 mt-2"
                >
                  <Eye className="h-3.5 w-3.5" />
                  Повторить предпросмотр
                </Button>
              </div>
            )}

            {/* ── Results (shown only when total > 0) ── */}
            {hasResults && (
              <div className="space-y-3">
                {/* Compact scope summary after preview */}
                <div className="p-2 rounded-md bg-muted/30 text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                  <span>📋 {scopeDescription}</span>
                  <span className="text-muted-foreground/50">·</span>
                  <span>🔧 {modeDescription}</span>
                </div>

                {/* Textual outcome summary */}
                <div className="p-3 rounded-lg border bg-muted/10 text-sm space-y-1">
                  {safeCount > 0 || reducibleCount > 0 ? (
                    <>
                      {result!.summary.missing_access > 0 && (
                        <p>
                          <span className="font-medium text-green-700">Новых доступов будет создано:</span>{" "}
                          {result!.summary.missing_access}
                        </p>
                      )}
                      {result!.summary.aligned_update_needed > 0 && (
                        <p>
                          <span className="font-medium text-amber-700">Существующих сроков будет обновлено:</span>{" "}
                          {result!.summary.aligned_update_needed}
                        </p>
                      )}
                      {reducibleCount > 0 && (
                        <p>
                          <span className="font-medium text-orange-700">Сроков будет сокращено по правилу:</span>{" "}
                          {reducibleCount}
                        </p>
                      )}
                      {manualReviewCount > 0 && (
                        <p>
                          <span className="font-medium text-yellow-700">Требует ручного решения:</span>{" "}
                          {manualReviewCount}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-muted-foreground">Изменений не требуется. Все доступы уже соответствуют правилам.</p>
                  )}
                </div>

                {/* Summary cards — clickable filters */}
                <div className="flex gap-1.5 flex-wrap">
                  {/* "All" filter */}
                  <button
                    onClick={() => setActiveFilter("all")}
                    className={cn(
                      "flex flex-col items-center px-3 py-2 rounded-lg border text-center transition-all cursor-pointer min-w-[70px]",
                      activeFilter === "all"
                        ? "ring-2 ring-primary border-primary bg-primary/5"
                        : "hover:bg-muted/50"
                    )}
                  >
                    <span className="text-lg font-bold">{result!.summary.total}</span>
                    <span className="text-[9px] leading-tight">Все</span>
                  </button>

                  {/* "Changed" virtual filter */}
                  {changedCount > 0 && (
                    <button
                      onClick={() => setActiveFilter("changed")}
                      className={cn(
                        "flex flex-col items-center px-3 py-2 rounded-lg border text-center transition-all cursor-pointer min-w-[70px]",
                        "text-blue-700 bg-blue-50 border-blue-200",
                        activeFilter === "changed"
                          ? "ring-2 ring-primary"
                          : "opacity-80 hover:opacity-100"
                      )}
                    >
                      <Play className="h-3.5 w-3.5 mb-0.5" />
                      <span className="text-lg font-bold">{changedCount}</span>
                      <span className="text-[9px] leading-tight">Безопасные</span>
                    </button>
                  )}

                  {(Object.entries(CATEGORY_CONFIG) as [string, typeof CATEGORY_CONFIG[string]][]).map(([key, cfg]) => {
                    const count = result!.summary?.[key as keyof typeof result.summary] ?? 0;
                    if (count === 0) return null;
                    const Icon = cfg.icon;
                    return (
                      <button
                        key={key}
                        onClick={() => setActiveFilter(key as FilterKey)}
                        className={cn(
                          "flex flex-col items-center px-3 py-2 rounded-lg border text-center transition-all cursor-pointer min-w-[70px]",
                          cfg.color,
                          activeFilter === key
                            ? "ring-2 ring-primary"
                            : "opacity-80 hover:opacity-100"
                        )}
                      >
                        <Icon className="h-3.5 w-3.5 mb-0.5" />
                        <span className="text-lg font-bold">{count as number}</span>
                        <span className="text-[9px] leading-tight">{cfg.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Stop-guard warnings */}
                {hasStopGuard && (
                  <div className="p-3 rounded-lg border-2 border-red-400 bg-red-50 space-y-2">
                    <div className="flex items-center gap-2 text-red-700 font-medium text-xs">
                      <AlertTriangle className="h-4 w-4" />
                      Применение заблокировано
                    </div>
                    {result!.stop_reasons!.map((r, i) => (
                      <p key={i} className="text-xs text-red-600">• {translateStopReason(r)}</p>
                    ))}
                  </div>
                )}

                {/* Conflict/no_source warning — informational, not blocking targeted execute */}
                {(hasConflicts || hasNoSourceWindow) && !hasStopGuard && (
                  <div className="p-3 rounded-lg border border-red-200 bg-red-50/50 space-y-1">
                    <div className="flex items-center gap-2 text-red-700 font-medium text-xs">
                      <ShieldAlert className="h-4 w-4" />
                      Обнаружены неразрешимые записи
                    </div>
                    <ul className="text-xs text-red-600 space-y-0.5 ml-6 list-disc">
                      {hasConflicts && (
                        <li>Конфликтов: {result!.summary.conflict_existing} (автоматическое применение невозможно)</li>
                      )}
                      {hasNoSourceWindow && (
                        <li>Записей без определяемого срока: {result!.summary.no_source_window}</li>
                      )}
                    </ul>
                  </div>
                )}

                {/* ── Execute action buttons ── */}
                {!isExecuted && (
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      onClick={handlePreview}
                      disabled={!canPreview}
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      {isLoading ? "Загрузка…" : "Обновить предпросмотр"}
                    </Button>

                    {canExecuteSafe && (
                      <Button
                        onClick={() => { setExecuteMode("safe"); setConfirmExecute(true); }}
                        disabled={isLoading}
                        size="sm"
                        className="gap-1.5"
                      >
                        <Play className="h-3.5 w-3.5" />
                        Применить безопасные изменения ({safeCount})
                      </Button>
                    )}

                    {canExecuteWithReductions && (
                      <Button
                        onClick={() => { setExecuteMode("with_reductions"); setConfirmExecute(true); }}
                        disabled={isLoading}
                        size="sm"
                        variant="secondary"
                        className="gap-1.5 text-orange-700"
                      >
                        <ArrowDownCircle className="h-3.5 w-3.5" />
                        Применить с сокращением сроков ({reducibleCount})
                      </Button>
                    )}

                    {canExecuteSelected && (
                      <Button
                        onClick={() => { setExecuteMode("selected"); setConfirmExecute(true); }}
                        disabled={isLoading}
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Применить выбранные ({selectedIds.size})
                      </Button>
                    )}
                  </div>
                )}

                {/* Post-execute result block */}
                {isExecuted && (
                  <div className="p-3 rounded-lg border border-green-300 bg-green-50 space-y-2">
                    <div className="flex items-center gap-2 text-green-700 font-medium text-xs">
                      <CheckCircle2 className="h-4 w-4" />
                      Правила применены
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div className="text-center">
                        <div className="text-lg font-bold text-green-700">{result!.executed!.created || 0}</div>
                        <div className="text-green-600">Создано</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-bold text-emerald-700">{result!.executed!.reactivated || 0}</div>
                        <div className="text-emerald-600">Реактивировано</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-bold text-amber-700">{result!.executed!.updated || 0}</div>
                        <div className="text-amber-600">Обновлено</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-bold text-muted-foreground/50">{result!.executed!.not_selected || 0}</div>
                        <div className="text-muted-foreground/50">Не входило в запуск</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs mt-1">
                      <div className="text-center">
                        <div className="text-sm font-semibold text-muted-foreground">{result!.executed!.skipped_idempotent || 0}</div>
                        <div className="text-muted-foreground text-[10px]">Пропущено (идемпотентно)</div>
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-semibold text-orange-600">{result!.executed!.skipped_conflict || 0}</div>
                        <div className="text-orange-500 text-[10px]">Не применено по статусу</div>
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-semibold text-red-600">{result!.executed!.skipped_error || 0}</div>
                        <div className="text-red-500 text-[10px]">Ошибки</div>
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Запущено к обработке: {result!.executed!.targeted || 0}.
                      Фактически изменено: {(result!.executed!.created || 0) + (result!.executed!.reactivated || 0) + (result!.executed!.updated || 0)}.
                      {(result!.executed!.reactivated || 0) > 0 && ` Реактивировано expired → active: ${result!.executed!.reactivated}.`}
                      {(result!.executed!.reactivation_candidates_found || 0) > 0 && ` Найдено expired записей: ${result!.executed!.reactivation_candidates_found}.`}
                      {(result!.executed!.skipped_idempotent || 0) > 0 && ` Уже существовало: ${result!.executed!.skipped_idempotent}.`}
                    </p>
                    {result!.executed!.errors && result!.executed!.errors.length > 0 && (
                      <div className="text-[10px] text-red-600 mt-1">
                        {result!.executed!.errors.map((e: any, i: number) => {
                          const raw = String(e.error || "");
                          let human = raw;
                          if (raw.startsWith("manual_lineage_protected")) {
                            human = "Доступ выдан вручную и привязан к другому правилу — оставлен без изменений, требует решения администратора.";
                          } else if (raw.startsWith("unsafe_status_for_reactivation")) {
                            const st = raw.split(":")[1]?.trim() || "";
                            human = `Статус доступа (${st}) не позволяет автоматическую реактивацию.`;
                          } else if (raw.startsWith("source_rule_id_conflict")) {
                            human = "Конфликт привязки к правилу — обновите страницу и повторите предпросмотр.";
                          }
                          return <p key={i}>❌ {human}</p>;
                        })}
                      </div>
                    )}
                    <p className="text-[10px] text-muted-foreground italic">
                      Таблица ниже обновлена по текущему состоянию базы данных.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs"
                        onClick={handlePreview}
                      >
                        <Eye className="h-3 w-3 mr-1" />
                        Новый предпросмотр
                      </Button>
                    </div>
                  </div>
                )}

                {/* Selection bar */}
                {selectableInFilter.length > 0 && !isExecuted && (
                  <div className="flex items-center gap-3 px-3 py-1.5 rounded-md bg-muted/30 text-xs">
                    <Checkbox
                      checked={allFilteredSelected}
                      onCheckedChange={toggleSelectAll}
                      id="select-all"
                    />
                    <Label htmlFor="select-all" className="text-xs cursor-pointer">
                      {allFilteredSelected ? "Снять все" : `Выбрать все в фильтре (${selectableInFilter.length})`}
                    </Label>
                    {selectedIds.size > 0 && (
                      <span className="text-muted-foreground ml-auto">
                        Выбрано: {selectedIds.size}
                      </span>
                    )}
                  </div>
                )}

                {/* Actions table */}
                {filteredActions.length > 0 && (
                  <div className="border rounded-lg overflow-hidden">
                    <div className="bg-muted/30 px-3 py-1.5 flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">
                        {activeFilter !== "all" && (
                          <Badge variant="outline" className="text-[9px] mr-2">
                            {activeFilter === "changed" ? "Безопасные" : (CATEGORY_CONFIG[activeFilter]?.label || activeFilter)}
                          </Badge>
                        )}
                        Показано {Math.min(visibleCount, filteredActions.length)} из {filteredActions.length}
                      </span>
                    </div>
                    <div className="max-h-[350px] overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50 sticky top-0 z-10">
                          <tr>
                            {!isExecuted && <th className="w-8 p-2"></th>}
                            <th className="w-6 p-2"></th>
                            <th className="text-left p-2 font-medium">Контакт</th>
                            <th className="text-left p-2 font-medium">Какой доступ</th>
                            <th className="text-left p-2 font-medium">Основание</th>
                            <th className="text-left p-2 font-medium">Что произойдёт</th>
                            <th className="text-left p-2 font-medium">Текущий срок</th>
                            <th className="text-left p-2 font-medium">Новый срок</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredActions.slice(0, visibleCount).map((a, i) => {
                            const cfg = CATEGORY_CONFIG[a.category] || CATEGORY_CONFIG.already_satisfied;
                            const isExpanded = expandedRows.has(i);
                            const isSelectable = SELECTABLE_CATEGORIES.has(a.category);
                            const isSelected = selectedIds.has(a.action_id);
                            return (
                              <TableRow
                                key={`${a.action_id}-${i}`}
                                action={a}
                                cfg={cfg}
                                isExpanded={isExpanded}
                                isExecuted={isExecuted}
                                isSelectable={isSelectable && !isExecuted}
                                isSelected={isSelected}
                                onToggle={() => toggleRow(i)}
                                onSelect={() => toggleSelect(a.action_id)}
                              />
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {filteredActions.length > visibleCount && (
                      <div className="p-2 text-center border-t">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs"
                          onClick={() => setVisibleCount(prev => prev + PAGE_SIZE)}
                        >
                          Показать ещё {Math.min(PAGE_SIZE, filteredActions.length - visibleCount)} из {filteredActions.length - visibleCount}
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {filteredActions.length === 0 && result!.actions.length > 0 && (
                  <div className="text-center text-xs text-muted-foreground py-4">
                    Нет записей в категории «{activeFilter === "changed" ? "Безопасные" : (CATEGORY_CONFIG[activeFilter]?.label || activeFilter)}»
                  </div>
                )}
              </div>
            )}

            {/* Error from engine */}
            {result?.error && (
              <div className="p-3 rounded-lg border-2 border-red-400 bg-red-50 text-xs text-red-700">
                <p className="font-medium">Ошибка: {result.error}</p>
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
            <AlertDialogTitle>
              {executeMode === "safe" && "Применить безопасные изменения?"}
              {executeMode === "with_reductions" && "Применить с сокращением сроков?"}
              {executeMode === "selected" && "Применить выбранные записи?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {executeMode === "safe" && (
                  <>
                    <p>Будет создано доступов: {result?.summary?.missing_access || 0}</p>
                    {recalculateExisting && (
                      <p>Будет обновлено сроков: {result?.summary?.aligned_update_needed || 0}</p>
                    )}
                  </>
                )}
                {executeMode === "with_reductions" && (
                  <>
                    <p>Будет создано доступов: {result?.summary?.missing_access || 0}</p>
                    <p>Будет обновлено сроков: {result?.summary?.aligned_update_needed || 0}</p>
                    <p className="text-orange-700 font-medium">
                      Будет сокращено сроков по правилу: {reducibleCount}
                    </p>
                  </>
                )}
                {executeMode === "selected" && (
                  <p>Будет обработано выбранных записей: {selectedIds.size}</p>
                )}
                <p className="text-sm mt-2">Это действие нельзя отменить автоматически.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (executeMode === "safe") handleExecuteSafe();
                else if (executeMode === "with_reductions") handleExecuteWithReductions();
                else handleExecuteSelected();
              }}
              className={executeMode === "with_reductions" ? "bg-orange-600 hover:bg-orange-700" : ""}
            >
              {executeMode === "safe" && "Применить безопасные"}
              {executeMode === "with_reductions" && "Применить с сокращением"}
              {executeMode === "selected" && "Применить выбранные"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ═══════ TABLE ROW (extracted for readability) ═══════

function TableRow({
  action: a,
  cfg,
  isExpanded,
  isExecuted,
  isSelectable,
  isSelected,
  onToggle,
  onSelect,
}: {
  action: UserAction;
  cfg: typeof CATEGORY_CONFIG[string];
  isExpanded: boolean;
  isExecuted: boolean;
  isSelectable: boolean;
  isSelected: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const actionLabel = useMemo(() => {
    if (a.category === "reducible_by_rule") {
      return "Сократить срок по правилу";
    }
    if (a.category === "requires_manual_review") {
      return "Требует решения";
    }
    return cfg.description;
  }, [a.category, cfg.description]);

  return (
    <>
      <tr
        className={cn("border-t cursor-pointer hover:bg-muted/30", isExpanded && "bg-muted/20")}
        onClick={onToggle}
      >
        {!isExecuted && (
          <td className="p-2" onClick={(e) => e.stopPropagation()}>
            {isSelectable && (
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => onSelect()}
              />
            )}
          </td>
        )}
        <td className="p-2 text-muted-foreground">
          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </td>
        <td className="p-2 max-w-[160px]">
          <div className="font-medium truncate">{contactDisplayName(a)}</div>
          {contactHasName(a) && a.email && (
            <div className="text-[10px] text-muted-foreground truncate">{a.email}</div>
          )}
        </td>
        <td className="p-2 truncate max-w-[130px]">{a.target_product_name || "—"}</td>
        <td className="p-2 truncate max-w-[160px] text-muted-foreground">{ruleBasisLabel(a)}</td>
        <td className="p-2">
          <Badge variant="outline" className={cn("text-[9px] whitespace-nowrap", cfg.color)}>
            {actionLabel}
          </Badge>
        </td>
        <td className="p-2 text-muted-foreground">{formatDate(a.current_expires_at)}</td>
        <td className="p-2">{formatDate(a.planned_expires_at)}</td>
      </tr>
      {isExpanded && (
        <tr className="bg-muted/10 border-t border-dashed">
          <td colSpan={isExecuted ? 7 : 8} className="p-3">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
              <div>
                <span className="text-muted-foreground">Какое правило: </span>
                <span className="font-medium">{a.rule_target_label || "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Целевой продукт: </span>
                <span className="font-medium">{a.target_product_name || "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Источник: </span>
                <span className="font-medium">
                  {a.rule_source_tariff_name
                    ? `Тариф «${a.rule_source_tariff_name}»`
                    : a.rule_source_product_name
                      ? `Продукт «${a.rule_source_product_name}»`
                      : "—"
                  }
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Как рассчитывается срок: </span>
                <span className="font-medium">
                  {a.rule_duration_mode === "fixed_days"
                    ? `Фиксированный: ${a.rule_duration_days} дн.`
                    : "По сроку подписки-источника"
                  }
                </span>
              </div>
              {a.source_subscription_id && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Идентификатор подписки-источника: </span>
                  <span className="text-[10px] text-muted-foreground/70 font-mono">{a.source_subscription_id}</span>
                </div>
              )}
              {/* Before / After comparison */}
              <div className="col-span-2 mt-1 p-2 rounded border bg-background">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-[10px] text-muted-foreground mb-0.5">Сейчас</div>
                    <div className="font-medium">{formatDate(a.current_expires_at)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground mb-0.5">По правилу</div>
                    <div className="font-medium">{formatDate(a.planned_expires_at)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground mb-0.5">Действие</div>
                    <Badge variant="outline" className={cn("text-[9px]", cfg.color)}>
                      {actionLabel}
                    </Badge>
                  </div>
                </div>
                {a.category === "reducible_by_rule" && (
                  <p className="text-[10px] text-orange-600 mt-1.5 text-center">
                    Может быть применено по решению администратора
                  </p>
                )}
              </div>
              {a.skip_reason && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Причина: </span>
                  <span className="font-medium">{translateReason(a.skip_reason)}</span>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
