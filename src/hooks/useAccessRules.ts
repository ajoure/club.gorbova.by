import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type GrantTargetType = "entitlement" | "club" | "email" | "product_access" | "training_content" | "section_access" | "document_generation";

export type RulePurpose = "primary" | "bonus" | "additional" | "service";

export interface AccessRule {
  id: string;
  product_id: string | null;
  tariff_id: string | null;
  grant_target_type: GrantTargetType;
  target_ref: string;
  target_label: string | null;
  is_active: boolean;
  priority: number;
  duration_days: number | null;
  conditions: Record<string, unknown>;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  product?: { id: string; name: string } | null;
  tariff?: { id: string; name: string } | null;
}

export function getRulePurpose(rule: AccessRule): RulePurpose {
  return (rule.conditions?.rule_purpose as RulePurpose) || "primary";
}

export interface LegacyMapping {
  id: string;
  source: "product_club_mappings" | "product_email_mappings";
  product_id: string;
  product_name: string;
  grant_target_type: GrantTargetType;
  target_ref: string;
  target_label: string;
  is_active: boolean;
  duration_days: number | null;
  migrated: boolean;
}

export type LegacyStatus =
  | "active_legacy_only"
  | "duplicated_by_rule"
  | "migrated_replaced"
  | "inactive_legacy"
  | "fallback_effective";

export function getLegacyStatus(m: LegacyMapping, rules: AccessRule[]): LegacyStatus {
  const matchingRule = rules.find(
    (r) => r.grant_target_type === m.grant_target_type && r.target_ref === m.target_ref
  );

  if (!m.is_active) return "inactive_legacy";
  if (!matchingRule) return m.is_active ? "active_legacy_only" : "inactive_legacy";
  if (matchingRule.is_active && m.migrated) return "migrated_replaced";
  if (matchingRule.is_active) return "duplicated_by_rule";
  // Rule exists but inactive — legacy still effective
  return "fallback_effective";
}

const QUERY_KEY = "access-rules";

