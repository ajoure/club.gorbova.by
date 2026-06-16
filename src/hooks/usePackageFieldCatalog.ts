/**
 * usePackageFieldCatalog — PATCH-PACKAGE-CUSTOM-FIELDS-V1.
 *
 * CRUD per-package для `document_package_field_catalog`.
 * Канонический токен поля в Word: `{{pf-XXXXXX}}`.
 *
 * Запреты (гарантированы триггерами БД):
 *  • `public_id`, `data_type`, `field_key`, `package_template_id` — immutable;
 *  • DELETE заблокирован, если есть assignments или session values, либо is_system=true.
 *
 * Источник истины поля — только эта таблица. UI назначений (PackageFieldsAssignmentManager)
 * не дублирует public_id / data_type / choices / default_kind / global label.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type PackageFieldDataType =
  | "text"
  | "number"
  | "date"
  | "datetime"
  | "time"
  | "year"
  | "select"
  | "multiselect"
  | "checkbox";

export type PackageFieldUsageScope = "package_all" | "questionnaire_only" | "documents_only";

export type SmartDateKind =
  | "none"
  | "today"
  | "tomorrow"
  | "yesterday"
  | "first_day_of_week"
  | "last_day_of_week"
  | "first_day_of_month"
  | "last_day_of_month"
  | "first_day_of_quarter"
  | "last_day_of_quarter"
  | "first_day_of_year"
  | "last_day_of_year"
  // PATCH-PACKAGE-CUSTOM-FIELDS-V1 итерация 2 (Часть B, 11 новых):
  // 4 month
  | "first_day_of_prev_month"
  | "last_day_of_prev_month"
  | "first_day_of_next_month"
  | "last_day_of_next_month"
  // 4 quarter
  | "first_day_of_prev_quarter"
  | "last_day_of_prev_quarter"
  | "first_day_of_next_quarter"
  | "last_day_of_next_quarter"
  // 3 year (только для data_type='year', возвращают 4-значное число строкой)
  | "prev_year"
  | "current_year"
  | "next_year"
  | "session_created_date"
  | "generation_date";

export interface PackageFieldChoice {
  value: string;
  label: string;
  sort_order?: number;
  is_archived?: boolean;
}

export interface PackageFieldOptions {
  choices?: PackageFieldChoice[];
  default_kind?: SmartDateKind;
  format_hint?: string;
  separator?: string;
  true_label?: string;
  false_label?: string;
  modifier_defaults?: Record<string, unknown>;
}

export interface PackageFieldRow {
  id: string;
  public_id: string;
  package_template_id: string;
  field_key: string;
  label: string;
  description: string | null;
  data_type: PackageFieldDataType;
  options: PackageFieldOptions;
  usage_scope: PackageFieldUsageScope;
  client_visible: boolean;
  admin_editable: boolean;
  auto_assign_to_new_items: boolean;
  required: boolean;
  sort_order: number;
  is_active: boolean;
  is_system: boolean;
  metadata: Record<string, unknown>;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface UpsertPackageFieldInput {
  id?: string;
  package_template_id: string;
  field_key?: string;
  label: string;
  description?: string | null;
  data_type: PackageFieldDataType;
  options?: PackageFieldOptions;
  usage_scope?: PackageFieldUsageScope;
  client_visible?: boolean;
  admin_editable?: boolean;
  auto_assign_to_new_items?: boolean;
  required?: boolean;
  sort_order?: number;
  is_active?: boolean;
  expected_version?: number;
}

const QK = (packageTemplateId: string | null) => ["package-field-catalog", packageTemplateId];

function slugifyFieldKey(label: string): string {
  const translit: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
    з: "z", и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o",
    п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c",
    ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  const base = label
    .toLowerCase()
    .split("")
    .map((ch) => translit[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return base.length > 0 ? base : `pf_${Date.now().toString(36)}`;
}

export function usePackageFieldCatalog(packageTemplateId: string | null) {
  const qc = useQueryClient();

  const listQuery = useQuery({
    queryKey: QK(packageTemplateId),
    queryFn: async () => {
      if (!packageTemplateId) return [] as PackageFieldRow[];
      const { data, error } = await supabase
        .from("document_package_field_catalog" as never)
        .select("*")
        .eq("package_template_id", packageTemplateId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown) as PackageFieldRow[];
    },
    enabled: !!packageTemplateId,
  });

  const upsertMutation = useMutation({
    mutationFn: async (input: UpsertPackageFieldInput) => {
      const label = input.label.trim();
      if (!label) throw new Error("Название поля обязательно");

      let fieldKey = input.field_key?.trim();
      if (!input.id && !fieldKey) {
        // generate unique field_key for new field
        const base = slugifyFieldKey(label);
        const { data: existing } = await supabase
          .from("document_package_field_catalog" as never)
          .select("field_key")
          .eq("package_template_id", input.package_template_id);
        const taken = new Set(((existing ?? []) as Array<{ field_key: string }>).map((r) => r.field_key));
        let key = base;
        let i = 2;
        while (taken.has(key)) {
          key = `${base}_${i}`;
          i += 1;
        }
        fieldKey = key;
      }

      const payload: Record<string, unknown> = {
        ...(input.id ? { id: input.id } : {}),
        package_template_id: input.package_template_id,
        ...(fieldKey ? { field_key: fieldKey } : {}),
        label,
        description: input.description ?? null,
        data_type: input.data_type,
        options: input.options ?? {},
        usage_scope: input.usage_scope ?? "package_all",
        client_visible: input.client_visible ?? true,
        admin_editable: input.admin_editable ?? true,
        auto_assign_to_new_items: input.auto_assign_to_new_items ?? false,
        required: input.required ?? false,
        sort_order: input.sort_order ?? 100,
        is_active: input.is_active ?? true,
      };

      const { data, error } = await supabase.rpc("upsert_package_field_catalog" as never, {
        _payload: payload,
        _expected_version: input.expected_version ?? null,
      } as never);
      if (error) throw error;
      return data as unknown as PackageFieldRow;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK(packageTemplateId) });
      toast.success("Поле сохранено");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("document_package_field_catalog" as never)
        .update({ is_active: false } as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK(packageTemplateId) });
      toast.success("Поле архивировано");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const restoreMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("document_package_field_catalog" as never)
        .update({ is_active: true } as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK(packageTemplateId) });
      toast.success("Поле восстановлено");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("document_package_field_catalog" as never)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK(packageTemplateId) });
      toast.success("Поле удалено");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function loadDependencyReport(fieldId: string) {
    const { data, error } = await supabase.rpc(
      "report_package_field_dependencies" as never,
      { _field_id: fieldId } as never,
    );
    if (error) throw error;
    return data as {
      templates_using_token: number;
      active_sessions_with_value: number;
      historical_sessions_with_value: number;
      generation_snapshots_count: number;
    };
  }

  return {
    fields: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    upsert: upsertMutation.mutate,
    upserting: upsertMutation.isPending,
    archive: archiveMutation.mutate,
    restore: restoreMutation.mutate,
    remove: deleteMutation.mutate,
    loadDependencyReport,
  };
}
