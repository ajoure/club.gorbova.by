/**
 * usePackageSessionFields — token-driven резолвер анкеты pf-полей (V3).
 *
 * V3: поддержка per-document значений полей.
 *   • `valuesByField` — session-level (общие) значения (item_id IS NULL).
 *   • `valuesByItemField[itemId][fieldId]` — per-item override.
 *   • Effective value для item = per-item override → fallback к session-level.
 *   • `save({ field_catalog_id, value, package_template_item_id? })`.
 *
 * Дедуп вопросов и каталог — без изменений.
 */
import { useCallback, useMemo } from "react";
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
  package_template_item_id: string | null;
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
  occurrences: number;
  itemIds: string[];
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

export interface SaveFieldValueInput {
  field_catalog_id: string;
  value: string | null;
  /** NULL/omitted = session-level; uuid = per-document override. */
  package_template_item_id?: string | null;
}

function isFilled(v: SessionFieldValueRow | undefined): boolean {
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
}

export function usePackageSessionFields(
  sessionId: string | null,
  packageTemplateId: string | null,
) {
  const qc = useQueryClient();
  const detected = usePackageDetectedFields(packageTemplateId);

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

  const questions = useMemo<DedupedQuestion[]>(() => {
    const fields = catalogQuery.data ?? [];
    if (fields.length === 0) return [];

    const byPublic = new Map<string, PackageFieldRow>();
    for (const f of fields) if (f.public_id) byPublic.set(f.public_id, f);

    const out: DedupedQuestion[] = [];
    for (const pid of detected.allPublicIds) {
      const field = byPublic.get(pid);
      if (!field) continue;
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

  /**
   * Orphan questions: pf-поля каталога пакета, отсутствующие ВО ВСЕХ активных DOCX-версиях.
   * Это диагностика уровня пакета:
   *   • не входят в required-gate;
   *   • не считаются в X/Y документа;
   *   • не попадают в snapshot/DOCX;
   *   • сохраняются ТОЛЬКО session-level (item_id IS NULL);
   *   • никогда не дублируются в карточках документов.
   */
  const orphanQuestions = useMemo<DedupedQuestion[]>(() => {
    const fields = catalogQuery.data ?? [];
    if (fields.length === 0) return [];
    const detectedSet = new Set(detected.allPublicIds);
    const out: DedupedQuestion[] = [];
    for (const f of fields) {
      if (!f.public_id) continue;
      if (detectedSet.has(f.public_id)) continue;
      out.push({
        field: f,
        occurrences: 0,
        itemIds: [],
        effective: {
          label: f.label,
          // orphan НЕ участвует в required-gate, метку required игнорируем для готовности,
          // но визуально оставляем как есть для админской осведомлённости.
          required: !!f.required,
          help: f.description ?? null,
        },
      });
    }
    out.sort((a, b) => {
      if (a.field.sort_order !== b.field.sort_order) return a.field.sort_order - b.field.sort_order;
      return a.effective.label.localeCompare(b.effective.label);
    });
    return out;
  }, [catalogQuery.data, detected.allPublicIds]);

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

  /** Session-level (общие) значения: item_id IS NULL */
  const valuesByField = useMemo(() => {
    const m = new Map<string, SessionFieldValueRow>();
    for (const v of valuesQuery.data ?? []) {
      if (v.package_template_item_id == null) m.set(v.field_catalog_id, v);
    }
    return m;
  }, [valuesQuery.data]);

  /** Per-item overrides: itemId → (fieldId → row) */
  const valuesByItemField = useMemo(() => {
    const m = new Map<string, Map<string, SessionFieldValueRow>>();
    for (const v of valuesQuery.data ?? []) {
      if (v.package_template_item_id != null) {
        const inner = m.get(v.package_template_item_id) ?? new Map();
        inner.set(v.field_catalog_id, v);
        m.set(v.package_template_item_id, inner);
      }
    }
    return m;
  }, [valuesQuery.data]);

  /** Effective value для конкретного item: per-item → fallback к session-level. */
  const getEffectiveValue = (
    fieldId: string,
    itemId: string | null,
  ): SessionFieldValueRow | undefined => {
    if (itemId) {
      const perItem = valuesByItemField.get(itemId)?.get(fieldId);
      if (perItem) return perItem;
    }
    return valuesByField.get(fieldId);
  };

  const saveMutation = useMutation({
    mutationFn: async (values: SaveFieldValueInput[]) => {
      if (!sessionId) throw new Error("session_not_loaded");
      const payload = values.map((v) => ({
        field_catalog_id: v.field_catalog_id,
        value: v.value,
        package_template_item_id: v.package_template_item_id ?? null,
      }));
      const { data, error } = await supabase.rpc(
        "upsert_session_field_values" as never,
        { _session_id: sessionId, _values: payload as unknown } as never,
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
      // hotfix 2026-06-17: разблокировать кнопку «Сформировать пакет» без переключения вкладок.
      qc.invalidateQueries({ queryKey: ["pkg-gen-role-assignments"] });
      qc.invalidateQueries({ queryKey: ["doc-pkg-session-q"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * Reset per-item override → fallback к session-level.
   * Канонический DELETE через RPC `delete_session_field_value`.
   * Не используется для очистки session-level (RPC guard).
   */
  const resetOverrideMutation = useMutation({
    mutationFn: async (input: { field_catalog_id: string; package_template_item_id: string }) => {
      if (!sessionId) throw new Error("session_not_loaded");
      const { data, error } = await supabase.rpc(
        "delete_session_field_value" as never,
        {
          _session_id: sessionId,
          _field_catalog_id: input.field_catalog_id,
          _package_template_item_id: input.package_template_item_id,
        } as never,
      );
      if (error) throw error;
      return data as { deleted: number };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: QK.values(sessionId) });
      qc.invalidateQueries({ queryKey: ["pkg-gen-role-assignments"] });
      qc.invalidateQueries({ queryKey: ["doc-pkg-session-q"] });
      if ((res?.deleted ?? 0) > 0) {
        toast.success("Возвращено к общему значению");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Global progress: session-level required filled. */
  const progress = useMemo(() => {
    const required = questions.filter((q) => q.effective.required);
    const filledRequired = required.filter((q) => isFilled(valuesByField.get(q.field.id))).length;
    return {
      total: questions.length,
      requiredTotal: required.length,
      requiredFilled: filledRequired,
      allRequiredFilled: filledRequired === required.length,
    };
  }, [questions, valuesByField]);

  /**
   * Per-item progress: required pf-поле этого item заполнено, если есть per-item
   * value ИЛИ session-level value.
   */
  const getItemProgress = (itemId: string) => {
    const publicIdsInItem = detected.byItemId[itemId] ?? [];
    const fieldsInItem = questions.filter((q) =>
      publicIdsInItem.includes(q.field.public_id),
    );
    const requiredInItem = fieldsInItem.filter((q) => q.effective.required);
    const filledRequired = requiredInItem.filter((q) =>
      isFilled(getEffectiveValue(q.field.id, itemId)),
    ).length;
    const filledTotal = fieldsInItem.filter((q) =>
      isFilled(getEffectiveValue(q.field.id, itemId)),
    ).length;
    return {
      total: fieldsInItem.length,
      filled: filledTotal,
      requiredTotal: requiredInItem.length,
      requiredFilled: filledRequired,
      allRequiredFilled: filledRequired === requiredInItem.length,
    };
  };

  /** Список вопросов для конкретного item (в порядке появления токена в шаблоне). */
  const getItemQuestions = (itemId: string): DedupedQuestion[] => {
    const publicIdsInItem = detected.byItemId[itemId] ?? [];
    const byPid = new Map(questions.map((q) => [q.field.public_id, q]));
    const out: DedupedQuestion[] = [];
    for (const pid of publicIdsInItem) {
      const q = byPid.get(pid);
      if (q) out.push(q);
    }
    return out;
  };

  return {
    questions,
    orphanQuestions,
    values: valuesQuery.data ?? [],
    valuesByField,
    valuesByItemField,
    getEffectiveValue,
    getItemQuestions,
    getItemProgress,
    isLoading:
      catalogQuery.isLoading || valuesQuery.isLoading || detected.isLoading,
    save: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
    resetOverride: resetOverrideMutation.mutateAsync,
    isResettingOverride: resetOverrideMutation.isPending,
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
