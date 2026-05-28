/**
 * useDocumentPackageSession — Sprint 1 persisted session for document packages.
 *
 * Replaces localStorage-based questionnaire with a backend-persisted state
 * in `document_package_sessions` + `document_package_session_participants`.
 *
 * Scope contract (Sprint 1):
 *   • One session per (profile_id, package_template_id). When binding to
 *     entitlement/order is introduced (Sprint 2), uniqueness scope расширится.
 *   • Single legal entity per session (single-select). Lock after first
 *     successful generation (Sprint 2 — здесь только колонки/RPC уже готовы).
 *   • Participants — список физлиц с привязкой к role_key из
 *     `document_package_role_catalog`.
 *
 * STOP: НЕ менять fields_registry, billing resolver,
 * canonical-document-generate-strict signature. Никаких write-операций к
 * orders/subscriptions/entitlements/access.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type PackageSessionStatus = "draft" | "ready" | "locked";

export type PackageSessionDisplayStatus =
  | "not_saved"
  | "saved"
  | "locked"
  | "requires_fill";

export interface PackageRoleDef {
  id: string;
  role_key: string;
  label: string;
  description: string | null;
  allowed_entity_types: string[];
  required: boolean;
  min_count: number | null;
  max_count: number | null;
  sort_order: number;
}

export interface PackageParticipant {
  id: string;
  role_key: string;
  role_catalog_id: string | null;
  entity_type: "legal_entity" | "person" | string;
  legal_entity_id: string | null;
  person_id: string | null;
  is_primary: boolean;
  /** Sprint 3C: участник-специфичный JSONB. Канонически содержит {position?: string}. */
  metadata: Record<string, unknown> | null;
}

export interface PackageSessionRow {
  id: string;
  profile_id: string;
  package_template_id: string;
  status: PackageSessionStatus;
  selected_legal_entity_id: string | null;
  legal_entity_locked_at: string | null;
  updated_at: string;
  created_at: string;
}

export interface PersonAssignment {
  person_id: string;
  role_key: string;
  role_catalog_id: string | null;
}

export interface SaveSessionInput {
  selectedLegalEntityId: string | null;
  personAssignments: PersonAssignment[];
}

const PACKAGE_TEMPLATE_QK = (code: string) => ["doc-package-template-by-code", code];
const ROLE_CATALOG_QK = (templateId: string | null) => ["doc-package-role-catalog", templateId];
const SESSION_QK = (profileId: string | null, templateId: string | null) =>
  ["doc-package-session", profileId, templateId];
const PARTICIPANTS_QK = (sessionId: string | null) =>
  ["doc-package-session-participants", sessionId];

