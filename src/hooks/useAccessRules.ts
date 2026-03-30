import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type GrantTargetType = "entitlement" | "club" | "email" | "product_access";

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
  migrated: boolean; // true if an access_rule already covers this
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
        // Get rules for this product or its tariffs
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

  // Legacy mappings for this product
  const { data: legacyMappings = [] } = useQuery({
    queryKey: ["legacy-mappings", productId],
    queryFn: async () => {
      if (!productId) return [];
      const mappings: LegacyMapping[] = [];

      // Club mappings
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

      // Email mappings
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

      // Mark as migrated if access_rules already covers them
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
      toast.success("Правило создано");
    },
    onError: (e: any) => {
      if (e?.code === "23505") {
        toast.error("Такое правило уже существует");
      } else {
        toast.error("Ошибка создания правила");
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
      toast.success("Правило обновлено");
    },
    onError: () => toast.error("Ошибка обновления правила"),
  });

  const deleteRule = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("access_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: ["legacy-mappings"] });
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

// Preview: compute effective grants for a tariff
export function useEffectiveGrants(productId?: string, tariffId?: string) {
  return useQuery({
    queryKey: ["effective-grants", productId, tariffId],
    queryFn: async () => {
      if (!productId) return [];

      const grants: Array<{
        grant_target_type: GrantTargetType;
        target_ref: string;
        target_label: string;
        source: "rule" | "legacy";
        scope: "product" | "tariff";
        rule_id?: string;
        is_active: boolean;
        priority: number;
      }> = [];

      // 1. New rules - tariff-level
      if (tariffId) {
        const { data: tariffRules } = await supabase
          .from("access_rules")
          .select("*")
          .eq("tariff_id", tariffId)
          .eq("is_active", true)
          .order("priority", { ascending: false });

        tariffRules?.forEach((r: any) => {
          grants.push({
            grant_target_type: r.grant_target_type,
            target_ref: r.target_ref,
            target_label: r.target_label || r.target_ref,
            source: "rule",
            scope: "tariff",
            rule_id: r.id,
            is_active: r.is_active,
            priority: r.priority,
          });
        });
      }

      // 2. New rules - product-level
      const { data: productRules } = await supabase
        .from("access_rules")
        .select("*")
        .eq("product_id", productId)
        .is("tariff_id", null)
        .eq("is_active", true)
        .order("priority", { ascending: false });

      productRules?.forEach((r: any) => {
        // Skip if already covered by tariff-level
        if (!grants.some((g) => g.grant_target_type === r.grant_target_type && g.target_ref === r.target_ref)) {
          grants.push({
            grant_target_type: r.grant_target_type,
            target_ref: r.target_ref,
            target_label: r.target_label || r.target_ref,
            source: "rule",
            scope: "product",
            rule_id: r.id,
            is_active: r.is_active,
            priority: r.priority,
          });
        }
      });

      // 3. Legacy fallback - club mappings
      const { data: clubMappings } = await supabase
        .from("product_club_mappings")
        .select("id, club_id, is_active, telegram_clubs(club_name)")
        .eq("product_id", productId)
        .eq("is_active", true);

      clubMappings?.forEach((m: any) => {
        if (!grants.some((g) => g.grant_target_type === "club" && g.target_ref === m.club_id)) {
          grants.push({
            grant_target_type: "club",
            target_ref: m.club_id,
            target_label: m.telegram_clubs?.club_name || m.club_id,
            source: "legacy",
            scope: "product",
            is_active: m.is_active,
            priority: -1,
          });
        }
      });

      // 4. Legacy fallback - email mappings
      const { data: emailMappings } = await supabase
        .from("product_email_mappings")
        .select("id, email_account_id, is_active, email_accounts(email)")
        .eq("product_id", productId);

      emailMappings?.forEach((m: any) => {
        if (!grants.some((g) => g.grant_target_type === "email" && g.target_ref === m.email_account_id)) {
          grants.push({
            grant_target_type: "email",
            target_ref: m.email_account_id,
            target_label: m.email_accounts?.email || m.email_account_id,
            source: "legacy",
            scope: "product",
            is_active: m.is_active ?? true,
            priority: -1,
          });
        }
      });

      return grants;
    },
    enabled: !!productId,
  });
}
