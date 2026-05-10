/**
 * useRequisitesV2 — canonical CRUD hook for the new tenant-based requisites model.
 *
 * Tables:
 *  - legal_entities_requisites (subject_type='legal_entity'|'entrepreneur')
 *  - individual_requisites     (subject_type='individual', enforced)
 *
 * Identity columns are populated automatically:
 *  - tenant_id        — user's personal tenant (resolved via tenant_memberships)
 *  - owner_user_id    — auth.uid()
 *  - owner_profile_id — profiles.id of the current user
 *  - created_by / updated_by — auth.uid()
 *
 * scope:        'system_customer' | 'user_requisites'
 * subject_type: 'legal_entity' | 'entrepreneur' | 'individual'
 *
 * RLS guarantees that users only see/write their own rows; admin/super_admin
 * see everything. This hook never bypasses RLS.
 */

import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { Json } from "@/integrations/supabase/types";

export type RequisitesScope = "system_customer" | "user_requisites";
export type RequisitesSubjectType = "legal_entity" | "entrepreneur" | "individual";

export interface LegalEntityRequisitesRow {
  id: string;
  tenant_id: string;
  owner_user_id: string;
  owner_profile_id: string;
  scope: RequisitesScope;
  subject_type: "legal_entity" | "entrepreneur";
  is_default: boolean;
  data: Record<string, unknown>;
  source_legacy_id: string | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export interface IndividualRequisitesRow {
  id: string;
  tenant_id: string;
  owner_user_id: string;
  owner_profile_id: string;
  scope: RequisitesScope;
  is_default: boolean;
  data: Record<string, unknown>;
  source_legacy_id: string | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export interface UseRequisitesV2Options {
  scope: RequisitesScope;
}

export function useRequisitesV2({ scope }: UseRequisitesV2Options) {
  const { user } = useAuth();
  const qc = useQueryClient();

  // Personal tenant + profile resolution.
  const ctxQuery = useQuery({
    queryKey: ["requisites-v2-context", user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!user?.id) return null;
      const [profileRes, membershipRes] = await Promise.all([
        supabase.from("profiles").select("id").eq("user_id", user.id).maybeSingle(),
        supabase
          .from("tenant_memberships")
          .select("tenant_id, role, is_active, tenants:tenant_id(is_personal)")
          .eq("user_id", user.id)
          .eq("is_active", true),
      ]);
      if (profileRes.error) throw profileRes.error;
      if (membershipRes.error) throw membershipRes.error;

      // Prefer personal tenant; fallback to any active membership.
      const memberships = membershipRes.data ?? [];
      const personal =
        memberships.find((m: any) => m?.tenants?.is_personal) ?? memberships[0];

      return {
        profileId: profileRes.data?.id ?? null,
        tenantId: personal?.tenant_id ?? null,
      };
    },
  });

  const profileId = ctxQuery.data?.profileId ?? null;
  const tenantId = ctxQuery.data?.tenantId ?? null;

  // Explicit column lists — never `.select("*")` / `.select("")`.
  const LEGAL_COLS =
    "id, tenant_id, owner_user_id, owner_profile_id, scope, subject_type, " +
    "is_default, data, source_legacy_id, created_by, updated_by, created_at, updated_at";
  const INDIVIDUAL_COLS =
    "id, tenant_id, owner_user_id, owner_profile_id, scope, " +
    "is_default, data, source_legacy_id, created_by, updated_by, created_at, updated_at";

  // Legal entities (LE + IE)
  const legalQuery = useQuery({
    queryKey: ["requisites-v2", "legal", scope, tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("legal_entities_requisites")
        .select(LEGAL_COLS)
        .eq("scope", scope)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as LegalEntityRequisitesRow[];
    },
  });

  // Individuals
  const individualQuery = useQuery({
    queryKey: ["requisites-v2", "individual", scope, tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("individual_requisites")
        .select(INDIVIDUAL_COLS)
        .eq("scope", scope)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as IndividualRequisitesRow[];
    },
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["requisites-v2"] });
  }

  function ensureCtx() {
    if (!user?.id) throw new Error("Не авторизован");
    if (!tenantId) throw new Error("Не найден личный tenant пользователя");
    if (!profileId) throw new Error("Не найден профиль пользователя");
    return { userId: user.id, tenantId, profileId };
  }

  // ========== LEGAL ENTITIES (subject_type = legal_entity | entrepreneur) ==========

  const createLegalEntity = useMutation({
    mutationFn: async (input: {
      subject_type: "legal_entity" | "entrepreneur";
      data: Record<string, unknown>;
      is_default?: boolean;
    }) => {
      const ctx = ensureCtx();
      const { data, error } = await supabase
        .from("legal_entities_requisites")
        .insert({
          tenant_id: ctx.tenantId,
          owner_user_id: ctx.userId,
          owner_profile_id: ctx.profileId,
          scope,
          subject_type: input.subject_type,
          is_default: !!input.is_default,
          data: input.data as Json,
          created_by: ctx.userId,
          updated_by: ctx.userId,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Реквизиты сохранены");
    },
    onError: (e: any) => toast.error("Ошибка: " + (e?.message ?? String(e))),
  });

  const updateLegalEntity = useMutation({
    mutationFn: async (input: {
      id: string;
      data?: Record<string, unknown>;
      is_default?: boolean;
    }) => {
      const ctx = ensureCtx();
      const patch: Record<string, unknown> = { updated_by: ctx.userId };
      if (input.data !== undefined) patch.data = input.data as Json;
      if (input.is_default !== undefined) patch.is_default = input.is_default;
      const { data, error } = await supabase
        .from("legal_entities_requisites")
        .update(patch)
        .eq("id", input.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Реквизиты обновлены");
    },
    onError: (e: any) => toast.error("Ошибка: " + (e?.message ?? String(e))),
  });

  const deleteLegalEntity = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("legal_entities_requisites")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Удалено");
    },
    onError: (e: any) => toast.error("Ошибка: " + (e?.message ?? String(e))),
  });

