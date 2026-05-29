/**
 * useDocumentItemRoleAssignments — Sprint 3G.
 *
 * Document-level role assignments. SOT таблица:
 * `document_package_item_role_assignments`.
 *
 * Один человек может быть назначен на разные роли в разных шаблонах
 * одного пакета. Одна роль может быть назначена нескольким физлицам
 * в одном документе. Удаление — soft (is_active=false).
 *
 * Scope: чтение и replace-save для пары (package_session_id, package_template_item_id).
 *
 * STOP:
 *  • НЕ трогаем canonical-document-generate-strict, Gotenberg, billing resolver.
 *  • НЕ пишем в `document_package_session_participants` (legacy).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface ItemRoleAssignmentRow {
  id: string;
  package_session_id: string;
  package_template_item_id: string;
  role_catalog_id: string;
  person_id: string | null;
  metadata: Record<string, unknown> | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ItemAssignmentInput {
  role_catalog_id: string;
  person_id: string;
  position?: string | null;
  sort_order?: number;
}

const QK = (sessionId: string | null, itemId: string | null) =>
  ["doc-item-role-assignments", sessionId, itemId];

export function useDocumentItemRoleAssignments(
  packageSessionId: string | null,
  packageTemplateItemId: string | null,
) {
  const qc = useQueryClient();
  const { user } = useAuth();

  const listQuery = useQuery({
    queryKey: QK(packageSessionId, packageTemplateItemId),
    queryFn: async () => {
      if (!packageSessionId || !packageTemplateItemId) return [] as ItemRoleAssignmentRow[];
      const { data, error } = await supabase
        .from("document_package_item_role_assignments" as any)
        .select("*")
        .eq("package_session_id", packageSessionId)
        .eq("package_template_item_id", packageTemplateItemId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ItemRoleAssignmentRow[];
    },
    enabled: !!packageSessionId && !!packageTemplateItemId,
  });

  /**
   * Replace-save для одного документа пакета.
   * Old approach: soft-archive все активные + insert новые. Атомарность —
   * backlog (RPC `replace_item_role_assignments`).
   */
  const saveMutation = useMutation({
    mutationFn: async (assignments: ItemAssignmentInput[]) => {
      if (!packageSessionId || !packageTemplateItemId) {
        throw new Error("Не выбран документ пакета");
      }
      if (!user) throw new Error("Не авторизован");

      // 1. Архивируем все текущие активные (нельзя hard-delete политикой).
      const { error: archErr } = await supabase
        .from("document_package_item_role_assignments" as any)
        .update({ is_active: false, updated_by: user.id })
        .eq("package_session_id", packageSessionId)
        .eq("package_template_item_id", packageTemplateItemId)
        .eq("is_active", true);
      if (archErr) throw archErr;

      // 2. Вставляем новые активные.
      const rows = assignments
        .filter((a) => a.role_catalog_id && a.person_id)
        .map((a, idx) => {
          const pos = typeof a.position === "string" ? a.position.trim() : "";
          const meta: Record<string, string> = pos ? { position: pos } : {};
          return {
            package_session_id: packageSessionId,
            package_template_item_id: packageTemplateItemId,
            role_catalog_id: a.role_catalog_id,
            person_id: a.person_id,
            metadata: meta,
            sort_order: a.sort_order ?? (idx + 1) * 10,
            is_active: true,
            created_by: user.id,
            updated_by: user.id,
          };
        });

      if (rows.length > 0) {
        const { error: insErr } = await supabase
          .from("document_package_item_role_assignments" as any)
          .insert(rows);
        if (insErr) throw insErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK(packageSessionId, packageTemplateItemId) });
      toast.success("Анкета документа сохранена");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    assignments: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    save: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
  };
}
