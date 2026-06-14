/**
 * useDocumentItemFieldAssignments — PATCH-PACKAGE-CUSTOM-FIELDS-V1.
 *
 * Назначения полей пакета конкретным шаблонам документов (package_template_items).
 * Источник истины поля — `document_package_field_catalog`; здесь только настройки
 * использования: видимость, обязательность override, label override, секция, порядок.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type AssignmentVisibilityMode = "ask_client" | "admin_only" | "hidden_with_default";

export interface PackageItemFieldAssignmentRow {
  id: string;
  package_template_item_id: string;
  field_catalog_id: string;
  visibility_mode: AssignmentVisibilityMode;
  is_required_override: boolean | null;
  label_override: string | null;
  help_override: string | null;
  section_key: string | null;
  sort_order: number;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface UpsertAssignmentInput {
  id?: string;
  package_template_item_id: string;
  field_catalog_id: string;
  visibility_mode?: AssignmentVisibilityMode;
  is_required_override?: boolean | null;
  label_override?: string | null;
  help_override?: string | null;
  section_key?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

const QK_BY_ITEM = (itemId: string | null) => ["package-item-field-assignments", "item", itemId];
const QK_BY_PACKAGE = (pkgId: string | null) => ["package-item-field-assignments", "package", pkgId];

export function useItemFieldAssignments(packageTemplateItemId: string | null) {
  const qc = useQueryClient();
  const listQuery = useQuery({
    queryKey: QK_BY_ITEM(packageTemplateItemId),
    queryFn: async () => {
      if (!packageTemplateItemId) return [] as PackageItemFieldAssignmentRow[];
      const { data, error } = await supabase
        .from("document_package_item_field_assignments" as never)
        .select("*")
        .eq("package_template_item_id", packageTemplateItemId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown) as PackageItemFieldAssignmentRow[];
    },
    enabled: !!packageTemplateItemId,
  });

  const upsertMutation = useMutation({
    mutationFn: async (input: UpsertAssignmentInput) => {
      const payload = {
        package_template_item_id: input.package_template_item_id,
        field_catalog_id: input.field_catalog_id,
        visibility_mode: input.visibility_mode ?? "ask_client",
        is_required_override: input.is_required_override ?? null,
        label_override: input.label_override ?? null,
        help_override: input.help_override ?? null,
        section_key: input.section_key ?? null,
        sort_order: input.sort_order ?? 100,
        is_active: input.is_active ?? true,
      };
      const { data, error } = await supabase
        .from("document_package_item_field_assignments" as never)
        .upsert(payload as never, {
          onConflict: "package_template_item_id,field_catalog_id",
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as unknown as PackageItemFieldAssignmentRow;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["package-item-field-assignments"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("document_package_item_field_assignments" as never)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["package-item-field-assignments"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    assignments: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    upsert: upsertMutation.mutate,
    upserting: upsertMutation.isPending,
    remove: removeMutation.mutate,
  };
}

/**
 * Загружает assignments для всех шаблонов одного пакета сразу — для подсчёта
 * "Используется в N шаблонах" в PackageFieldsManager и для bulk-операций.
 */
export function usePackageFieldAssignments(packageTemplateId: string | null) {
  const qc = useQueryClient();

  const listQuery = useQuery({
    queryKey: QK_BY_PACKAGE(packageTemplateId),
    queryFn: async () => {
      if (!packageTemplateId) return [] as PackageItemFieldAssignmentRow[];
      // Получаем сначала id шаблонов пакета
      const { data: items, error: itemsErr } = await supabase
        .from("document_package_template_items")
        .select("id")
        .eq("package_template_id", packageTemplateId);
      if (itemsErr) throw itemsErr;
      const itemIds = (items ?? []).map((it) => it.id);
      if (itemIds.length === 0) return [];
      const { data, error } = await supabase
        .from("document_package_item_field_assignments" as never)
        .select("*")
        .in("package_template_item_id", itemIds);
      if (error) throw error;
      return ((data ?? []) as unknown) as PackageItemFieldAssignmentRow[];
    },
    enabled: !!packageTemplateId,
  });

  /** Массово назначить поле всем шаблонам пакета (идемпотентно). */
  const assignToAllMutation = useMutation({
    mutationFn: async (fieldCatalogId: string) => {
      if (!packageTemplateId) throw new Error("packageTemplateId required");
      const { data: items, error: itemsErr } = await supabase
        .from("document_package_template_items")
        .select("id")
        .eq("package_template_id", packageTemplateId);
      if (itemsErr) throw itemsErr;
      const rows = (items ?? []).map((it) => ({
        package_template_item_id: it.id,
        field_catalog_id: fieldCatalogId,
        visibility_mode: "ask_client" as const,
        is_active: true,
        sort_order: 100,
      }));
      if (rows.length === 0) return { affected: 0 };
      const { error } = await supabase
        .from("document_package_item_field_assignments" as never)
        .upsert(rows as never, {
          onConflict: "package_template_item_id,field_catalog_id",
          ignoreDuplicates: true,
        });
      if (error) throw error;
      return { affected: rows.length };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["package-item-field-assignments"] });
      toast.success(`Поле назначено всем шаблонам (${r.affected})`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    assignments: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    assignToAll: assignToAllMutation.mutate,
    assigningToAll: assignToAllMutation.isPending,
  };
}
