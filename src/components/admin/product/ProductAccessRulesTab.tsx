import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { ProductLinkedTrainingsBlock } from "./ProductLinkedTrainingsBlock";
import { RetroApplyPanel } from "./RetroApplyPanel";
import { TrainingContentTreePicker, normalizeTrainingContentPayload } from "./TrainingContentTreePicker";
import {
  useAccessRules, useEffectiveGrants,
  type AccessRule, type GrantTargetType, type RulePurpose,
  type EffectiveGrant, type LegacyMapping,
  getRulePurpose, getLegacyStatus, type LegacyStatus,
  getTrainingContentMeta,
} from "@/hooks/useAccessRules";
import {
  useAvailableClubs, useAvailableProducts, useAvailableEntitlements,
  useTariffDurations, getClubAccessLabel, useAvailableSections,
} from "@/hooks/useAccessRuleSelectors";
import { useTrainingContentTree, type TreeModule, type TreeLesson } from "@/hooks/useTrainingContentRules";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import {
  Plus, Trash2, Pencil, ChevronDown, Shield, AlertTriangle, Eye,
  Users, Package, Zap, Clock, Star, Gift, Settings2, Info, X, Search, BookOpen, Layout
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";

// === UI Labels & Config ===

const TARGET_TYPE_LABELS: Record<GrantTargetType, string> = {
  club: "Доступ в Telegram-клуб",
  product_access: "Доступ к продукту",
  entitlement: "Системное право доступа",
  email: "Доступ к домену / разделу",
  training_content: "Доступ к контенту тренинга",
  section_access: "Доступ к разделу платформы",
};

const TARGET_TYPE_ICONS: Record<GrantTargetType, typeof Shield> = {
  club: Users,
  product_access: Package,
  entitlement: Shield,
  email: Zap,
  training_content: BookOpen,
  section_access: Layout,
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

// === Multi-select product checkbox component ===
function ProductCheckboxList({
  products,
  selected,
  onChange,
  placeholder = "Поиск продукта…",
}: {
  products: Array<{ id: string; name: string; code: string }>;
  selected: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
}) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    if (!search.trim()) return products;
    const q = search.toLowerCase();
    return products.filter(p => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q));
  }, [products, search]);

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  };

  return (
    <div className="space-y-2">
      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="max-h-[80px] overflow-y-auto px-1">
          <div className="flex flex-wrap gap-1">
            {selected.map(id => {
              const p = products.find(x => x.id === id);
              return (
                <Badge key={id} variant="secondary" className="text-[11px] gap-1 pr-1">
                  {p?.name || id}
                  <button onClick={() => toggle(id)} className="ml-0.5 hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              );
            })}
          </div>
        </div>
      )}
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={placeholder}
          className="h-8 text-xs pl-7"
        />
      </div>
      {/* Counter */}
      <div className="text-[10px] text-muted-foreground">
        Выбрано: {selected.length} из {products.length}
      </div>
      {/* Checkbox list — plain div with overflow instead of Radix ScrollArea */}
      <div className="max-h-[200px] overflow-y-auto border rounded-md bg-background">
        <div className="p-2 space-y-0.5">
          {filtered.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-3">Ничего не найдено</div>
          ) : (
            filtered.map(p => (
              <label
                key={p.id}
                className={cn(
                  "flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-xs",
                  "hover:bg-muted/50 transition-colors leading-normal",
                  selected.includes(p.id) && "bg-primary/5"
                )}
              >
                <Checkbox
                  checked={selected.includes(p.id)}
                  onCheckedChange={() => toggle(p.id)}
                />
                <span className="flex-1 min-w-0 truncate">{p.name}</span>
              </label>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// === Expandable product list for rule cards ===
function ProductListBadge({
  productIds,
  products,
  prefix,
  className,
}: {
  productIds: string[];
  products: Array<{ id: string; name: string }>;
  prefix: string;
  className?: string;
}) {
  const names = productIds.map(id => products.find(p => p.id === id)?.name || id);
  const [expanded, setExpanded] = useState(false);

  if (productIds.length === 0) return null;
  if (productIds.length === 1) {
    return (
      <Badge variant="outline" className={cn("text-[10px]", className)}>
        {prefix} {names[0]}
      </Badge>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={cn("text-[10px] cursor-pointer", className)}
            onClick={() => setExpanded(!expanded)}
          >
            {prefix} {productIds.length} продуктов
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[300px]">
          <div className="space-y-0.5 text-xs">
            {names.map((n, i) => <div key={i}>• {n}</div>)}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}


type AccessRulesAction =
  | { type: "create_training_content"; targetRef?: string }
  | { type: "edit_rule"; ruleId: string };

interface Props {
  productId: string;
  tariffs: Array<{ id: string; name: string }>;
  initialAction?: AccessRulesAction;
}

export function ProductAccessRulesTab({ productId, tariffs, initialAction }: Props) {
  const { rules, legacyMappings, isLoading, createRule, updateRule, deleteRule, toggleRule } = useAccessRules(productId);
  const { data: availableClubs = [] } = useAvailableClubs();
  const { data: availableProducts = [] } = useAvailableProducts();
  const { data: availableEntitlements = [] } = useAvailableEntitlements();
  const { data: tariffDurations = [] } = useTariffDurations(productId);
  const { data: availableSections = [] } = useAvailableSections();

  // Root trainings for this product (for training_content selector)
  const { data: rootTrainings = [] } = useQuery({
    queryKey: ["root-trainings-for-product", productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("training_modules")
        .select("id, title, public_id, is_active, sort_order")
        .eq("product_id", productId)
        .is("parent_module_id", null)
        .order("is_active", { ascending: false })
        .order("sort_order");
      if (error) throw error;
      return data || [];
    },
    enabled: !!productId,
  });

  // State for external (use-via-rule) training hydration
  const [useViaRuleTraining, setUseViaRuleTraining] = useState<{ id: string; title: string } | null>(null);

  // Fetch external training by id when target_ref is set but not found in rootTrainings
  const externalTrainingId = (() => {
    // Only fetch if we have a target_ref for training_content that's not in rootTrainings
    const ref = useViaRuleTraining?.id;
    if (!ref) return undefined;
    if (rootTrainings.some(t => t.id === ref)) return undefined;
    return ref;
  })();
  const { data: externalTraining } = useQuery({
    queryKey: ["external-training-by-id", externalTrainingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("training_modules")
        .select("id, title, public_id, is_active, sort_order")
        .eq("id", externalTrainingId!)
        .is("parent_module_id", null)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!externalTrainingId,
  });

  // Merged training options: rootTrainings + external training if applicable
  const trainingOptions = useMemo(() => {
    const list = [...rootTrainings];
    if (externalTraining && !list.some(t => t.id === externalTraining.id)) {
      list.push(externalTraining);
    }
    return list;
  }, [rootTrainings, externalTraining]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AccessRule | null>(null);
  const [previewTariffId, setPreviewTariffId] = useState<string>("");
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");
  const [typeFilter, setTypeFilter] = useState<GrantTargetType | "all">("all");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [deletingRule, setDeletingRule] = useState<AccessRule | null>(null);
  const [isDeletePending, setIsDeletePending] = useState(false);

  // Canonical helper: open create-dialog pre-filled for training_content
  const openCreateTrainingContentRule = useCallback((targetRef: string, targetLabel: string) => {
    setUseViaRuleTraining({ id: targetRef, title: targetLabel });
    setEditing(null);
    setForm({
      scope: "product",
      tariff_id: "",
      grant_target_type: "training_content" as GrantTargetType,
      target_ref: targetRef,
      target_label: targetLabel,
      is_active: true,
      priority: "",
      duration_mode: "tariff",
      duration_days: "",
      rule_purpose: "primary" as RulePurpose,
      notes: "",
      target_product_ids: [],
      has_condition: false,
      condition_use_same_list: true,
      condition_required_product_ids: [],
      tc_access_mode: "full",
      tc_allowed_module_ids: [],
      tc_allowed_lesson_ids: [],
      tc_auto_include_new_modules: false,
      match_purchase_month: false,
    });
    setAdvancedOpen(false);
    setDialogOpen(true);
  }, []);

  // Handle external action (create/edit from ProductAccessInfoBlock)
  const initialActionHandled = useRef(false);
  useEffect(() => {
    if (!initialAction || initialActionHandled.current) return;
    initialActionHandled.current = true;

    if (initialAction.type === "create_training_content") {
      openCreateTrainingContentRule(initialAction.targetRef || "", "");
    } else if (initialAction.type === "edit_rule") {
      const rule = rules.find(r => r.id === initialAction.ruleId);
      if (rule) {
        openEditDialog(rule);
      }
    }
  }, [initialAction, rules, tariffs]);

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
    // Multi-product target (for product_access)
    target_product_ids: [] as string[],
    // Conditional rule fields
    has_condition: false,
    condition_use_same_list: true,
    condition_required_product_ids: [] as string[],
    // training_content fields
    tc_access_mode: "full" as "full" | "partial",
    tc_allowed_module_ids: [] as string[],
    tc_allowed_lesson_ids: [] as string[],
    tc_auto_include_new_modules: false,
    match_purchase_month: false,
  });

  // Confirm-dialog для перевода existing partial → full
  const [confirmFullSwitch, setConfirmFullSwitch] = useState(false);

  // Tree picker for training_content
  const { data: trainingTree } = useTrainingContentTree(
    form.grant_target_type === "training_content" ? form.target_ref : undefined
  );

  // Orphan modules: для partial — папки в дереве, которых нет в allowed_module_ids
  const orphanModules = useMemo(() => {
    if (form.grant_target_type !== "training_content") return [];
    if (form.tc_access_mode !== "partial") return [];
    if (!trainingTree?.children?.length) return [];
    const allowed = new Set(form.tc_allowed_module_ids);
    return trainingTree.children.filter((m: TreeModule) => !allowed.has(m.id));
  }, [form.grant_target_type, form.tc_access_mode, form.tc_allowed_module_ids, trainingTree]);

  // Filtered rules
  const filteredRules = useMemo(() => {
    let result = rules;
    if (filter === "active") result = result.filter((r) => r.is_active);
    if (filter === "inactive") result = result.filter((r) => !r.is_active);
    if (typeFilter !== "all") result = result.filter((r) => r.grant_target_type === typeFilter);
    return result;
  }, [rules, filter, typeFilter]);

  // Conflicts — classified into categories
  const conflicts = useMemo(() => {
    const seen = new Map<string, AccessRule[]>();
    rules.forEach((r) => {
      const key = `${r.grant_target_type}:${r.target_ref}`;
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key)!.push(r);
    });

    type ConflictType = 'valid_parallel_rule' | 'duplicate_rule' | 'ambiguous_overlap' | 'shadowed_rule';
    interface ClassifiedConflict {
      key: string;
      items: AccessRule[];
      type: ConflictType;
      label: string;
    }

    const classified: ClassifiedConflict[] = [];

    for (const [key, items] of seen.entries()) {
      if (items.length <= 1) continue;

      // Check if all rules have different tariff_ids → valid parallel
      const tariffIds = items.map(i => i.tariff_id || '__product_level__');
      const uniqueTariffs = new Set(tariffIds);

      if (uniqueTariffs.size === items.length) {
        // All different tariffs = valid parallel rules (different tariff scopes)
        classified.push({ key, items, type: 'valid_parallel_rule', label: 'Разные тарифы — допустимо' });
      } else {
        // Check for exact duplicates (same product + tariff + target)
        const sigMap = new Map<string, AccessRule[]>();
        items.forEach(i => {
          const sig = `${i.product_id}:${i.tariff_id || ''}:${i.target_ref}`;
          if (!sigMap.has(sig)) sigMap.set(sig, []);
          sigMap.get(sig)!.push(i);
        });
        const hasDuplicates = [...sigMap.values()].some(g => g.length > 1);

        if (hasDuplicates) {
          classified.push({ key, items, type: 'duplicate_rule', label: 'Дублирующие правила' });
        } else {
          classified.push({ key, items, type: 'ambiguous_overlap', label: 'Неоднозначное перекрытие' });
        }
      }
    }

    return classified;
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

  // === Helpers to extract multi-product data from conditions ===
  const getTargetProductIds = (rule: AccessRule): string[] => {
    const cond = (rule.conditions || {}) as Record<string, unknown>;
    if (Array.isArray(cond.target_product_ids) && cond.target_product_ids.length > 0) {
      return cond.target_product_ids as string[];
    }
    // Fallback to single target_ref for legacy rules
    return rule.target_ref ? [rule.target_ref] : [];
  };

  const getConditionProductIds = (rule: AccessRule): string[] => {
    const cond = (rule.conditions || {}) as Record<string, unknown>;
    if (cond.condition_type !== "prior_purchase") return [];
    if (Array.isArray(cond.required_product_ids) && cond.required_product_ids.length > 0) {
      return cond.required_product_ids as string[];
    }
    // Fallback to single required_product_id
    if (cond.required_product_id) return [cond.required_product_id as string];
    return [];
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
      target_product_ids: [],
      has_condition: false,
      condition_use_same_list: true,
      condition_required_product_ids: [],
      tc_access_mode: "full",
      tc_allowed_module_ids: [],
      tc_allowed_lesson_ids: [],
      tc_auto_include_new_modules: false,
    });
    setAdvancedOpen(false);
    setDialogOpen(true);
  };

  const openEditDialog = (rule: AccessRule) => {
    setEditing(rule);
    const purpose = getRulePurpose(rule);
    const conditions = (rule.conditions || {}) as Record<string, unknown>;
    const hasCondition = conditions.condition_type === "prior_purchase";

    const targetIds = getTargetProductIds(rule);
    const conditionIds = getConditionProductIds(rule);

    // Determine if condition uses same list as targets
    const useSameList = hasCondition && targetIds.length > 0 && conditionIds.length > 0 &&
      targetIds.length === conditionIds.length &&
      targetIds.every(id => conditionIds.includes(id));

    // Extract training_content fields from conditions
    const tcAccessMode = (conditions.access_mode as "full" | "partial") || "full";
    const tcAllowedModuleIds = (Array.isArray(conditions.allowed_module_ids) ? conditions.allowed_module_ids : []) as string[];
    const tcAllowedLessonIds = (Array.isArray(conditions.allowed_lesson_ids) ? conditions.allowed_lesson_ids : []) as string[];

    // Hydrate useViaRuleTraining for external training_content rules
    if (rule.grant_target_type === "training_content" && rule.target_ref) {
      const isExternal = !rootTrainings.some(t => t.id === rule.target_ref);
      if (isExternal) {
        setUseViaRuleTraining({ id: rule.target_ref, title: rule.target_label || rule.target_ref });
      } else {
        setUseViaRuleTraining(null);
      }
    } else {
      setUseViaRuleTraining(null);
    }

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
      target_product_ids: rule.grant_target_type === "product_access" ? targetIds : [],
      has_condition: hasCondition,
      condition_use_same_list: useSameList,
      condition_required_product_ids: useSameList ? [] : conditionIds,
      tc_access_mode: tcAccessMode,
      tc_allowed_module_ids: tcAllowedModuleIds,
      tc_allowed_lesson_ids: tcAllowedLessonIds,
      tc_auto_include_new_modules: Boolean(conditions.auto_include_new_modules),
    });
    setAdvancedOpen(false);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    // Validate: for product_access multi-select, need at least one product
    if (form.grant_target_type === "product_access") {
      if (form.target_product_ids.length === 0) {
        toast.error("Выберите хотя бы один продукт для выдачи");
        return;
      }
    } else if (form.grant_target_type === "training_content") {
      if (!form.target_ref) {
        toast.error("Выберите тренинг");
        return;
      }
      if (form.tc_access_mode === "partial" && form.tc_allowed_module_ids.length === 0 && form.tc_allowed_lesson_ids.length === 0) {
        toast.error("Для частичного доступа выберите хотя бы один модуль или урок");
        return;
      }
    } else if (!form.target_ref) {
      toast.error("Выберите цель выдачи");
      return;
    }

    const conditions: Record<string, unknown> = {};
    if (form.rule_purpose !== "primary") {
      conditions.rule_purpose = form.rule_purpose;
    }

    // Multi-product target storage (add-only JSONB)
    if (form.grant_target_type === "product_access" && form.target_product_ids.length > 0) {
      conditions.target_product_ids = form.target_product_ids;
    }

    // Conditional prior_purchase
    if (form.has_condition && form.grant_target_type === "product_access") {
      conditions.condition_type = "prior_purchase";
      conditions.match_mode = "per_product";

      const effectiveConditionIds = form.condition_use_same_list
        ? form.target_product_ids
        : form.condition_required_product_ids;

      if (effectiveConditionIds.length > 0) {
        conditions.required_product_ids = effectiveConditionIds;
        // Backward-compatible: also write single field for legacy readers
        if (effectiveConditionIds.length === 1) {
          conditions.required_product_id = effectiveConditionIds[0];
        }
      }
    }

    // training_content conditions — normalize payload
    if (form.grant_target_type === "training_content") {
      conditions.access_mode = form.tc_access_mode;
      if (form.tc_access_mode === "partial" && trainingTree) {
        const normalized = normalizeTrainingContentPayload(form.tc_allowed_module_ids, form.tc_allowed_lesson_ids, trainingTree);
        conditions.allowed_module_ids = normalized.allowed_module_ids;
        conditions.allowed_lesson_ids = normalized.allowed_lesson_ids;
        // partial: явно фиксируем флаг авто-включения новых папок (по умолчанию выключен)
        conditions.auto_include_new_modules = Boolean(form.tc_auto_include_new_modules);
      } else {
        conditions.allowed_module_ids = [];
        conditions.allowed_lesson_ids = [];
        // full: флаг авто-включения не нужен — full и так видит все будущие модули
        delete conditions.auto_include_new_modules;
      }
    }

    // Parse string fields to numbers on save
    const parsedPriority = form.priority.trim() === "" ? 0 : (parseInt(form.priority, 10) || 0);
    const parsedDuration = form.duration_mode === "manual"
      ? (form.duration_days.trim() === "" ? null : (parseInt(form.duration_days, 10) || null))
      : null;

    // For multi-product: target_ref = first product (backward-compatible), target_label = summary
    let targetRef = form.target_ref;
    let targetLabel = form.target_label;
    if (form.grant_target_type === "product_access" && form.target_product_ids.length > 0) {
      targetRef = form.target_product_ids[0];
      if (form.target_product_ids.length === 1) {
        targetLabel = availableProducts.find(p => p.id === targetRef)?.name || targetRef;
      } else {
        const names = form.target_product_ids
          .map(id => availableProducts.find(p => p.id === id)?.name || id);
        targetLabel = `${names.length} продуктов: ${names.slice(0, 2).join(", ")}${names.length > 2 ? ` и ещё ${names.length - 2}` : ""}`;
      }
    }
    // training_content: target_label = training title (use merged trainingOptions)
    if (form.grant_target_type === "training_content" && form.target_ref) {
      const training = trainingOptions.find(t => t.id === form.target_ref);
      targetLabel = training?.title || form.target_label || form.target_ref;
    }

    const payload: any = {
      product_id: form.scope === "product" ? productId : productId,
      tariff_id: form.scope === "tariff" ? form.tariff_id : null,
      grant_target_type: form.grant_target_type,
      target_ref: targetRef,
      target_label: targetLabel || null,
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
    setUseViaRuleTraining(null);
  };

  // Auto-set target_label when selecting target (non-product_access types)
  const handleTargetRefChange = (ref: string) => {
    let label = ref;
    if (form.grant_target_type === "club") {
      const club = availableClubs.find((c) => c.id === ref);
      label = club ? `${club.club_name} (${getClubAccessLabel(club)})` : ref;
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
    if (durationDays != null && durationSource === "rule") {
      return `${formatDuration(durationDays)} (из правила)`;
    }
    if (durationDays != null && durationSource === "tariff") {
      return `${formatDuration(durationDays)} (из тарифа)`;
    }
    if (durationDays != null && durationSource === "legacy") {
      return `${formatDuration(durationDays)} (старая настройка)`;
    }
    if (durationDays != null) {
      return formatDuration(durationDays)!;
    }
    if (sourceType === "rule" && durationSource === "unknown") {
      return "По сроку тарифа покупки";
    }
    if (sourceType === "rule") {
      return "По сроку тарифа покупки";
    }
    if (sourceType === "legacy") {
      return "Срок не задан";
    }
    return "По сроку тарифа покупки";
  };

  return (
    <div className="space-y-6">
      {/* PATCH A: Linked trainings block */}
      <ProductLinkedTrainingsBlock
        productId={productId}
        onUseViaRule={openCreateTrainingContentRule}
        onEditRule={(ruleId) => {
          const rule = rules.find(r => r.id === ruleId);
          if (rule) {
            openEditDialog(rule);
          }
        }}
        onFocusRule={(ruleId) => {
          const el = document.getElementById(`access-rule-${ruleId}`);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            el.classList.add("ring-2", "ring-primary");
            setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 3000);
          } else {
            const section = document.getElementById("access-rules-section");
            section?.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }}
      />

      {/* Header */}
      <div id="access-rules-section" className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
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

      {/* Conflicts warning — real conflicts only */}
      {conflicts.filter(c => c.type !== 'valid_parallel_rule').length > 0 && (
        <Card className="border-amber-200/50 bg-amber-50/30 dark:border-amber-800/50 dark:bg-amber-950/30">
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="text-sm font-medium">
                Обнаружены конфликты правил — требует действия администратора
              </span>
            </div>
            <div className="mt-2 space-y-1">
              {conflicts.filter(c => c.type !== 'valid_parallel_rule').map(({ key, items, label, type }) => (
                <div key={key} className="text-xs text-amber-600 dark:text-amber-500">
                  {items[0].target_label || key}: {label} — {items.map((i) => `${i.tariff?.name || "Продукт"} (приоритет ${i.priority})`).join(" + ")}
                  {type === 'duplicate_rule' && " → рекомендуется удалить дубликат"}
                  {type === 'ambiguous_overlap' && " → рекомендуется уточнить приоритеты"}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Valid parallel rules — info only */}
      {conflicts.filter(c => c.type === 'valid_parallel_rule').length > 0 && (
        <Card className="border-blue-200/50 bg-blue-50/30 dark:border-blue-800/50 dark:bg-blue-950/30">
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400">
              <Info className="h-4 w-4 shrink-0" />
              <span className="text-sm font-medium">
                Это допустимая конфигурация, если правила разведены по тарифам
              </span>
            </div>
            <div className="mt-2 space-y-1">
              {conflicts.filter(c => c.type === 'valid_parallel_rule').map(({ key, items }) => (
                <div key={key} className="text-xs text-blue-600 dark:text-blue-500">
                  {items[0].target_label || key}: {items.map((i) => (i.tariff?.name || "Продукт")).join(", ")}
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
            const conflictEntry = conflicts.find((c) => c.items.some((i) => i.id === rule.id));
            const hasRealConflict = !!conflictEntry && conflictEntry.type !== 'valid_parallel_rule';
            const isParallelRule = !!conflictEntry && conflictEntry.type === 'valid_parallel_rule';
            const hasOverlap = overlaps.some(
              (o) => o.grant_target_type === rule.grant_target_type && o.target_ref === rule.target_ref
            );
            const defaultDuration = rule.tariff_id ? getDefaultDuration(rule.tariff_id) : null;
            const effectiveDuration = rule.duration_days ?? defaultDuration;

            // Multi-product data
            const targetIds = rule.grant_target_type === "product_access" ? getTargetProductIds(rule) : [];
            const conditionIds = getConditionProductIds(rule);
            const isMultiProduct = targetIds.length > 1;

            return (
              <Card
                id={`access-rule-${rule.id}`}
                key={rule.id}
                className={cn(
                  "transition-colors",
                  !rule.is_active && "opacity-60",
                  hasRealConflict && "border-amber-300/50"
                )}
              >
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className={cn("p-1.5 rounded-lg", rule.is_active ? "bg-primary/10" : "bg-muted")}>
                      <Icon className="h-4 w-4 text-primary" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Title: show multi-product badge or single name */}
                        {isMultiProduct ? (
                          <ProductListBadge
                            productIds={targetIds}
                            products={availableProducts}
                            prefix="Доступ к"
                            className="text-primary border-primary/30"
                          />
                        ) : (
                          <span className="font-medium text-sm">{rule.target_label || rule.target_ref}</span>
                        )}
                        <Badge variant="outline" className="text-[10px]">
                          {TARGET_TYPE_LABELS[rule.grant_target_type]}
                        </Badge>
                        {rule.grant_target_type === "training_content" && (() => {
                          const meta = getTrainingContentMeta(rule.conditions as Record<string, unknown>);
                          const isEmpty = meta.mode === "partial" && meta.moduleCount === 0 && meta.lessonCount === 0;
                          return (
                            <>
                              <Badge variant="outline" className={cn("text-[10px]", meta.mode === "partial" ? "text-amber-600 border-amber-300" : "")}>
                                {meta.mode === "full"
                                  ? "Весь тренинг"
                                  : isEmpty
                                    ? "Частичный доступ"
                                    : `Частичный: ${meta.moduleCount} мод. ${meta.lessonCount} ур.`}
                              </Badge>
                              {isEmpty && (
                                <Badge variant="outline" className="text-[10px] text-muted-foreground border-muted">
                                  ⚠ выбор пуст
                                </Badge>
                              )}
                            </>
                          );
                        })()}
                        <Badge variant="outline" className="text-[10px]">
                          {rule.tariff_id ? `Тариф: ${rule.tariff?.name || "—"}` : "Весь продукт"}
                        </Badge>
                        {purpose !== "primary" && (
                          <Badge variant="outline" className="text-[10px] text-purple-600 border-purple-300">
                            <PurposeIcon className="h-3 w-3 mr-0.5" />
                            {PURPOSE_LABELS[purpose]}
                          </Badge>
                        )}
                        {hasRealConflict && conflictEntry && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">
                                  <AlertTriangle className="h-3 w-3 mr-0.5" />
                                  Конфликт
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="max-w-[350px]">
                                <div className="space-y-1 text-xs">
                                  <div className="font-medium">
                                    {conflictEntry.type === 'duplicate_rule' ? 'Дублирующие правила' : 'Неоднозначное перекрытие'}
                                  </div>
                                  <div className="text-muted-foreground">
                                    {conflictEntry.type === 'duplicate_rule'
                                      ? 'Найдены идентичные правила (продукт + тариф + цель). Рекомендуется удалить дубликат.'
                                      : 'Несколько правил на одну цель с неопределённым приоритетом. Рекомендуется уточнить приоритеты.'}
                                  </div>
                                  <div className="pt-1 border-t border-border/50">
                                    {conflictEntry.items.map((item, idx) => (
                                      <div key={idx}>
                                        • {item.tariff?.name || "Весь продукт"} — приоритет {item.priority}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        {hasOverlap && (
                          <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-300">
                            Дублирует старую настройку
                          </Badge>
                        )}
                        {/* Condition badge: multi-product aware */}
                        {conditionIds.length > 0 && (
                          <ProductListBadge
                            productIds={conditionIds}
                            products={availableProducts}
                            prefix="Условие: ранее покупал"
                            className="text-orange-600 border-orange-300"
                          />
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
              {effectiveGrants.filter(g => g.effective_status === "active").map((g, idx) => (
                <EffectiveGrantCard key={`active-${idx}`} grant={g} getDurationDisplay={getDurationDisplay} />
              ))}
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

      {/* === RetroApply Panel === */}
      <RetroApplyPanel productId={productId} rules={rules} tariffs={tariffs} />

      {/* === Create/Edit Dialog === */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>{editing ? "Редактировать правило" : "Новое правило доступа"}</DialogTitle>
            <DialogDescription>
              Определите, что получит покупатель при покупке
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2 overflow-y-auto flex-1 min-h-0 pr-1">
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
                onValueChange={(v: GrantTargetType) => {
                  setUseViaRuleTraining(null);
                  setForm({
                    ...form,
                    grant_target_type: v,
                    target_ref: "",
                    target_label: "",
                    target_product_ids: [],
                    has_condition: false,
                    condition_use_same_list: true,
                    condition_required_product_ids: [],
                  });
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(TARGET_TYPE_LABELS) as [GrantTargetType, string][])
                    .filter(([k]) => k !== "entitlement" && k !== "email")
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
              {form.grant_target_type === "section_access" && (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground bg-muted/50 rounded-md px-2.5 py-1.5">
                  <Info className="h-3.5 w-3.5 shrink-0" />
                  Правило ограничивает доступ к разделу платформы. Пользователь без доступа увидит экран с предложением покупки.
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

              {/* Multi-select product list for product_access */}
              {form.grant_target_type === "product_access" && (
                <ProductCheckboxList
                  products={availableProducts}
                  selected={form.target_product_ids}
                  onChange={(ids) => setForm({ ...form, target_product_ids: ids })}
                  placeholder="Поиск продукта для выдачи…"
                />
              )}

              {form.grant_target_type === "entitlement" && (
                <div className="space-y-2">
                  <Select value={form.target_ref} onValueChange={(v) => setForm({ ...form, target_ref: v, target_label: v })}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Выберите системное право" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableEntitlements.map((e) => (
                        <SelectItem key={e.product_code} value={e.product_code}>
                          <div className="flex flex-col">
                            <span>{e.label}</span>
                            {e.label !== e.product_code && (
                              <span className="text-[10px] text-muted-foreground">{e.product_code}</span>
                            )}
                          </div>
                        </SelectItem>
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
              {form.grant_target_type === "section_access" && (
                <div className="space-y-2">
                  <Select
                    value={form.target_ref}
                    onValueChange={(v) => {
                      const section = availableSections.find(s => s.id === v);
                      setForm({
                        ...form,
                        target_ref: v,
                        target_label: section?.label || v,
                      });
                    }}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Выберите раздел платформы" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableSections.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          <span className="flex items-center gap-2">
                            {s.label}
                            <Badge variant="outline" className="text-[9px] px-1 py-0">
                              {s.is_public ? "публичный" : "закрытый"}
                            </Badge>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Раздел платформы, к которому будет выдан доступ. Gating активируется только после ручного перевода секции в закрытый режим.
                  </p>
                </div>
              )}

              {/* training_content: root training selector + access mode + tree picker */}
              {form.grant_target_type === "training_content" && (
                <div className="space-y-3">
                  {/* Root training selector */}
                  <div className="space-y-1.5">
                    <Label className="text-xs">Тренинг</Label>
                    {trainingOptions.length === 0 && !form.target_ref ? (
                      <div className="text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-3 text-center">
                        К продукту не привязано ни одного тренинга. Сначала привяжите тренинг.
                      </div>
                    ) : (
                      <Select
                        value={form.target_ref}
                        onValueChange={(v) => {
                          const isExternal = !rootTrainings.some(t => t.id === v);
                          setForm({
                            ...form,
                            target_ref: v,
                            target_label: trainingOptions.find(t => t.id === v)?.title || v,
                            tc_allowed_module_ids: [],
                            tc_allowed_lesson_ids: [],
                          });
                          if (!isExternal) {
                            setUseViaRuleTraining(null);
                          }
                        }}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Выберите тренинг" />
                        </SelectTrigger>
                        <SelectContent>
                          {trainingOptions.map(t => {
                            const isExternal = !rootTrainings.some(rt => rt.id === t.id);
                            return (
                              <SelectItem key={t.id} value={t.id}>
                                <div className="flex items-center gap-2">
                                  <BookOpen className="h-3.5 w-3.5 text-primary shrink-0" />
                                  <span>{t.title}</span>
                                  {t.public_id && (
                                    <span className="text-[10px] text-muted-foreground font-mono">{t.public_id}</span>
                                  )}
                                  {!t.is_active && (
                                    <Badge variant="outline" className="text-[9px] text-muted-foreground">Неактивен</Badge>
                                  )}
                                  {isExternal && (
                                    <Badge variant="secondary" className="text-[9px]">внешний</Badge>
                                  )}
                                </div>
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    )}
                    {/* Helper text for external training via rule */}
                    {useViaRuleTraining && form.target_ref && !rootTrainings.some(t => t.id === form.target_ref) && (
                      <p className="text-[11px] text-muted-foreground bg-muted/30 rounded px-2 py-1.5">
                        Тренинг используется через правило доступа. Владелец не меняется.
                      </p>
                    )}
                  </div>

                  {/* Access mode toggle */}
                  {form.target_ref && (
                    <div className="space-y-2">
                      <Label className="text-xs">Режим доступа</Label>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            // При переходе с partial → full в edit-режиме существующего правила требуем подтверждение
                            if (editing && form.tc_access_mode === "partial") {
                              setConfirmFullSwitch(true);
                              return;
                            }
                            setForm({ ...form, tc_access_mode: "full", tc_allowed_module_ids: [], tc_allowed_lesson_ids: [], tc_auto_include_new_modules: false });
                          }}
                          className={cn(
                            "flex-1 px-3 py-2 rounded-lg border text-sm transition-all",
                            form.tc_access_mode === "full"
                              ? "border-primary bg-primary/5 text-primary"
                              : "border-border text-muted-foreground hover:text-foreground"
                          )}
                        >
                          Полный доступ
                        </button>
                        <button
                          onClick={() => setForm({ ...form, tc_access_mode: "partial" })}
                          className={cn(
                            "flex-1 px-3 py-2 rounded-lg border text-sm transition-all",
                            form.tc_access_mode === "partial"
                              ? "border-primary bg-primary/5 text-primary"
                              : "border-border text-muted-foreground hover:text-foreground"
                          )}
                        >
                          Частичный доступ
                        </button>
                      </div>
                      {form.tc_access_mode === "full" && (
                        <p className="text-[11px] text-muted-foreground">
                          Полный доступ автоматически включает все текущие и будущие папки тренинга.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Tree picker for partial */}
                  {form.target_ref && form.tc_access_mode === "partial" && (
                    trainingTree ? (
                      <TrainingContentTreePicker
                        tree={trainingTree}
                        selectedModuleIds={form.tc_allowed_module_ids}
                        selectedLessonIds={form.tc_allowed_lesson_ids}
                        onChange={(mods, lessons) => setForm(prev => ({ ...prev, tc_allowed_module_ids: mods, tc_allowed_lesson_ids: lessons }))}
                      />
                    ) : (
                      <div className="text-xs text-muted-foreground text-center py-4">Загрузка дерева…</div>
                    )
                  )}

                  {/* Auto-include flag (только для partial) */}
                  {form.target_ref && form.tc_access_mode === "partial" && (
                    <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3">
                      <Checkbox
                        id="tc-auto-include"
                        checked={form.tc_auto_include_new_modules}
                        onCheckedChange={(v) => setForm({ ...form, tc_auto_include_new_modules: Boolean(v) })}
                        className="mt-0.5"
                      />
                      <div className="space-y-1">
                        <Label htmlFor="tc-auto-include" className="text-xs font-medium cursor-pointer">
                          Автоматически добавлять новые папки тренинга
                        </Label>
                        <p className="text-[11px] text-muted-foreground">
                          По умолчанию выключено. Если когорта по бизнес-логике должна видеть весь тренинг — лучше выбрать «Полный доступ».
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Orphan modules alert */}
                  {form.target_ref && form.tc_access_mode === "partial" && orphanModules.length > 0 && (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-amber-900">
                            Не включены в правило: {orphanModules.length} {orphanModules.length === 1 ? "папка" : "папок"}
                          </p>
                          <p className="text-[11px] text-amber-800">
                            {orphanModules.slice(0, 5).map((m: TreeModule) => m.title).join(", ")}
                            {orphanModules.length > 5 ? ` и ещё ${orphanModules.length - 5}` : ""}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-[11px]"
                          onClick={() => {
                            const allIds = trainingTree?.children?.map((m: TreeModule) => m.id) || [];
                            setForm(prev => ({ ...prev, tc_allowed_module_ids: Array.from(new Set([...prev.tc_allowed_module_ids, ...allIds])) }));
                          }}
                        >
                          Добавить все
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-[11px]"
                          onClick={() => editing ? setConfirmFullSwitch(true) : setForm({ ...form, tc_access_mode: "full", tc_allowed_module_ids: [], tc_allowed_lesson_ids: [], tc_auto_include_new_modules: false })}
                        >
                          Перевести в «Полный доступ»
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Label override — hide for product_access/training_content (auto-generated) */}
              {form.grant_target_type !== "product_access" && form.grant_target_type !== "training_content" && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Отображаемое название (необязательно)</Label>
                  <Input
                    value={form.target_label}
                    onChange={(e) => setForm({ ...form, target_label: e.target.value })}
                    placeholder="Автоматически из выбранной цели"
                    className="h-9"
                  />
                </div>
              )}
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

              {/* Conditional rule block — shown for product_access target type */}
              {form.grant_target_type === "product_access" && (
                <div className="space-y-3 rounded-lg border border-dashed border-muted-foreground/30 p-4 bg-muted/20">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={form.has_condition}
                      onCheckedChange={(v) => setForm({ ...form, has_condition: v })}
                    />
                    <Label className="text-xs">Выдавать только если ранее покупал</Label>
                  </div>
                  {form.has_condition && (
                    <div className="space-y-3 pl-1">
                      {/* Same-list toggle */}
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <button
                            onClick={() => setForm({ ...form, condition_use_same_list: true })}
                            className={cn(
                              "flex-1 px-3 py-1.5 rounded-md border text-xs transition-all",
                              form.condition_use_same_list
                                ? "border-primary bg-primary/5 text-primary"
                                : "border-border text-muted-foreground hover:text-foreground"
                            )}
                          >
                            Проверять эти же продукты
                          </button>
                          <button
                            onClick={() => setForm({ ...form, condition_use_same_list: false })}
                            className={cn(
                              "flex-1 px-3 py-1.5 rounded-md border text-xs transition-all",
                              !form.condition_use_same_list
                                ? "border-primary bg-primary/5 text-primary"
                                : "border-border text-muted-foreground hover:text-foreground"
                            )}
                          >
                            Выбрать отдельный список
                          </button>
                        </div>
                      </div>

                      {form.condition_use_same_list ? (
                        <div className="text-[11px] text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
                          {form.target_product_ids.length > 0 ? (
                            <>
                              Проверка по {form.target_product_ids.length} выбранным продуктам.
                              Доступ будет выдан только к тем, которые ранее покупались.
                            </>
                          ) : (
                            "Сначала выберите продукты для выдачи (шаг 3)"
                          )}
                        </div>
                      ) : (
                        <ProductCheckboxList
                          products={availableProducts}
                          selected={form.condition_required_product_ids}
                          onChange={(ids) => setForm({ ...form, condition_required_product_ids: ids })}
                          placeholder="Поиск продукта-условия…"
                        />
                      )}

                      <p className="text-[10px] text-muted-foreground">
                        Из выбранных целевых продуктов будут выданы только те, которые ранее были куплены (оплаченный заказ).
                        Остальные будут пропущены.
                      </p>
                    </div>
                  )}
                </div>
              )}

            <Separator />

            {/* === Section 5: Срок === */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">5</span>
                Срок доступа
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setForm({ ...form, duration_mode: "tariff", duration_days: null as any })}
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
                        if (trimmed === "") return;
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
                    placeholder="0"
                    onChange={(e) => setForm({ ...form, priority: e.target.value.replace(/\D/g, "") })}
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
            <Button variant="outline" onClick={() => { setDialogOpen(false); setUseViaRuleTraining(null); }}>Отмена</Button>
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

      {/* Confirm: partial → full switch */}
      <AlertDialog open={confirmFullSwitch} onOpenChange={setConfirmFullSwitch}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Перевести правило в «Полный доступ»?</AlertDialogTitle>
            <AlertDialogDescription>
              После перевода в full пользователи этого правила увидят все текущие и будущие папки тренинга. Текущий список выбранных модулей будет сброшен.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setForm({ ...form, tc_access_mode: "full", tc_allowed_module_ids: [], tc_allowed_lesson_ids: [], tc_auto_include_new_modules: false });
                setConfirmFullSwitch(false);
              }}
            >
              Перевести в full
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
          {g.grant_target_type === "training_content" && g.tc_access_mode && (() => {
            const isEmpty = g.tc_access_mode === "partial" && (g.tc_module_count || 0) === 0 && (g.tc_lesson_count || 0) === 0;
            return (
              <>
                <Badge variant="outline" className={cn("text-[9px]", g.tc_access_mode === "partial" ? "text-amber-600 border-amber-300" : "")}>
                  {g.tc_access_mode === "full"
                    ? "Весь тренинг"
                    : isEmpty
                      ? "Частичный доступ"
                      : `Частичный: ${g.tc_module_count} мод. ${g.tc_lesson_count} ур.`}
                </Badge>
                {isEmpty && (
                  <Badge variant="outline" className="text-[9px] text-muted-foreground border-muted">
                    ⚠ выбор пуст
                  </Badge>
                )}
              </>
            );
          })()}
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
