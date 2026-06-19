/**
 * usePackageItemGenerationMode — единый источник истины для управления
 * `generation_mode` и `repeat_role_catalog_id` на уровне item-а пакета
 * (`document_package_template_items`).
 *
 * Используется одновременно:
 *  - в карточке документа на вкладке «Анкеты документов» (основной сценарий),
 *  - в admin-вкладке «Шаблоны пакета» (`TemplateBindingControl`).
 *
 * Контракт мутации (правка против Stage C v2):
 *  - `single` → пишем `generation_mode='single'`, `repeat_role_catalog_id=null`.
 *  - `per_role_person` БЕЗ роли → НЕ пишем в БД (validation state).
 *    Локальный preview-режим должен держаться компонентом.
 *  - `per_role_person` С ролью → пишем оба поля одной транзакцией.
 *
 * Никаких side-effects на session/values/roles. Это per-template-item config.
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
const QK_ITEMS = (pkgId: string | null) => ["pkg-bound-templates", pkgId];
const QK_ITEMS_LIST = (pkgId: string | null) => ["document-package-items", pkgId];

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

export function usePackageItemGenerationMode(packageTemplateId: string | null) {
  const qc = useQueryClient();
  const rolesQuery = usePackageActiveRoles(packageTemplateId);

  const mutation = useMutation({
    mutationFn: async (input: UpdateGenerationModeInput) => {
      // Защита: per_role_person без роли — не пишем в БД.
      if (input.generation_mode === "per_role_person" && !input.repeat_role_catalog_id) {
        throw new Error("Выберите роль-источник повторения перед сохранением режима.");
      }
      const payload =
        input.generation_mode === "single"
          ? { generation_mode: "single", repeat_role_catalog_id: null }
          : {
              generation_mode: "per_role_person",
              repeat_role_catalog_id: input.repeat_role_catalog_id,
            };
      const { error } = await supabase
        .from("document_package_template_items")
        .update(payload)
        .eq("id", input.itemId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: QK_ITEMS(vars.packageTemplateId) });
      qc.invalidateQueries({ queryKey: QK_ITEMS_LIST(vars.packageTemplateId) });
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