/** Resolve package template UUID by stable `code` (e.g. "ideology"). */
function usePackageTemplateByCode(code: string) {
  return useQuery({
    queryKey: PACKAGE_TEMPLATE_QK(code),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_package_templates")
        .select("id, code, name, is_system, is_active")
        .eq("code", code)
        .eq("is_system", true)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

function useProfileId() {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ["user-profile", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("id")
        .eq("user_id", user.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
  return { profileId: q.data?.id ?? null, isLoading: q.isLoading };
}

export function useDocumentPackageSession(packageCode: string) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { profileId } = useProfileId();
  const templateQuery = usePackageTemplateByCode(packageCode);
  const templateId = templateQuery.data?.id ?? null;

  // Role catalog (read-only)
  const roleCatalogQuery = useQuery({
    queryKey: ROLE_CATALOG_QK(templateId),
    queryFn: async () => {
      if (!templateId) return [] as PackageRoleDef[];
      const { data, error } = await supabase
        .from("document_package_role_catalog")
        .select("id, role_key, label, description, allowed_entity_types, required, min_count, max_count, sort_order")
        .eq("package_template_id", templateId)
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as PackageRoleDef[];
    },
    enabled: !!templateId,
    staleTime: 60 * 1000,
  });

  // Session (single per profile + template)
  const sessionQuery = useQuery({
    queryKey: SESSION_QK(profileId, templateId),
    queryFn: async () => {
      if (!profileId || !templateId) return null;
      const { data, error } = await supabase
        .from("document_package_sessions")
        .select("id, profile_id, package_template_id, status, selected_legal_entity_id, legal_entity_locked_at, created_at, updated_at")
        .eq("profile_id", profileId)
        .eq("package_template_id", templateId)
        .maybeSingle();
      if (error) throw error;
      return (data as PackageSessionRow | null) ?? null;
    },
    enabled: !!profileId && !!templateId,
  });

  const sessionId = sessionQuery.data?.id ?? null;

  // Participants
  const participantsQuery = useQuery({
    queryKey: PARTICIPANTS_QK(sessionId),
    queryFn: async () => {
      if (!sessionId) return [] as PackageParticipant[];
      const { data, error } = await supabase
        .from("document_package_session_participants")
        .select("id, role_key, role_catalog_id, entity_type, legal_entity_id, person_id, is_primary")
        .eq("package_session_id", sessionId);
      if (error) throw error;
      return (data ?? []) as PackageParticipant[];
    },
    enabled: !!sessionId,
  });

  // Save mutation: upsert session + replace participants atomically (best-effort).
  const saveMutation = useMutation({
    mutationFn: async (input: SaveSessionInput) => {
      if (!profileId) throw new Error("Профиль не найден");
      if (!templateId) throw new Error("Шаблон пакета не найден");
      if (!user) throw new Error("Не авторизован");

      const isLocked = !!sessionQuery.data?.legal_entity_locked_at;
      if (isLocked && sessionQuery.data?.selected_legal_entity_id &&
          input.selectedLegalEntityId !== sessionQuery.data.selected_legal_entity_id) {
        throw new Error("Юрлицо закреплено и не может быть изменено");
      }

      // 1. Upsert session row
      let currentSessionId = sessionId;
      if (!currentSessionId) {
        const { data: inserted, error: insErr } = await supabase
          .from("document_package_sessions")
          .insert({
            profile_id: profileId,
            package_template_id: templateId,
            user_id: user.id,
            created_by: user.id,
            updated_by: user.id,
            status: "draft",
            selected_legal_entity_id: input.selectedLegalEntityId,
          })
          .select("id")
          .single();
        if (insErr) throw insErr;
        currentSessionId = inserted.id;
      } else {
        const { error: updErr } = await supabase
          .from("document_package_sessions")
          .update({
            selected_legal_entity_id: input.selectedLegalEntityId,
            updated_by: user.id,
          })
          .eq("id", currentSessionId);
        if (updErr) throw updErr;
      }

      // 2. Replace participants: simple delete-then-insert (Sprint 1 fits within RLS).
      const { error: delErr } = await supabase
        .from("document_package_session_participants")
        .delete()
        .eq("package_session_id", currentSessionId);
      if (delErr) throw delErr;

      const rows = input.personAssignments
        .filter((a) => a.person_id && a.role_key)
        .map((a) => ({
          package_session_id: currentSessionId!,
          role_key: a.role_key,
          role_catalog_id: a.role_catalog_id,
          entity_type: "person",
          person_id: a.person_id,
          legal_entity_id: null,
          created_by: user.id,
          updated_by: user.id,
        }));

      if (rows.length > 0) {
        const { error: insPartErr } = await supabase
          .from("document_package_session_participants")
          .insert(rows);
        if (insPartErr) throw insPartErr;
      }

      return currentSessionId!;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: SESSION_QK(profileId, templateId) }),
        queryClient.invalidateQueries({ queryKey: PARTICIPANTS_QK(sessionId) }),
      ]);
      // After session id may be new — invalidate broader
      await queryClient.invalidateQueries({ queryKey: ["doc-package-session-participants"] });
      // Drop legacy localStorage draft after first successful backend save.
      try {
        localStorage.removeItem("document_package_questionnaire_ideology_v1");
      } catch {
        /* noop */
      }
      toast.success("Анкета сохранена");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Display status
  const displayStatus: PackageSessionDisplayStatus = useMemo(() => {
    const s = sessionQuery.data;
    if (!s) return "not_saved";
    if (s.legal_entity_locked_at) return "locked";
    // Required roles satisfied?
    const required = (roleCatalogQuery.data ?? []).filter((r) => r.required);
    const participants = participantsQuery.data ?? [];
    const hasEntity = !!s.selected_legal_entity_id;
    const allRequiredFilled = required.every((r) => {
      if (r.role_key === "package_company") return hasEntity;
      const count = participants.filter((p) => p.role_key === r.role_key).length;
      const min = r.min_count ?? (r.required ? 1 : 0);
      return count >= min;
    });
    return allRequiredFilled ? "saved" : "requires_fill";
  }, [sessionQuery.data, roleCatalogQuery.data, participantsQuery.data]);

  return {
    profileId,
    template: templateQuery.data ?? null,
    templateId,
    roleCatalog: roleCatalogQuery.data ?? [],
    session: sessionQuery.data ?? null,
    participants: participantsQuery.data ?? [],
    isLoading:
      templateQuery.isLoading ||
      roleCatalogQuery.isLoading ||
      sessionQuery.isLoading ||
      (!!sessionId && participantsQuery.isLoading),
    isLocked: !!sessionQuery.data?.legal_entity_locked_at,
    displayStatus,
    save: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
  };
}