export function useAccessRules(productId?: string) {
  const queryClient = useQueryClient();

  const { data: rules = [], isLoading } = useQuery({
    queryKey: [QUERY_KEY, productId],
    queryFn: async () => {
      let query = supabase
        .from("access_rules")
        .select(`*, product:products_v2(id, name), tariff:tariffs(id, name)`)
        .order("priority", { ascending: false })
        .order("created_at", { ascending: false });

      if (productId) {
        const { data: tariffIds } = await supabase
          .from("tariffs")
          .select("id")
          .eq("product_id", productId);

        const tIds = tariffIds?.map((t) => t.id) || [];

        if (tIds.length > 0) {
          query = query.or(
            `product_id.eq.${productId},tariff_id.in.(${tIds.join(",")})`
          );
        } else {
          query = query.eq("product_id", productId);
        }
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as AccessRule[];
    },
    enabled: !!productId,
  });

  // Legacy mappings
  const { data: legacyMappings = [] } = useQuery({
    queryKey: ["legacy-mappings", productId],
    queryFn: async () => {
      if (!productId) return [];
      const mappings: LegacyMapping[] = [];

      const { data: clubs } = await supabase
        .from("product_club_mappings")
        .select("id, product_id, club_id, is_active, duration_days, products_v2(name), telegram_clubs(club_name)")
        .eq("product_id", productId);

      clubs?.forEach((m: any) => {
        mappings.push({
          id: m.id,
          source: "product_club_mappings",
          product_id: m.product_id,
          product_name: m.products_v2?.name || "",
          grant_target_type: "club",
          target_ref: m.club_id,
          target_label: m.telegram_clubs?.club_name || m.club_id,
          is_active: m.is_active,
          duration_days: m.duration_days,
          migrated: false,
        });
      });

      const { data: emails } = await supabase
        .from("product_email_mappings")
        .select("id, product_id, email_account_id, is_active, products_v2(name), email_accounts(email)")
        .eq("product_id", productId);

      emails?.forEach((m: any) => {
        mappings.push({
          id: m.id,
          source: "product_email_mappings",
          product_id: m.product_id,
          product_name: m.products_v2?.name || "",
          grant_target_type: "email",
          target_ref: m.email_account_id,
          target_label: m.email_accounts?.email || m.email_account_id,
          is_active: m.is_active ?? true,
          duration_days: null,
          migrated: false,
        });
      });

      // Mark migrated
      if (rules.length > 0) {
        mappings.forEach((m) => {
          m.migrated = rules.some(
            (r) =>
              r.grant_target_type === m.grant_target_type &&
              r.target_ref === m.target_ref &&
              r.product_id === m.product_id
          );
        });
      }

      return mappings;
    },
    enabled: !!productId,
  });

  const createRule = useMutation({
    mutationFn: async (rule: Partial<AccessRule>) => {
      const { data, error } = await supabase
        .from("access_rules")
        .insert(rule as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: ["legacy-mappings"] });
      queryClient.invalidateQueries({ queryKey: ["effective-grants"] });
      toast.success("Правило создано");
    },
    onError: (e: any) => {
      const msg = e?.message || "";
      if (e?.code === "23505") {
        toast.error("Такое правило уже существует");
      } else if (msg.includes("must be a root training module")) {
        toast.error("Тренинг должен быть корневым модулем (не дочерним)");
      } else if (msg.includes("product must match") || msg.includes("product_id does not match")) {
        toast.error("Тренинг принадлежит другому продукту. Для использования через правило доступа должна быть применена новая миграция.");
      } else if (msg.includes("must have access_mode")) {
        toast.error("Не указан режим доступа (полный / частичный)");
      } else if (msg.includes("non-empty allowed_module_ids") || msg.includes("non-empty allowed_lesson_ids")) {
        toast.error("Для частичного доступа выберите хотя бы один модуль или урок");
      } else {
        toast.error(`Ошибка создания правила: ${msg || "неизвестная ошибка"}`);
      }
    },
  });

  const updateRule = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<AccessRule>) => {
      const { data, error } = await supabase
        .from("access_rules")
        .update(updates as any)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: ["effective-grants"] });
      toast.success("Правило обновлено");
    },
    onError: (e: any) => {
      const msg = e?.message || "";
      if (e?.code === "23505") {
        toast.error("Такое правило уже существует");
      } else if (msg.includes("must be a root training module")) {
        toast.error("Тренинг должен быть корневым модулем (не дочерним)");
      } else if (msg.includes("product must match") || msg.includes("product_id does not match")) {
        toast.error("Тренинг принадлежит другому продукту. Для использования через правило доступа должна быть применена новая миграция.");
      } else if (msg.includes("must have access_mode")) {
        toast.error("Не указан режим доступа (полный / частичный)");
      } else if (msg.includes("non-empty allowed_module_ids") || msg.includes("non-empty allowed_lesson_ids")) {
        toast.error("Для частичного доступа выберите хотя бы один модуль или урок");
      } else {
        toast.error(`Ошибка обновления правила: ${msg || "неизвестная ошибка"}`);
      }
    },
  });

  const deleteRule = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("access_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: ["legacy-mappings"] });
      queryClient.invalidateQueries({ queryKey: ["effective-grants"] });
      toast.success("Правило удалено");
    },
    onError: () => toast.error("Ошибка удаления правила"),
  });

  const toggleRule = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("access_rules")
        .update({ is_active } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: ["effective-grants"] });
    },
  });

  return {
    rules,
    legacyMappings,
    isLoading,
    createRule: createRule.mutateAsync,
    updateRule: updateRule.mutateAsync,
    deleteRule: deleteRule.mutateAsync,
    toggleRule: toggleRule.mutateAsync,
    isCreating: createRule.isPending,
    isUpdating: updateRule.isPending,
    isDeleting: deleteRule.isPending,
  };
}

// === Effective Grants with full source resolution ===

export type EffectiveGrantSource = "rule" | "legacy" | "fallback";
export type EffectiveGrantMigratedStatus = "new_rule" | "migrated" | "not_migrated" | "n/a";

export interface EffectiveGrant {
  grant_target_type: GrantTargetType;
  target_ref: string;
  target_label: string;
  source_type: EffectiveGrantSource;
  source_id: string;
  source_label: string;
  scope: "product" | "tariff";
  rule_id?: string;
  is_active: boolean;
  priority: number;
  duration_days: number | null;
  duration_source: "rule" | "tariff" | "legacy" | "unknown";
  rule_purpose: RulePurpose;
  migrated_status: EffectiveGrantMigratedStatus;
  effective_status: "active" | "overridden" | "inactive";
  overridden_by?: string;
  duplicated_with?: string;
  runtime_support: "full" | "partial" | "preview_only";
  // Club extras
  club_access_label?: string;
  // Training content extras
  tc_access_mode?: "full" | "partial";
  tc_module_count?: number;
  tc_lesson_count?: number;
}

