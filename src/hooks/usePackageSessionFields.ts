/**
 * usePackageSessionFields — token-driven резолвер анкеты pf-полей (V2).
 *
 * Новая модель: набор pf-вопросов определяется токенами `{{pf-XXXXXX}}`
 * в активных версиях DOCX-шаблонов всех документов пакета. Никаких
 * `document_package_item_field_assignments` больше не читается.
 *
 * Дедуп: каждое поле спрашивается один раз на сессию, даже если токен
 * встречается в нескольких документах. Required, label и help берутся
 * строго из каталога (`document_package_field_catalog`).
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type {
  PackageFieldRow,
  SmartDateKind,
  PackageFieldChoice,
} from "@/hooks/usePackageFieldCatalog";
import { usePackageDetectedFields } from "@/hooks/usePackageDetectedFields";

export interface SessionFieldValueRow {
  id: string;
  session_id: string;
  field_catalog_id: string;
  value_text: string | null;
  value_number: number | null;
  value_date: string | null;
  value_datetime: string | null;
  value_time: string | null;
  value_boolean: boolean | null;
  value_json: unknown;
  updated_at: string;
}

export interface DedupedQuestion {
  field: PackageFieldRow;
  /** В скольких шаблонах пакета встречается токен этого поля. */
  occurrences: number;
  /** item_id шаблонов, где поле используется (для CTA/диагностики). */
  itemIds: string[];
  /** Эффективные метаданные для рендера (берутся из каталога). */
  effective: {
    label: string;
    required: boolean;
    help: string | null;
  };
}

const QK = {
  catalog: (templateId: string | null) =>
    ["package-session-catalog", templateId] as const,
  values: (sessionId: string | null) =>
    ["package-session-values", sessionId] as const,
};

export function usePackageSessionFields(
  sessionId: string | null,
  packageTemplateId: string | null,
) {
  const qc = useQueryClient();
  const detected = usePackageDetectedFields(packageTemplateId);

  // Каталог активных pf-полей пакета.
  const catalogQuery = useQuery({
    queryKey: QK.catalog(packageTemplateId),
    queryFn: async (): Promise<PackageFieldRow[]> => {
      if (!packageTemplateId) return [];
      const { data, error } = await supabase
        .from("document_package_field_catalog" as never)
        .select("*")
        .eq("package_template_id", packageTemplateId)
        .eq("is_active", true);
      if (error) throw error;
      return ((data ?? []) as unknown) as PackageFieldRow[];
    },
    enabled: !!packageTemplateId,
  });

  // Резолв вопросов: пересечение каталога и pf-токенов шаблонов.
  const questions = useMemo<DedupedQuestion[]>(() => {
    const fields = catalogQuery.data ?? [];
    if (fields.length === 0) return [];

    const byPublic = new Map<string, PackageFieldRow>();
    for (const f of fields) if (f.public_id) byPublic.set(f.public_id, f);

    const out: DedupedQuestion[] = [];
    for (const pid of detected.allPublicIds) {
      const field = byPublic.get(pid);
      if (!field) continue; // токен без каталога — диагностика в админ-панели
      const itemIds = detected.byPublicId[pid] ?? [];
      out.push({
        field,
        occurrences: itemIds.length,
        itemIds,
        effective: {
          label: field.label,
          required: !!field.required,
          help: field.description ?? null,
        },
      });
    }

    out.sort((a, b) => {
      if (a.effective.required !== b.effective.required) return a.effective.required ? -1 : 1;
      if (a.field.sort_order !== b.field.sort_order) return a.field.sort_order - b.field.sort_order;
      return a.effective.label.localeCompare(b.effective.label);
    });
    return out;
  }, [catalogQuery.data, detected.allPublicIds, detected.byPublicId]);

  const valuesQuery = useQuery({
    queryKey: QK.values(sessionId),
    queryFn: async (): Promise<SessionFieldValueRow[]> => {
      if (!sessionId) return [];
      const { data, error } = await supabase
        .from("document_package_session_field_values" as never)
        .select("*")
        .eq("session_id", sessionId);
      if (error) throw error;
      return ((data ?? []) as unknown) as SessionFieldValueRow[];
    },
    enabled: !!sessionId,
  });

  const valuesByField = useMemo(() => {
    const m = new Map<string, SessionFieldValueRow>();
    for (const v of valuesQuery.data ?? []) m.set(v.field_catalog_id, v);
    return m;
  }, [valuesQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (
      values: Array<{ field_catalog_id: string; raw_value: string | null }>,
    ) => {
      if (!sessionId) throw new Error("session_not_loaded");
      const { data, error } = await supabase.rpc(
        "upsert_session_field_values" as never,
        { _session_id: sessionId, _values: values as unknown } as never,
      );
      if (error) throw error;
      const result = data as { ok: number; errors: Array<Record<string, unknown>> } | null;
      if (result?.errors && result.errors.length > 0) {
        const first = result.errors[0];
        throw new Error(
          `Ошибка сохранения (${(first as { code?: string }).code ?? "unknown"}): ${
            JSON.stringify(first)
          }`,
        );
      }
      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.values(sessionId) });
      toast.success("Значения сохранены");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const progress = useMemo(() => {
    const required = questions.filter((q) => q.effective.required);
    const filledRequired = required.filter((q) => {
      const v = valuesByField.get(q.field.id);
      if (!v) return false;
      return (
        v.value_text != null ||
        v.value_number != null ||
        v.value_date != null ||
        v.value_datetime != null ||
        v.value_time != null ||
        v.value_boolean != null ||
        (v.value_json != null && JSON.stringify(v.value_json) !== "[]")
      );
    }).length;
    return {
      total: questions.length,
      requiredTotal: required.length,
      requiredFilled: filledRequired,
      allRequiredFilled: filledRequired === required.length,
    };
  }, [questions, valuesByField]);

  return {
    questions,
    values: valuesQuery.data ?? [],
    valuesByField,
    isLoading:
      catalogQuery.isLoading || valuesQuery.isLoading || detected.isLoading,
    save: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
    progress,
  };
}

/** Извлечь raw current value из строки сессии в строковый вид для контролов. */
export function readRawValue(
  field: PackageFieldRow,
  v: SessionFieldValueRow | undefined,
): string | null {
  if (!v) return null;
  switch (field.data_type) {
    case "text":
    case "select":
      return v.value_text;
    case "number":
    case "year":
      return v.value_number != null ? String(v.value_number) : null;
    case "date":
      return v.value_date;
    case "datetime":
      return v.value_datetime;
    case "time":
      return v.value_time;
    case "checkbox":
      return v.value_boolean == null ? null : v.value_boolean ? "true" : "false";
    case "multiselect":
      return v.value_json ? JSON.stringify(v.value_json) : null;
    default:
      return null;
  }
}

export type { PackageFieldChoice, SmartDateKind };
