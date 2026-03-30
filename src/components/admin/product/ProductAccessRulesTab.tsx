import { useState, useMemo } from "react";
import { useAccessRules, useEffectiveGrants, type AccessRule, type GrantTargetType } from "@/hooks/useAccessRules";
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
import { Plus, Trash2, Pencil, ChevronDown, Shield, AlertTriangle, Eye, ArrowRight, Zap, Mail, Users, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { getStatusBadgeClass } from "@/utils/badgeUtils";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

const TARGET_TYPE_LABELS: Record<GrantTargetType, string> = {
  entitlement: "Entitlement",
  club: "Telegram клуб",
  email: "Email / домен",
  product_access: "Доступ к продукту",
};

const TARGET_TYPE_ICONS: Record<GrantTargetType, typeof Shield> = {
  entitlement: Shield,
  club: Users,
  email: Mail,
  product_access: Package,
};

const SCOPE_LABELS = {
  product: "Продукт",
  tariff: "Тариф",
};

interface Props {
  productId: string;
  tariffs: Array<{ id: string; name: string }>;
}

export function ProductAccessRulesTab({ productId, tariffs }: Props) {
  const { rules, legacyMappings, isLoading, createRule, updateRule, deleteRule, toggleRule } = useAccessRules(productId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AccessRule | null>(null);
  const [previewTariffId, setPreviewTariffId] = useState<string>("");
  const [previewOpen, setPreviewOpen] = useState(true);
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");
  const [typeFilter, setTypeFilter] = useState<GrantTargetType | "all">("all");

  const { data: effectiveGrants = [] } = useEffectiveGrants(productId, previewTariffId || undefined);

  // Available targets for selectors
  const { data: availableClubs = [] } = useQuery({
    queryKey: ["available-clubs"],
    queryFn: async () => {
      const { data } = await supabase.from("telegram_clubs").select("id, club_name").eq("is_active", true).order("club_name");
      return data || [];
    },
  });

  const { data: availableEmails = [] } = useQuery({
    queryKey: ["available-email-accounts"],
    queryFn: async () => {
      const { data } = await supabase.from("email_accounts").select("id, email").order("email");
      return data || [];
    },
  });

  // Form state
  const [form, setForm] = useState({
    scope: "product" as "product" | "tariff",
    tariff_id: "",
    grant_target_type: "entitlement" as GrantTargetType,
    target_ref: "",
    target_label: "",
    is_active: true,
    priority: 0,
    duration_days: null as number | null,
    notes: "",
  });

  const filteredRules = useMemo(() => {
    let result = rules;
    if (filter === "active") result = result.filter((r) => r.is_active);
    if (filter === "inactive") result = result.filter((r) => !r.is_active);
    if (typeFilter !== "all") result = result.filter((r) => r.grant_target_type === typeFilter);
    return result;
  }, [rules, filter, typeFilter]);

  // Conflict detection
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

  const openCreateDialog = () => {
    setEditing(null);
    setForm({
      scope: "product",
      tariff_id: tariffs[0]?.id || "",
      grant_target_type: "entitlement",
      target_ref: "",
      target_label: "",
      is_active: true,
      priority: 0,
      duration_days: null,
      notes: "",
    });
    setDialogOpen(true);
  };

  const openEditDialog = (rule: AccessRule) => {
    setEditing(rule);
    setForm({
      scope: rule.tariff_id ? "tariff" : "product",
      tariff_id: rule.tariff_id || tariffs[0]?.id || "",
      grant_target_type: rule.grant_target_type,
      target_ref: rule.target_ref,
      target_label: rule.target_label || "",
      is_active: rule.is_active,
      priority: rule.priority,
      duration_days: rule.duration_days,
      notes: rule.notes || "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.target_ref) {
      toast.error("Выберите цель выдачи");
      return;
    }

    const payload: any = {
      product_id: form.scope === "product" ? productId : null,
      tariff_id: form.scope === "tariff" ? form.tariff_id : null,
      grant_target_type: form.grant_target_type,
      target_ref: form.target_ref,
      target_label: form.target_label || null,
      is_active: form.is_active,
      priority: form.priority,
      duration_days: form.duration_days,
      notes: form.notes || null,
    };

    // If scope is tariff, also set product_id for easier querying
    if (form.scope === "tariff") {
      payload.product_id = productId;
    }

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
      label = availableClubs.find((c) => c.id === ref)?.club_name || ref;
    } else if (form.grant_target_type === "email") {
      label = availableEmails.find((e) => e.id === ref)?.email || ref;
    }
    setForm({ ...form, target_ref: ref, target_label: label });
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
          <SelectTrigger className="w-[180px] h-8 text-xs">
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
                {conflicts.length} конфликт{conflicts.length > 1 ? "а" : ""}: одна цель назначена несколькими правилами
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
                ? `Найдено ${legacyMappings.length} legacy-привязок (см. ниже)`
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
            const hasConflict = conflicts.some((c) => c.items.some((i) => i.id === rule.id));
            const hasOverlap = overlaps.some(
              (o) => o.grant_target_type === rule.grant_target_type && o.target_ref === rule.target_ref
            );

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
                        <Badge variant="outline" className={cn("text-[10px]", getStatusBadgeClass(rule.is_active ? "active" : "inactive"))}>
                          {TARGET_TYPE_LABELS[rule.grant_target_type]}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {rule.tariff_id ? `Тариф: ${rule.tariff?.name || "—"}` : "Продукт"}
                        </Badge>
                        {hasConflict && (
                          <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">
                            <AlertTriangle className="h-3 w-3 mr-0.5" />
                            Конфликт
                          </Badge>
                        )}
                        {hasOverlap && (
                          <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-300">
                            + legacy
                          </Badge>
                        )}
                      </div>
                      {rule.notes && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{rule.notes}</p>
                      )}
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
                        onClick={() => deleteRule(rule.id)}
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

      {/* Preview / Explain */}
      <Collapsible open={previewOpen} onOpenChange={setPreviewOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full justify-between px-3 h-10">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4" />
              <span className="text-sm font-medium">Превью: что получит покупатель</span>
            </div>
            <ChevronDown className={cn("h-4 w-4 transition-transform", previewOpen && "rotate-180")} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Card className="mt-2">
            <CardHeader className="py-3 px-4">
              <div className="flex items-center gap-3">
                <Label className="text-xs">Тариф:</Label>
                <Select value={previewTariffId} onValueChange={setPreviewTariffId}>
                  <SelectTrigger className="w-[200px] h-8 text-xs">
                    <SelectValue placeholder="Все тарифы" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Все тарифы (product-level)</SelectItem>
                    {tariffs.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {effectiveGrants.length === 0 ? (
                <p className="text-xs text-muted-foreground">Нет активных grants для выбранного тарифа</p>
              ) : (
                <div className="space-y-2">
                  {effectiveGrants.map((g, idx) => {
                    const Icon = TARGET_TYPE_ICONS[g.grant_target_type] || Shield;
                    return (
                      <div key={idx} className="flex items-center gap-3 p-2 rounded-lg bg-muted/30">
                        <Icon className="h-4 w-4 text-primary shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium">{g.target_label}</span>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <Badge variant="outline" className="text-[10px]">
                              {TARGET_TYPE_LABELS[g.grant_target_type]}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px]",
                                g.source === "rule" ? "text-primary border-primary/30" : "text-muted-foreground"
                              )}
                            >
                              {g.source === "rule" ? "Правило" : "Legacy"}
                            </Badge>
                            <Badge variant="outline" className="text-[10px]">
                              {SCOPE_LABELS[g.scope]}
                            </Badge>
                          </div>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-xs text-muted-foreground">Покупатель</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>

      {/* Legacy mappings */}
      {legacyMappings.length > 0 && (
        <Collapsible open={legacyOpen} onOpenChange={setLegacyOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between px-3 h-10">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Legacy привязки ({legacyMappings.length})</span>
              </div>
              <ChevronDown className={cn("h-4 w-4 transition-transform", legacyOpen && "rotate-180")} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 space-y-2">
              {legacyMappings.map((m) => (
                <Card key={m.id} className={cn("transition-colors", m.migrated && "opacity-50")}>
                  <CardContent className="py-2.5 px-4">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{m.target_label}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {TARGET_TYPE_LABELS[m.grant_target_type]}
                          </Badge>
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">
                            legacy: {m.source.replace("product_", "").replace("_mappings", "")}
                          </Badge>
                          {m.migrated && (
                            <Badge variant="outline" className="text-[10px] text-green-600 border-green-300">
                              Мигрировано
                            </Badge>
                          )}
                        </div>
                      </div>
                      <Badge variant="outline" className={cn("text-[10px]", getStatusBadgeClass(m.is_active ? "active" : "inactive"))}>
                        {m.is_active ? "Активен" : "Неактивен"}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Редактировать правило" : "Новое правило доступа"}</DialogTitle>
            <DialogDescription>
              Определите, что получит покупатель при покупке
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Scope */}
            <div className="space-y-2">
              <Label className="text-xs">Область действия</Label>
              <Select value={form.scope} onValueChange={(v: "product" | "tariff") => setForm({ ...form, scope: v })}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="product">Весь продукт</SelectItem>
                  <SelectItem value="tariff">Конкретный тариф</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.scope === "tariff" && (
              <div className="space-y-2">
                <Label className="text-xs">Тариф</Label>
                <Select value={form.tariff_id} onValueChange={(v) => setForm({ ...form, tariff_id: v })}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Выберите тариф" />
                  </SelectTrigger>
                  <SelectContent>
                    {tariffs.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <Separator />

            {/* Target type */}
            <div className="space-y-2">
              <Label className="text-xs">Тип выдачи</Label>
              <Select
                value={form.grant_target_type}
                onValueChange={(v: GrantTargetType) => setForm({ ...form, grant_target_type: v, target_ref: "", target_label: "" })}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TARGET_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Target ref */}
            <div className="space-y-2">
              <Label className="text-xs">Цель</Label>
              {form.grant_target_type === "club" ? (
                <Select value={form.target_ref} onValueChange={handleTargetRefChange}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Выберите клуб" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableClubs.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.club_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : form.grant_target_type === "email" ? (
                <Select value={form.target_ref} onValueChange={handleTargetRefChange}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Выберите email" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableEmails.map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={form.target_ref}
                  onChange={(e) => setForm({ ...form, target_ref: e.target.value, target_label: e.target.value })}
                  placeholder={form.grant_target_type === "entitlement" ? "product_code" : "product_id или slug"}
                  className="h-9"
                />
              )}
            </div>

            {/* Label override */}
            <div className="space-y-2">
              <Label className="text-xs">Название (для UI)</Label>
              <Input
                value={form.target_label}
                onChange={(e) => setForm({ ...form, target_label: e.target.value })}
                placeholder="Отображаемое название"
                className="h-9"
              />
            </div>

            {/* Duration override */}
            <div className="space-y-2">
              <Label className="text-xs">Длительность (дней, пусто = из тарифа)</Label>
              <Input
                type="number"
                min={1}
                value={form.duration_days ?? ""}
                onChange={(e) => setForm({ ...form, duration_days: e.target.value ? parseInt(e.target.value) : null })}
                placeholder="По умолчанию из тарифа"
                className="h-9"
              />
            </div>

            {/* Priority */}
            <div className="space-y-2">
              <Label className="text-xs">Приоритет (выше = важнее)</Label>
              <Input
                type="number"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })}
                className="h-9"
              />
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label className="text-xs">Заметка</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                className="text-sm"
              />
            </div>

            {/* Active toggle */}
            <div className="flex items-center gap-2">
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
              <Label className="text-xs">{form.is_active ? "Активно" : "Неактивно"}</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Отмена</Button>
            <Button onClick={handleSave}>{editing ? "Сохранить" : "Создать"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