/** Extract training_content metadata from conditions safely */
export function getTrainingContentMeta(conditions: Record<string, unknown> | null | undefined): {
  mode: "full" | "partial";
  moduleCount: number;
  lessonCount: number;
} {
  const cond = conditions || {};
  const mode = (cond.access_mode === "partial" ? "partial" : "full") as "full" | "partial";
  const moduleCount = Array.isArray(cond.allowed_module_ids) ? cond.allowed_module_ids.length : 0;
  const lessonCount = Array.isArray(cond.allowed_lesson_ids) ? cond.allowed_lesson_ids.length : 0;
  return { mode, moduleCount, lessonCount };
}

export function useEffectiveGrants(productId?: string, tariffId?: string) {
  return useQuery({
    queryKey: ["effective-grants", productId, tariffId],
    queryFn: async () => {
      if (!productId) return [];

      // Get tariff access_days for duration resolution
      let tariffAccessDays: number | null = null;
      if (tariffId) {
        const { data: tariffData } = await supabase
          .from("tariffs")
          .select("access_days")
          .eq("id", tariffId)
          .single();
        tariffAccessDays = tariffData?.access_days ?? null;
      }

      const grants: EffectiveGrant[] = [];
      const coveredTargets = new Set<string>();

      const makeKey = (type: string, ref: string) => `${type}:${ref}`;

      // 1. Tariff-level rules
      if (tariffId) {
        const { data: tariffRules } = await supabase
          .from("access_rules")
          .select("*")
          .eq("tariff_id", tariffId)
          .eq("is_active", true)
          .order("priority", { ascending: false });

        tariffRules?.forEach((r: any) => {
          const key = makeKey(r.grant_target_type, r.target_ref);
          coveredTargets.add(key);
          const tcMeta = r.grant_target_type === "training_content" ? getTrainingContentMeta(r.conditions) : null;
          grants.push({
            grant_target_type: r.grant_target_type,
            target_ref: r.target_ref,
            target_label: r.target_label || r.target_ref,
            source_type: "rule",
            source_id: r.id,
            source_label: "Правило (тариф)",
            scope: "tariff",
            rule_id: r.id,
            is_active: r.is_active,
            priority: r.priority,
            duration_days: r.duration_days ?? tariffAccessDays,
            duration_source: r.duration_days ? "rule" : (tariffAccessDays ? "tariff" : "unknown"),
            rule_purpose: (r.conditions?.rule_purpose as RulePurpose) || "primary",
            migrated_status: "new_rule",
            effective_status: "active",
            runtime_support: getRuntimeSupport(r.grant_target_type),
            ...(tcMeta && { tc_access_mode: tcMeta.mode, tc_module_count: tcMeta.moduleCount, tc_lesson_count: tcMeta.lessonCount }),
          });
        });
      }

      // 2. Product-level rules
      const { data: productRules } = await supabase
        .from("access_rules")
        .select("*")
        .eq("product_id", productId)
        .is("tariff_id", null)
        .eq("is_active", true)
        .order("priority", { ascending: false });

      productRules?.forEach((r: any) => {
        const key = makeKey(r.grant_target_type, r.target_ref);
        const tcMeta = r.grant_target_type === "training_content" ? getTrainingContentMeta(r.conditions) : null;
        const tcFields = tcMeta ? { tc_access_mode: tcMeta.mode as "full" | "partial", tc_module_count: tcMeta.moduleCount, tc_lesson_count: tcMeta.lessonCount } : {};
        if (coveredTargets.has(key)) {
          grants.push({
            grant_target_type: r.grant_target_type,
            target_ref: r.target_ref,
            target_label: r.target_label || r.target_ref,
            source_type: "rule",
            source_id: r.id,
            source_label: "Правило (продукт)",
            scope: "product",
            rule_id: r.id,
            is_active: r.is_active,
            priority: r.priority,
            duration_days: r.duration_days ?? tariffAccessDays,
            duration_source: r.duration_days ? "rule" : (tariffAccessDays ? "tariff" : "unknown"),
            rule_purpose: (r.conditions?.rule_purpose as RulePurpose) || "primary",
            migrated_status: "new_rule",
            effective_status: "overridden",
            overridden_by: "Правило тарифа",
            runtime_support: getRuntimeSupport(r.grant_target_type),
            ...tcFields,
          });
        } else {
          coveredTargets.add(key);
          grants.push({
            grant_target_type: r.grant_target_type,
            target_ref: r.target_ref,
            target_label: r.target_label || r.target_ref,
            source_type: "rule",
            source_id: r.id,
            source_label: "Правило (продукт)",
            scope: "product",
            rule_id: r.id,
            is_active: r.is_active,
            priority: r.priority,
            duration_days: r.duration_days ?? tariffAccessDays,
            duration_source: r.duration_days ? "rule" : (tariffAccessDays ? "tariff" : "unknown"),
            rule_purpose: (r.conditions?.rule_purpose as RulePurpose) || "primary",
            migrated_status: "new_rule",
            effective_status: "active",
            runtime_support: getRuntimeSupport(r.grant_target_type),
            ...tcFields,
          });
        }
      });

      // 3. Legacy fallback — club mappings
      const { data: clubMappings } = await supabase
        .from("product_club_mappings")
        .select("id, club_id, is_active, duration_days, telegram_clubs(club_name, chat_id, channel_id)")
        .eq("product_id", productId)
        .eq("is_active", true);

      clubMappings?.forEach((m: any) => {
        const key = makeKey("club", m.club_id);
        const alreadyCovered = coveredTargets.has(key);

        // Check if migrated
        const isMigrated = alreadyCovered;
        const hasChat = !!m.telegram_clubs?.chat_id;
        const hasChannel = !!m.telegram_clubs?.channel_id;
        const clubAccessLabel = hasChat && hasChannel ? "чат + канал" : hasChat ? "чат" : hasChannel ? "канал" : "—";

        if (alreadyCovered) {
          // Show as duplicated but overridden
          grants.push({
            grant_target_type: "club",
            target_ref: m.club_id,
            target_label: m.telegram_clubs?.club_name || m.club_id,
            source_type: "legacy",
            source_id: m.id,
            source_label: "Старая настройка (клуб)",
            scope: "product",
            is_active: m.is_active,
            priority: -1,
            duration_days: m.duration_days ?? tariffAccessDays,
            duration_source: m.duration_days ? "legacy" : (tariffAccessDays ? "tariff" : "unknown"),
            rule_purpose: "primary",
            migrated_status: "migrated",
            effective_status: "overridden",
            overridden_by: "Новое правило",
            runtime_support: "full",
            club_access_label: clubAccessLabel,
          });
        } else {
          coveredTargets.add(key);
          grants.push({
            grant_target_type: "club",
            target_ref: m.club_id,
            target_label: m.telegram_clubs?.club_name || m.club_id,
            source_type: "legacy",
            source_id: m.id,
            source_label: "Старая настройка (клуб)",
            scope: "product",
            is_active: m.is_active,
            priority: -1,
            duration_days: m.duration_days ?? tariffAccessDays,
            duration_source: m.duration_days ? "legacy" : (tariffAccessDays ? "tariff" : "unknown"),
            rule_purpose: "primary",
            migrated_status: "not_migrated",
            effective_status: "active",
            runtime_support: "full",
            club_access_label: clubAccessLabel,
          });
        }
      });

      // 4. Legacy — email mappings
      const { data: emailMappings } = await supabase
        .from("product_email_mappings")
        .select("id, email_account_id, is_active, email_accounts(email)")
        .eq("product_id", productId);

      emailMappings?.forEach((m: any) => {
        const key = makeKey("email", m.email_account_id);
        const alreadyCovered = coveredTargets.has(key);

        if (!alreadyCovered) {
          coveredTargets.add(key);
          grants.push({
            grant_target_type: "email",
            target_ref: m.email_account_id,
            target_label: m.email_accounts?.email || m.email_account_id,
            source_type: "legacy",
            source_id: m.id,
            source_label: "Старая настройка (email)",
            scope: "product",
            is_active: m.is_active ?? true,
            priority: -1,
            duration_days: null,
            duration_source: "unknown",
            rule_purpose: "primary",
            migrated_status: "not_migrated",
            effective_status: "active",
            runtime_support: "partial",
          });
        }
      });

      return grants;
    },
    enabled: !!productId,
  });
}

function getRuntimeSupport(type: GrantTargetType): "full" | "partial" | "preview_only" {
  switch (type) {
    case "club": return "full";
    case "product_access": return "full";
    case "entitlement": return "full";
    case "training_content": return "full";
    case "section_access": return "full";
    case "email": return "partial";
    default: return "preview_only";
  }
}