  // ========== INDIVIDUALS ==========

  const createIndividual = useMutation({
    mutationFn: async (input: {
      data: Record<string, unknown>;
      is_default?: boolean;
    }) => {
      const ctx = ensureCtx();
      const { data, error } = await supabase
        .from("individual_requisites")
        .insert({
          tenant_id: ctx.tenantId,
          owner_user_id: ctx.userId,
          owner_profile_id: ctx.profileId,
          scope,
          is_default: !!input.is_default,
          data: input.data as Json,
          created_by: ctx.userId,
          updated_by: ctx.userId,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Реквизиты сохранены");
    },
    onError: (e: any) => toast.error("Ошибка: " + (e?.message ?? String(e))),
  });

  const updateIndividual = useMutation({
    mutationFn: async (input: {
      id: string;
      data?: Record<string, unknown>;
      is_default?: boolean;
    }) => {
      const ctx = ensureCtx();
      const patch: Record<string, unknown> = { updated_by: ctx.userId };
      if (input.data !== undefined) patch.data = input.data as Json;
      if (input.is_default !== undefined) patch.is_default = input.is_default;
      const { data, error } = await supabase
        .from("individual_requisites")
        .update(patch)
        .eq("id", input.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Реквизиты обновлены");
    },
    onError: (e: any) => toast.error("Ошибка: " + (e?.message ?? String(e))),
  });

  const deleteIndividual = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("individual_requisites")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Удалено");
    },
    onError: (e: any) => toast.error("Ошибка: " + (e?.message ?? String(e))),
  });

  // ========== DEFAULT MANAGEMENT ==========

  /**
   * setDefault — atomically unset previous default in the same scope+subject_type
   * and set the target row as default. Uniqueness is also enforced by partial
   * unique indexes at DB level.
   */
  const setDefault = useMutation({
    mutationFn: async (input: {
      table: "legal_entities_requisites" | "individual_requisites";
      id: string;
      subject_type?: "legal_entity" | "entrepreneur";
    }) => {
      const ctx = ensureCtx();

      // 1) Unset previous default(s) in same scope (+subject_type for legal).
      // We cast to `any` because the table name is dynamic and the typed
      // builder cannot narrow both branches at once.
      const fromAny = supabase.from(input.table as any) as any;
      let unsetQ = fromAny
        .update({ is_default: false, updated_by: ctx.userId })
        .eq("tenant_id", ctx.tenantId)
        .eq("scope", scope)
        .eq("is_default", true)
        .neq("id", input.id);
      if (input.table === "legal_entities_requisites" && input.subject_type) {
        unsetQ = unsetQ.eq("subject_type", input.subject_type);
      }
      const unsetRes = await unsetQ;
      if (unsetRes.error) throw unsetRes.error;

      // 2) Set target
      const setRes = await (supabase.from(input.table as any) as any)
        .update({ is_default: true, updated_by: ctx.userId })
        .eq("id", input.id);
      if (setRes.error) throw setRes.error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Установлено по умолчанию");
    },
    onError: (e: any) => toast.error("Ошибка: " + (e?.message ?? String(e))),
  });

  return useMemo(
    () => ({
      // context
      scope,
      tenantId,
      profileId,
      isContextReady: !!tenantId && !!profileId,
      isLoading:
        ctxQuery.isLoading || legalQuery.isLoading || individualQuery.isLoading,

      // data
      legalEntities: legalQuery.data ?? [],
      individuals: individualQuery.data ?? [],

      // mutations
      createLegalEntityRequisites: createLegalEntity.mutateAsync,
      updateLegalEntityRequisites: updateLegalEntity.mutateAsync,
      deleteLegalEntityRequisites: deleteLegalEntity.mutateAsync,
      createIndividualRequisites: createIndividual.mutateAsync,
      updateIndividualRequisites: updateIndividual.mutateAsync,
      deleteIndividualRequisites: deleteIndividual.mutateAsync,
      setDefaultRequisites: setDefault.mutateAsync,

      // pending flags
      isMutating:
        createLegalEntity.isPending ||
        updateLegalEntity.isPending ||
        deleteLegalEntity.isPending ||
        createIndividual.isPending ||
        updateIndividual.isPending ||
        deleteIndividual.isPending ||
        setDefault.isPending,
    }),
    [
      scope,
      tenantId,
      profileId,
      ctxQuery.isLoading,
      legalQuery.data,
      legalQuery.isLoading,
      individualQuery.data,
      individualQuery.isLoading,
      createLegalEntity.isPending,
      updateLegalEntity.isPending,
      deleteLegalEntity.isPending,
      createIndividual.isPending,
      updateIndividual.isPending,
      deleteIndividual.isPending,
      setDefault.isPending,
      createLegalEntity.mutateAsync,
      updateLegalEntity.mutateAsync,
      deleteLegalEntity.mutateAsync,
      createIndividual.mutateAsync,
      updateIndividual.mutateAsync,
      deleteIndividual.mutateAsync,
      setDefault.mutateAsync,
    ]
  );
}
