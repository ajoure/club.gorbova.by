import { useState, useMemo } from "react";
import {
  useAccessRules, useEffectiveGrants,
  type AccessRule, type GrantTargetType, type RulePurpose,
  type EffectiveGrant, type LegacyMapping,
  getRulePurpose, getLegacyStatus, type LegacyStatus,
} from "@/hooks/useAccessRules";
import {
  useAvailableClubs, useAvailableProducts, useAvailableEntitlements,
  useTariffDurations, getClubAccessLabel,
} from "@/hooks/useAccessRuleSelectors";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import {
  Plus, Trash2, Pencil, ChevronDown, Shield, AlertTriangle, Eye,
  Users, Package, Zap, Clock, Star, Gift, Settings2, Info
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// === UI Labels & Config ===

const TARGET_TYPE_LABELS: Record<GrantTargetType, string> = {
  club: "Доступ в Telegram-клуб",
  product_access: "Доступ к продукту",
  entitlement: "Системное право доступа",
  email: "Доступ к домену / разделу",
};

const TARGET_TYPE_ICONS: Record<GrantTargetType, typeof Shield> = {
  club: Users,
  product_access: Package,
  entitlement: Shield,
  email: Zap,
};

const PURPOSE_LABELS: Record<RulePurpose, string> = {
  primary: "Основной доступ",
  bonus: "Бонус",
  additional: "Дополнительный",
  service: "Служебное",
};

const PURPOSE_ICONS: Record<RulePurpose, typeof Star> = {
  primary: Star,
  bonus: Gift,
  additional: Package,
  service: Settings2,
};

const RUNTIME_LABELS: Record<string, string> = {
  full: "Исполняется автоматически",
  partial: "Частичная поддержка",
  preview_only: "Только превью",
};

const LEGACY_STATUS_LABELS: Record<LegacyStatus, string> = {
  active_legacy_only: "Действует (старая настройка)",
  duplicated_by_rule: "Дублируется новым правилом",
  migrated_replaced: "Мигрировано и заменено",
  inactive_legacy: "Неактивно",
  fallback_effective: "Резерв (правило неактивно)",
};

const LEGACY_SOURCE_LABELS: Record<string, string> = {
  club: "клуб",
  email: "email-аккаунт",
};

const LEGACY_STATUS_COLORS: Record<LegacyStatus, string> = {
  active_legacy_only: "text-amber-600 border-amber-300 bg-amber-50/50",
  duplicated_by_rule: "text-blue-600 border-blue-300 bg-blue-50/50",
  migrated_replaced: "text-green-600 border-green-300 bg-green-50/50",
  inactive_legacy: "text-muted-foreground border-border",
  fallback_effective: "text-orange-600 border-orange-300 bg-orange-50/50",
};

// Duration presets
const DURATION_PRESETS = [
  { label: "7 дней", days: 7 },
  { label: "14 дней", days: 14 },
  { label: "1 месяц", days: 30 },
  { label: "2 месяца", days: 60 },
  { label: "3 месяца", days: 90 },
  { label: "6 месяцев", days: 180 },
  { label: "12 месяцев", days: 365 },
];

interface Props {
  productId: string;
  tariffs: Array<{ id: string; name: string }>;
}

export function ProductAccessRulesTab({ productId, tariffs }: Props) {
  const { rules, legacyMappings, isLoading, createRule, updateRule, deleteRule, toggleRule } = useAccessRules(productId);
  const { data: availableClubs = [] } = useAvailableClubs();
  const { data: availableProducts = [] } = useAvailableProducts();
  const { data: availableEntitlements = [] } = useAvailableEntitlements();
  const { data: tariffDurations = [] } = useTariffDurations(productId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AccessRule | null>(null);
  const [previewTariffId, setPreviewTariffId] = useState<string>("");
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");
  const [typeFilter, setTypeFilter] = useState<GrantTargetType | "all">("all");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [deletingRule, setDeletingRule] = useState<AccessRule | null>(null);
  const [isDeletePending, setIsDeletePending] = useState(false);

  const { data: effectiveGrants = [] } = useEffectiveGrants(productId, previewTariffId || undefined);

  // Form state — priority and duration_days stored as strings for natural editing
  const [form, setForm] = useState({
    scope: "product" as "product" | "tariff",
    tariff_id: "",
    grant_target_type: "club" as GrantTargetType,
    target_ref: "",
    target_label: "",
    is_active: true,
    priority: "",
    duration_mode: "tariff" as "tariff" | "manual",
    duration_days: "" as string,
    rule_purpose: "primary" as RulePurpose,
    notes: "",
  });

  // Filtered rules
  const filteredRules = useMemo(() => {
    let result = rules;
    if (filter === "active") result = result.filter((r) => r.is_active);
    if (filter === "inactive") result = result.filter((r) => !r.is_active);
    if (typeFilter !== "all") result = result.filter((r) => r.grant_target_type === typeFilter);
    return result;
  }, [rules, filter, typeFilter]);

  // Conflicts
  const conflicts = useMemo(() => {
    const seen = new Map<string, AccessRule[]>();
    rules.forEach((r) => {
      const key = `${r.grant_target_type}:${r.target_ref}`;
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key)!.push(r);
    });
    return Array.from(seen.entries())
      .filter(([, v]) => v.length > 1)
      .map(([key, items]) => ({ key, items }));
  }, [rules]);

  // Legacy-new overlaps
  const overlaps = useMemo(() => {
    return legacyMappings.filter((m) =>
      rules.some((r) => r.grant_target_type === m.grant_target_type && r.target_ref === m.target_ref)
    );
  }, [legacyMappings, rules]);

  // Get tariff default duration for preview
  const getDefaultDuration = (tariffId?: string) => {
    if (!tariffId) return null;
    return tariffDurations.find(t => t.id === tariffId)?.access_days ?? null;
  };

  // === Dialog handlers ===
  const openCreateDialog = () => {
    setEditing(null);
    setForm({
      scope: "product",
      tariff_id: tariffs[0]?.id || "",
      grant_target_type: "club",
      target_ref: "",
      target_label: "",
      is_active: true,
      priority: "",
      duration_mode: "tariff",
      duration_days: "",
      rule_purpose: "primary",
      notes: "",
    });
    setAdvancedOpen(false);
    setDialogOpen(true);
  };

  const openEditDialog = (rule: AccessRule) => {
    setEditing(rule);
    const purpose = getRulePurpose(rule);
    setForm({
      scope: rule.tariff_id ? "tariff" : "product",
      tariff_id: rule.tariff_id || tariffs[0]?.id || "",
      grant_target_type: rule.grant_target_type,
      target_ref: rule.target_ref,
      target_label: rule.target_label || "",
      is_active: rule.is_active,
      priority: rule.priority ? String(rule.priority) : "",
      duration_mode: rule.duration_days != null ? "manual" : "tariff",
      duration_days: rule.duration_days != null ? String(rule.duration_days) : "",
      rule_purpose: purpose,
      notes: rule.notes || "",
    });
    setAdvancedOpen(false);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.target_ref) {
      toast.error("Выберите цель выдачи");
      return;
    }

    const conditions: Record<string, unknown> = {};
    if (form.rule_purpose !== "primary") {
      conditions.rule_purpose = form.rule_purpose;
    }

    // Parse string fields to numbers on save
    const parsedPriority = form.priority.trim() === "" ? 0 : (parseInt(form.priority, 10) || 0);
    const parsedDuration = form.duration_mode === "manual"
      ? (form.duration_days.trim() === "" ? null : (parseInt(form.duration_days, 10) || null))
      : null;

    const payload: any = {
      product_id: form.scope === "product" ? productId : productId,
      tariff_id: form.scope === "tariff" ? form.tariff_id : null,
      grant_target_type: form.grant_target_type,
      target_ref: form.target_ref,
      target_label: form.target_label || null,
      is_active: form.is_active,
      priority: parsedPriority,
      duration_days: parsedDuration,
      notes: form.notes || null,
      conditions: Object.keys(conditions).length > 0 ? conditions : null,
    };

    if (editing) {
      await updateRule({ id: editing.id, ...payload });
    } else {
      await createRule(payload);
    }
    setDialogOpen(false);
  };

  // Auto-set target_label when selecting target
  const handleTargetRefChange = (ref: string) => {
    let label = ref;
    if (form.grant_target_type === "club") {
      const club = availableClubs.find((c) => c.id === ref);
      label = club ? `${club.club_name} (${getClubAccessLabel(club)})` : ref;
    } else if (form.grant_target_type === "product_access") {
      label = availableProducts.find((p) => p.id === ref)?.name || ref;
    } else if (form.grant_target_type === "entitlement") {
      label = ref;
    }
    setForm({ ...form, target_ref: ref, target_label: label });
  };

  // Format duration — pure number formatter, no business logic
  const formatDuration = (days: number | null) => {
    if (days == null) return null;
    if (days >= 365 && days % 365 === 0) return `${days / 365} г.`;
    if (days >= 30 && days % 30 === 0) return `${days / 30} мес.`;
    return `${days} дн.`;
  };

  // Context-aware duration display with business resolution
  const getDurationDisplay = (
    durationDays: number | null,
    durationSource: string,
    sourceType: string,
  ): string => {
    // 1. Explicit duration from rule
    if (durationDays != null && durationSource === "rule") {
      return `${formatDuration(durationDays)} (из правила)`;
    }
    // 2. Duration from tariff
    if (durationDays != null && durationSource === "tariff") {
      return `${formatDuration(durationDays)} (из тарифа)`;
    }
    // 3. Duration from legacy
    if (durationDays != null && durationSource === "legacy") {
      return `${formatDuration(durationDays)} (старая настройка)`;
    }
    // 4. Duration present but source unknown
    if (durationDays != null) {
      return formatDuration(durationDays)!;
    }
    // 5. No duration — distinguish unresolved vs truly unlimited
    if (sourceType === "rule" && durationSource === "unknown") {
      return "По сроку тарифа покупки";
    }
    if (sourceType === "rule") {
      return "По сроку тарифа покупки";
    }
    // Legacy with null duration — unknown at preview time
    if (sourceType === "legacy") {
      return "Срок не задан";
    }
    return "По сроку тарифа покупки";
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold">Правила доступа</h2>
          <p className="text-sm text-muted-foreground">
            Что получит покупатель при покупке этого продукта или тарифа
          </p>
        </div>
        <Button onClick={openCreateDialog} size="sm">
          <Plus className="h-4 w-4 mr-1.5" />
          Добавить правило
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="inline-flex p-0.5 rounded-full bg-muted/40 border border-border/20">
          {(["all", "active", "inactive"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium transition-all",
                filter === f ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f === "all" ? "Все" : f === "active" ? "Активные" : "Неактивные"}
            </button>
          ))}
        </div>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as any)}>
          <SelectTrigger className="w-[220px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все типы</SelectItem>
            {Object.entries(TARGET_TYPE_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Conflicts warning */}
      {conflicts.length > 0 && (
        <Card className="border-amber-200/50 bg-amber-50/30 dark:border-amber-800/50 dark:bg-amber-950/30">
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="text-sm font-medium">
                Обнаружены конфликты: одна цель назначена несколькими правилами
              </span>
            </div>
            <div className="mt-2 space-y-1">
              {conflicts.map(({ key, items }) => (
                <div key={key} className="text-xs text-amber-600 dark:text-amber-500">
                  {items[0].target_label || key}: {items.map((i) => (i.tariff?.name || "Продукт")).join(" + ")} — 
                  победит приоритет {Math.max(...items.map((i) => i.priority))}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Rules list */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Загрузка…</div>
      ) : filteredRules.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Shield className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground mb-1">Нет правил доступа</p>
            <p className="text-xs text-muted-foreground mb-4">
              {legacyMappings.length > 0
                ? `Найдено ${legacyMappings.length} старых привязок (см. ниже)`
                : "Добавьте правило, чтобы определить, что получит покупатель"}
            </p>
            <Button variant="outline" size="sm" onClick={openCreateDialog}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Создать первое правило
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredRules.map((rule) => {
            const Icon = TARGET_TYPE_ICONS[rule.grant_target_type] || Shield;
            const purpose = getRulePurpose(rule);
            const PurposeIcon = PURPOSE_ICONS[purpose];
            const hasConflict = conflicts.some((c) => c.items.some((i) => i.id === rule.id));
            const hasOverlap = overlaps.some(
              (o) => o.grant_target_type === rule.grant_target_type && o.target_ref === rule.target_ref
            );
            const defaultDuration = rule.tariff_id ? getDefaultDuration(rule.tariff_id) : null;
            const effectiveDuration = rule.duration_days ?? defaultDuration;

            return (
              <Card
                key={rule.id}
                className={cn(
                  "transition-colors",
                  !rule.is_active && "opacity-60",
                  hasConflict && "border-amber-300/50"
                )}
              >
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className={cn("p-1.5 rounded-lg", rule.is_active ? "bg-primary/10" : "bg-muted")}>
                      <Icon className="h-4 w-4 text-primary" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{rule.target_label || rule.target_ref}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {TARGET_TYPE_LABELS[rule.grant_target_type]}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {rule.tariff_id ? `Тариф: ${rule.tariff?.name || "—"}` : "Весь продукт"}
                        </Badge>
                        {purpose !== "primary" && (
                          <Badge variant="outline" className="text-[10px] text-purple-600 border-purple-300">
                            <PurposeIcon className="h-3 w-3 mr-0.5" />
                            {PURPOSE_LABELS[purpose]}
                          </Badge>
                        )}
                        {hasConflict && (
                          <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">
                            <AlertTriangle className="h-3 w-3 mr-0.5" />
                            Конфликт
                          </Badge>
                        )}
                        {hasOverlap && (
                          <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-300">
                            Дублирует старую настройку
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {rule.duration_days != null
                            ? `${formatDuration(rule.duration_days)} (из правила)`
                            : effectiveDuration != null
                              ? `${formatDuration(effectiveDuration)} (из тарифа)`
                              : "По сроку тарифа покупки"
                          }
                        </span>
                        {rule.notes && (
                          <>
                            <span>·</span>
                            <span className="truncate max-w-[200px]">{rule.notes}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <Switch
                        checked={rule.is_active}
                        onCheckedChange={(checked) => toggleRule({ id: rule.id, is_active: checked })}
                        className="scale-75"
                      />
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditDialog(rule)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => setDeletingRule(rule)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* === Preview / Explain === */}
      <Card>
        <CardHeader className="py-3 px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm">Что получит покупатель</CardTitle>
            </div>
            <Select value={previewTariffId || "__all__"} onValueChange={(v) => setPreviewTariffId(v === "__all__" ? "" : v)}>
              <SelectTrigger className="w-[200px] h-8 text-xs">
                <SelectValue placeholder="Все тарифы" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Все тарифы (уровень продукта)</SelectItem>
                {tariffs.map((t) => {
                  const dur = tariffDurations.find(td => td.id === t.id);
                  return (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} {dur?.access_days ? `(${dur.access_days} дн.)` : ""}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {effectiveGrants.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">
              Нет активных доступов для выбранного тарифа
            </p>
          ) : (
            <div className="space-y-2">
              {/* Active grants */}
              {effectiveGrants.filter(g => g.effective_status === "active").map((g, idx) => (
                <EffectiveGrantCard key={`active-${idx}`} grant={g} getDurationDisplay={getDurationDisplay} />
              ))}
              {/* Overridden grants (collapsed) */}
              {effectiveGrants.filter(g => g.effective_status === "overridden").length > 0 && (
                <Collapsible>
                  <CollapsibleTrigger asChild>
                    <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mt-2">
                      <ChevronDown className="h-3 w-3" />
                      Перекрытые правила ({effectiveGrants.filter(g => g.effective_status === "overridden").length})
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-1 space-y-1">
                    {effectiveGrants.filter(g => g.effective_status === "overridden").map((g, idx) => (
                      <EffectiveGrantCard key={`over-${idx}`} grant={g} getDurationDisplay={getDurationDisplay} />
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* === Legacy / Fallback panel === */}
      {legacyMappings.length > 0 && (
        <Card>
          <CardHeader className="py-3 px-4">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-500" />
              <CardTitle className="text-sm">Действующие старые настройки</CardTitle>
              <Badge variant="outline" className="text-[10px]">{legacyMappings.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {legacyMappings.map((m) => {
              const status = getLegacyStatus(m, rules);
              return (
                <div key={m.id} className={cn("flex items-center gap-3 p-2.5 rounded-lg border", LEGACY_STATUS_COLORS[status])}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{m.target_label}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {TARGET_TYPE_LABELS[m.grant_target_type]}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
                      <span>Источник: {LEGACY_SOURCE_LABELS[m.source.replace("product_", "").replace("_mappings", "")] ?? m.source}</span>
                      {m.duration_days != null && (
                        <>
                          <span>·</span>
                          <span>{formatDuration(m.duration_days)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge variant="outline" className={cn("text-[10px]", LEGACY_STATUS_COLORS[status])}>
                      {LEGACY_STATUS_LABELS[status]}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {m.is_active ? "Активен" : "Неактивен"}
                    </span>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* === Create/Edit Dialog === */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Редактировать правило" : "Новое правило доступа"}</DialogTitle>
            <DialogDescription>
              Определите, что получит покупатель при покупке
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* === Section 1: Где действует === */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">1</span>
                Где действует
              </div>
              <Select value={form.scope} onValueChange={(v: "product" | "tariff") => setForm({ ...form, scope: v })}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="product">Весь продукт</SelectItem>
                  <SelectItem value="tariff">Конкретный тариф</SelectItem>
                </SelectContent>
              </Select>

              {form.scope === "tariff" && (
                <Select value={form.tariff_id} onValueChange={(v) => setForm({ ...form, tariff_id: v })}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Выберите тариф" />
                  </SelectTrigger>
                  <SelectContent>
                    {tariffs.map((t) => {
                      const dur = tariffDurations.find(td => td.id === t.id);
                      return (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name} {dur?.access_days ? `(${dur.access_days} дн.)` : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              )}
            </div>

            <Separator />

            {/* === Section 2: Что выдаём === */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">2</span>
                Что выдаём
              </div>
              <Select
                value={form.grant_target_type}
                onValueChange={(v: GrantTargetType) => setForm({ ...form, grant_target_type: v, target_ref: "", target_label: "" })}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(TARGET_TYPE_LABELS) as [GrantTargetType, string][])
                    .filter(([k]) => k !== "entitlement")
                    .map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  <SelectItem value="entitlement">
                    <span className="flex items-center gap-1.5">
                      {TARGET_TYPE_LABELS.entitlement}
                      <Badge variant="outline" className="text-[9px] px-1 py-0">служебный</Badge>
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>

              {/* Runtime support indicator */}
              {form.grant_target_type === "email" && (
                <div className="flex items-center gap-1.5 text-[11px] text-amber-600 bg-amber-50/50 dark:bg-amber-950/30 rounded-md px-2.5 py-1.5">
                  <Info className="h-3.5 w-3.5 shrink-0" />
                  Частичная поддержка: справочник доменов ещё не создан. Можно выбрать только из существующих записей.
                </div>
              )}
            </div>

            <Separator />

            {/* === Section 3: Куда выдаём (target selector) === */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">3</span>
                Куда выдаём
              </div>

              {form.grant_target_type === "club" && (
                <div className="space-y-2">
                  <Select value={form.target_ref} onValueChange={handleTargetRefChange}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Выберите Telegram-клуб" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableClubs.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <span className="flex items-center gap-2">
                            {c.club_name}
                            <Badge variant="outline" className="text-[9px] px-1 py-0">{getClubAccessLabel(c)}</Badge>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {form.grant_target_type === "product_access" && (
                <Select value={form.target_ref} onValueChange={handleTargetRefChange}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Выберите продукт" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableProducts.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {form.grant_target_type === "entitlement" && (
                <div className="space-y-2">
                  <Select value={form.target_ref} onValueChange={(v) => setForm({ ...form, target_ref: v, target_label: v })}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Выберите системное право" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableEntitlements.map((e) => (
                        <SelectItem key={e.product_code} value={e.product_code}>{e.product_code}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Служебный режим: выбор из справочника entitlements. Используется для системных прав.
                  </p>
                </div>
              )}

              {form.grant_target_type === "email" && (
                <div className="space-y-2">
                  <Input
                    value={form.target_ref}
                    onChange={(e) => setForm({ ...form, target_ref: e.target.value, target_label: e.target.value })}
                    placeholder="Домен или идентификатор раздела"
                    className="h-9"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Справочник доменов/разделов ещё не создан. Введите идентификатор вручную.
                  </p>
                </div>
              )}

              {/* Label override */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Отображаемое название (необязательно)</Label>
                <Input
                  value={form.target_label}
                  onChange={(e) => setForm({ ...form, target_label: e.target.value })}
                  placeholder="Автоматически из выбранной цели"
                  className="h-9"
                />
              </div>
            </div>

            <Separator />

            {/* === Section 4: Назначение === */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">4</span>
                Назначение
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(Object.entries(PURPOSE_LABELS) as [RulePurpose, string][]).map(([k, v]) => {
                  const PIcon = PURPOSE_ICONS[k];
                  return (
                    <button
                      key={k}
                      onClick={() => setForm({ ...form, rule_purpose: k })}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all",
                        form.rule_purpose === k
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/20"
                      )}
                    >
                      <PIcon className="h-3.5 w-3.5" />
                      {v}
                    </button>
                  );
                })}
              </div>
            </div>

            <Separator />

            {/* === Section 5: Срок === */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">5</span>
                Срок доступа
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setForm({ ...form, duration_mode: "tariff", duration_days: null })}
                  className={cn(
                    "flex-1 px-3 py-2 rounded-lg border text-sm transition-all",
                    form.duration_mode === "tariff"
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  По умолчанию из тарифа
                </button>
                <button
                  onClick={() => setForm({ ...form, duration_mode: "manual" })}
                  className={cn(
                    "flex-1 px-3 py-2 rounded-lg border text-sm transition-all",
                    form.duration_mode === "manual"
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  Задать вручную
                </button>
              </div>

              {form.duration_mode === "tariff" && (
                <div className="text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
                  {form.scope === "tariff" && form.tariff_id ? (
                    <>
                      Срок из тарифа: <strong>{getDefaultDuration(form.tariff_id) ?? "не задан"}</strong>
                      {getDefaultDuration(form.tariff_id) && ` дн. (${formatDuration(getDefaultDuration(form.tariff_id))})`}
                    </>
                  ) : (
                    "Будет использован срок из тарифа покупки"
                  )}
                </div>
              )}

              {form.duration_mode === "manual" && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {DURATION_PRESETS.map((p) => (
                      <button
                        key={p.days}
                        onClick={() => setForm({ ...form, duration_days: String(p.days) })}
                        className={cn(
                          "px-2.5 py-1 rounded-md border text-xs transition-all",
                          form.duration_days !== "" && Number(form.duration_days) === p.days
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={form.duration_days}
                      onChange={(e) => setForm({ ...form, duration_days: e.target.value.replace(/\D/g, "") })}
                      onBlur={() => {
                        const trimmed = form.duration_days.trim();
                        if (trimmed === "") return; // allow empty
                        const n = parseInt(trimmed, 10);
                        if (isNaN(n) || n < 1) setForm(f => ({ ...f, duration_days: "" }));
                      }}
                      placeholder="Кол-во дней"
                      className="h-9 w-[120px]"
                    />
                    <span className="text-xs text-muted-foreground">дней</span>
                  </div>
                </div>
              )}
            </div>

            {/* === Section 6: Дополнительно (advanced) === */}
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger asChild>
                <button className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
                  <Settings2 className="h-3.5 w-3.5" />
                  <span>Дополнительные настройки</span>
                  <ChevronDown className={cn("h-3 w-3 transition-transform", advancedOpen && "rotate-180")} />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3 space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Приоритет (выше = важнее)</Label>
                  <Input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: e.target.value.replace(/\D/g, "") })}
                    onBlur={() => {
                      if (form.priority.trim() === "") setForm(f => ({ ...f, priority: "0" }));
                    }}
                    className="h-9 w-[100px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Заметка для админа</Label>
                  <Textarea
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    rows={2}
                    className="text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
                  <Label className="text-xs">{form.is_active ? "Активно" : "Неактивно"}</Label>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Отмена</Button>
            <Button onClick={handleSave}>{editing ? "Сохранить" : "Создать"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* === Delete Confirmation Dialog === */}
      <AlertDialog open={!!deletingRule} onOpenChange={(open) => { if (!open) setDeletingRule(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить правило?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingRule && (
                <>
                  Будет удалено правило: <strong>{deletingRule.target_label || deletingRule.target_ref}</strong>
                  {" "}({TARGET_TYPE_LABELS[deletingRule.grant_target_type]}).
                  <br />
                  Это действие необратимо.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletePending}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeletePending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async (e) => {
                e.preventDefault();
                if (!deletingRule || isDeletePending) return;
                setIsDeletePending(true);
                try {
                  await deleteRule(deletingRule.id);
                  setDeletingRule(null);
                } catch {
                  // toast already handled by mutation
                } finally {
                  setIsDeletePending(false);
                }
              }}
            >
              {isDeletePending ? "Удаление…" : "Удалить правило"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// === Effective Grant Card Component ===

function EffectiveGrantCard({ grant: g, getDurationDisplay }: { grant: EffectiveGrant; getDurationDisplay: (d: number | null, ds: string, st: string) => string }) {
  const Icon = TARGET_TYPE_ICONS[g.grant_target_type] || Shield;
  const isOverridden = g.effective_status === "overridden";

  return (
    <div className={cn(
      "flex items-center gap-3 p-2.5 rounded-lg border",
      isOverridden ? "bg-muted/20 opacity-60 border-dashed" : "bg-muted/30"
    )}>
      <div className={cn("p-1 rounded-md", isOverridden ? "bg-muted" : "bg-primary/10")}>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("text-sm font-medium", isOverridden && "line-through")}>{g.target_label}</span>
          {g.club_access_label && (
            <Badge variant="outline" className="text-[9px]">{g.club_access_label}</Badge>
          )}
          {g.rule_purpose !== "primary" && (
            <Badge variant="outline" className="text-[9px] text-purple-600 border-purple-300">
              {PURPOSE_LABELS[g.rule_purpose]}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <Badge
            variant="outline"
            className={cn(
              "text-[10px]",
              g.source_type === "rule" ? "text-primary border-primary/30" : "text-amber-600 border-amber-300"
            )}
          >
            {g.source_label}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {getDurationDisplay(g.duration_days, g.duration_source, g.source_type)}
          </Badge>
          {g.runtime_support !== "full" && (
            <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">
              {RUNTIME_LABELS[g.runtime_support]}
            </Badge>
          )}
          {isOverridden && g.overridden_by && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              Перекрыто: {g.overridden_by}
            </Badge>
          )}
          {g.migrated_status === "not_migrated" && g.source_type === "legacy" && (
            <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">
              Не мигрировано
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}
