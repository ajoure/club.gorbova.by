/**
 * usePackageSessionFields — PATCH-PACKAGE-CUSTOM-FIELDS-V1 (B2).
 *
 * Источник пользовательской анкеты `pf-XXXXXX` для сессии пакета.
 *
 * Контракт:
 *   • Кандидаты вопросов = все `document_package_item_field_assignments`
 *     активных шаблонов пакета с `visibility_mode = 'ask_client'`.
 *   • Дедупликация по `field_catalog_id`: каждый вопрос рендерится один раз,
 *     даже если назначен в N документах. Канонический assignment выбирается
 *     приоритетом: (a) явный override (`is_required_override`, `label_override`),
 *     (b) минимальный `sort_order`, (c) самый ранний `created_at`.
 *   • `effective_required = is_required_override ?? catalog.required`
 *     (override=false снимает каталоговую обязательность).
 *   • Значения хранятся в `document_package_session_field_values` и пишутся
 *     батчем через RPC `upsert_session_field_values`.
 *
 * STOP: не дублирует CRUD каталога (см. `usePackageFieldCatalog`); не пишет
 * напрямую в таблицы — только через RPC.
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
import type {
  PackageItemFieldAssignmentRow,
} from "@/hooks/useDocumentItemFieldAssignments";

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
  /** Канонический assignment, выбранный политикой дедупа. */
  canonicalAssignment: PackageItemFieldAssignmentRow;
  /** Сколько раз поле встречается в шаблонах пакета (для UI-хинта). */
  occurrences: number;
  /** Список item_id, где это поле используется (для CTA). */
  itemIds: string[];
  /** Эффективные метаданные для рендера. */
  effective: {
    label: string;
    required: boolean;
    help: string | null;
  };
}

const QK = {
  questions: (sessionId: string | null, templateId: string | null) =>
    ["package-session-questions", sessionId, templateId] as const,
  values: (sessionId: string | null) =>
    ["package-session-values", sessionId] as const,
};

export function usePackageSessionFields(
  sessionId: string | null,
  packageTemplateId: string | null,
) {
  const qc = useQueryClient();

  const questionsQuery = useQuery({
    queryKey: QK.questions(sessionId, packageTemplateId),
    queryFn: async (): Promise<DedupedQuestion[]> => {
      if (!sessionId || !packageTemplateId) return [];

      // 1. Активный каталог полей пакета.
      const { data: catalog, error: catErr } = await supabase
        .from("document_package_field_catalog" as never)
        .select("*")
        .eq("package_template_id", packageTemplateId)
        .eq("is_active", true);
      if (catErr) throw catErr;
      const fields = ((catalog ?? []) as unknown) as PackageFieldRow[];
      if (fields.length === 0) return [];

      // 2. Все items пакета.
      const { data: items, error: itemsErr } = await supabase
        .from("document_package_template_items")
        .select("id")
        .eq("package_template_id", packageTemplateId);
      if (itemsErr) throw itemsErr;
      const itemIds = (items ?? []).map((r) => r.id);
      if (itemIds.length === 0) return [];

      // 3. Активные ask_client assignments.
      const { data: assignments, error: aErr } = await supabase
        .from("document_package_item_field_assignments" as never)
        .select("*")
        .in("package_template_item_id", itemIds)
        .eq("is_active", true)
        .eq("visibility_mode", "ask_client");
      if (aErr) throw aErr;
      const rows = ((assignments ?? []) as unknown) as PackageItemFieldAssignmentRow[];

      // B5: дедуп и effective override вынесены в pure-utility (vitest-покрыта).
      const { dedupePackageQuestions } = await import("@/utils/packageFieldsDedup");
      const deduped = dedupePackageQuestions(
        fields.map((f) => ({
          id: f.id,
          label: f.label,
          required: !!f.required,
          description: f.description ?? null,
          sort_order: f.sort_order,
        })),
        rows.map((r) => ({
          id: r.id,
          package_template_item_id: r.package_template_item_id,
          field_catalog_id: r.field_catalog_id,
          visibility_mode: r.visibility_mode,
          sort_order: r.sort_order,
          created_at: r.created_at,
          is_required_override: r.is_required_override,
          label_override: r.label_override,
          help_override: r.help_override,
        })),
      );

      const fieldById = new Map(fields.map((f) => [f.id, f]));
      const rowById = new Map(rows.map((r) => [r.id, r]));
      return deduped.map((q): DedupedQuestion => ({
        field: fieldById.get(q.field.id)!,
        canonicalAssignment: rowById.get(q.canonicalAssignment.id)!,
        occurrences: q.occurrences,
        itemIds: q.itemIds,
        effective: q.effective,
      }));
    },
    enabled: !!sessionId && !!packageTemplateId,
  });

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

  // Прогресс по обязательным полям.
  const progress = useMemo(() => {
    const qs = questionsQuery.data ?? [];
    const required = qs.filter((q) => q.effective.required);
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
      total: qs.length,
      requiredTotal: required.length,
      requiredFilled: filledRequired,
      allRequiredFilled: filledRequired === required.length,
    };
  }, [questionsQuery.data, valuesByField]);

  return {
    questions: questionsQuery.data ?? [],
    values: valuesQuery.data ?? [],
    valuesByField,
    isLoading: questionsQuery.isLoading || valuesQuery.isLoading,
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
