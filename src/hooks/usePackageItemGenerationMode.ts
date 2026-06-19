/**
 * usePackageItemGenerationMode — единый источник истины для управления
 * `generation_mode` и `repeat_role_catalog_id` на уровне item-а пакета
 * (`document_package_template_items`).
 *
 * PATCH-C-STAGE-RUNTIME-SAVE-FIX-V1:
 *  - mutation возвращает обновлённую строку через `.select(...).single()`;
 *  - success toast показывается только после подтверждённого response;
 *  - синхронно `setQueryData` для всех читателей item-ов пакета и затем
 *    инвалидирует те же ключи, чтобы UI не мигал старым `single`.
 *
 * Контракт мутации:
 *  - `single` → `generation_mode='single'`, `repeat_role_catalog_id=null`.
 *  - `per_role_person` БЕЗ роли → НЕ пишем в БД (validation state).
 *    Локальный preview-режим держится компонентом.
 *  - `per_role_person` С ролью → пишем оба поля одной транзакцией.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type PackageItemGenerationMode = "single" | "per_role_person";

export interface PackageItemRoleOption {
  id: string;
  role_key: string;
  label: string;
  public_id: string;
  is_active: boolean;
  sort_order: number;
}

const QK_ROLES = (pkgId: string | null) => ["pkg-active-roles-for-repeat", pkgId];
// Все реальные read-models, где появляется generation_mode/repeat_role_catalog_id:
const QK_ITEMS_BOUND = (pkgId: string | null) => ["pkg-bound-templates", pkgId];
const QK_ITEMS_LIST = (pkgId: string | null) => ["document-package-items", pkgId];
const QK_ITEMS_QUESTIONNAIRE = (pkgId: string | null) => ["doc-pkg-template-items-q", pkgId];

export function usePackageActiveRoles(packageTemplateId: string | null) {
  return useQuery({
    queryKey: QK_ROLES(packageTemplateId),
    queryFn: async () => {
      if (!packageTemplateId) return [] as PackageItemRoleOption[];
      const { data, error } = await supabase
        .from("document_package_role_catalog")
        .select("id, role_key, label, public_id, is_active, sort_order")
        .eq("package_template_id", packageTemplateId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PackageItemRoleOption[];
    },
    enabled: !!packageTemplateId,
  });
}

export interface UpdateGenerationModeInput {
  itemId: string;
  packageTemplateId: string | null;
  generation_mode: PackageItemGenerationMode;
  repeat_role_catalog_id: string | null;
}

interface UpdatedItemRow {
  id: string;
  package_template_id: string;
  generation_mode: PackageItemGenerationMode;
  repeat_role_catalog_id: string | null;
}

export function usePackageItemGenerationMode(packageTemplateId: string | null) {
  const qc = useQueryClient();
  const rolesQuery = usePackageActiveRoles(packageTemplateId);

  const mutation = useMutation<UpdatedItemRow, Error, UpdateGenerationModeInput>({
    mutationFn: async (input) => {
      // Защита: per_role_person без роли — не пишем в БД.
      if (input.generation_mode === "per_role_person" && !input.repeat_role_catalog_id) {
        throw new Error("Выберите роль-источник повторения перед сохранением режима.");
      }
      const payload =
        input.generation_mode === "single"
          ? { generation_mode: "single" as const, repeat_role_catalog_id: null }
          : {
              generation_mode: "per_role_person" as const,
              repeat_role_catalog_id: input.repeat_role_catalog_id,
            };
      const { data, error } = await supabase
        .from("document_package_template_items")
        .update(payload)
        .eq("id", input.itemId)
        .select("id, package_template_id, generation_mode, repeat_role_catalog_id")
        .single();
      if (error) throw error;
      if (!data) throw new Error("Сохранение не подтверждено базой данных.");
      return data as UpdatedItemRow;
    },
    onSuccess: (row, vars) => {
      const pkgId = vars.packageTemplateId ?? row.package_template_id ?? null;
      // Точечный patch всех read-models с этим item, чтобы UI не мигал старым `single`.
      const patchList = (key: any[]) => {
        qc.setQueriesData({ queryKey: key }, (prev: any) => {
          if (!Array.isArray(prev)) return prev;
          return prev.map((it: any) =>
            it && it.id === row.id
              ? {
                  ...it,
                  generation_mode: row.generation_mode,
                  repeat_role_catalog_id: row.repeat_role_catalog_id,
                }
              : it,
          );
        });
      };
      patchList(QK_ITEMS_BOUND(pkgId));
      patchList(QK_ITEMS_LIST(pkgId));
      patchList(QK_ITEMS_QUESTIONNAIRE(pkgId));
      // Затем инвалидируем, чтобы свежие данные подтянулись из БД.
      qc.invalidateQueries({ queryKey: QK_ITEMS_BOUND(pkgId) });
      qc.invalidateQueries({ queryKey: QK_ITEMS_LIST(pkgId) });
      qc.invalidateQueries({ queryKey: QK_ITEMS_QUESTIONNAIRE(pkgId) });
      toast.success("Режим генерации сохранён");
    },
    onError: (e: Error) => toast.error(`Не удалось сохранить режим: ${e.message}`),
  });

  return {
    activeRoles: rolesQuery.data ?? [],
    rolesLoading: rolesQuery.isLoading,
    update: mutation.mutate,
    updateAsync: mutation.mutateAsync,
    isSaving: mutation.isPending,
    savingItemId: mutation.isPending ? mutation.variables?.itemId ?? null : null,
  };
}
