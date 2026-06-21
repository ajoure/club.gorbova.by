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
 *
 * PATCH-DPIRA-METADATA-MERGE-V1:
 *  Replace-save больше не теряет существующие верхнеуровневые ключи
 *  `metadata` (`custom`, `position_gender`, …). prevMeta снимается до
 *  архивации и переносится в новую активную запись с учётом контракта
 *  `position` / `position_gender` / `custom`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  mergeAssignmentMetadataWithCustom,
  readAssignmentCustomValues,
} from "@/lib/documents/assignmentCustomFieldsSpec";

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
  /**
   * Position contract (PATCH-DPIRA-METADATA-MERGE-V1):
   *   undefined        — не трогаем существующее metadata.position
   *   null | ""        — удаляем metadata.position
   *   non-empty string — сохраняем
   */
  position?: string | null;
  /**
   * Position gender — тот же контракт, что у position.
   */
  position_gender?: string | null;
  /**
   * Custom values (role.assignment_custom_fields).
   *   undefined        — не трогаем metadata.custom
   *   Record<key, str> — merge через mergeAssignmentMetadataWithCustom
   */
  custom?: Record<string, string>;
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
      return (data ?? []) as unknown as ItemRoleAssignmentRow[];
    },
    enabled: !!packageSessionId && !!packageTemplateItemId,
  });

  const saveMutation = useMutation({
    mutationFn: async (assignments: ItemAssignmentInput[]) => {
      if (!packageSessionId || !packageTemplateItemId) {
        throw new Error("Не выбран документ пакета");
      }
      if (!user) throw new Error("Не авторизован");

      // 0. Снимаем prevMeta активных строк до архивации.
      const prevByKey = new Map<string, Record<string, unknown>>();
      for (const row of listQuery.data ?? []) {
        if (!row.role_catalog_id || !row.person_id) continue;
        const key = `${row.role_catalog_id}|${row.person_id}`;
        prevByKey.set(
          key,
          (row.metadata && typeof row.metadata === "object"
            ? (row.metadata as Record<string, unknown>)
            : {}) as Record<string, unknown>,
        );
      }

      // 1. Архивируем все текущие активные.
      const { error: archErr } = await supabase
        .from("document_package_item_role_assignments" as any)
        .update({ is_active: false, updated_by: user.id })
        .eq("package_session_id", packageSessionId)
        .eq("package_template_item_id", packageTemplateItemId)
        .eq("is_active", true);
      if (archErr) throw archErr;

      // 2. Вставляем новые активные с merged metadata.
      const rows = assignments
        .filter((a) => a.role_catalog_id && a.person_id)
        .map((a, idx) => {
          const prev = prevByKey.get(`${a.role_catalog_id}|${a.person_id}`) ?? {};
          const base: Record<string, unknown> = { ...prev };
          const prevCustom = readAssignmentCustomValues(prev);
          delete base.custom;

          // position contract
          if (a.position !== undefined) {
            const t = typeof a.position === "string" ? a.position.trim() : "";
            if (t.length > 0) base.position = t;
            else delete base.position;
          }
          // position_gender contract
          if (a.position_gender !== undefined) {
            const g = typeof a.position_gender === "string" ? a.position_gender.trim() : "";
            if (g.length > 0) base.position_gender = g;
            else delete base.position_gender;
          }

          // custom: undefined → сохраняем prevCustom; иначе merge новых в prev.
          // Stage E.1a contract: keepEmpty=true → пустая строка означает
          // явную очистку значения (metadata.custom[key] = ""), а не удаление ключа.
          const customForMerge =
            a.custom === undefined ? prevCustom : { ...prevCustom, ...a.custom };
          const meta = mergeAssignmentMetadataWithCustom(base, customForMerge, { keepEmpty: true });

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
      // hotfix 2026-06-17: разблокировать кнопку «Сформировать пакет» без переключения вкладок.
      qc.invalidateQueries({ queryKey: ["pkg-gen-role-assignments"] });
      qc.invalidateQueries({ queryKey: ["doc-pkg-session-q"] });
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
