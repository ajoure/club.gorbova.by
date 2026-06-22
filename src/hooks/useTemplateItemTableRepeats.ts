/**
 * useTemplateItemTableRepeats — Stage E.2 (PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1).
 *
 * Read/write `document_package_template_items.metadata.table_repeats[]`
 * с merge-only контрактом:
 *   1. SELECT свежего `metadata`;
 *   2. метадата сохраняется как `{ ...freshMetadata, table_repeats: next }`;
 *   3. остальные ключи `metadata` (existing/forward-compat) НЕ затрагиваются.
 *
 * Никаких прямых INSERT/DELETE — только UPDATE одного item.metadata.
 * RLS: `Owner can update own package items` уже разрешает owner / admin /
 * super_admin. Никаких новых RPC / SECURITY DEFINER не вводится.
 *
 * Stage E.2 ограничен UI/config: реальная DOCX-row-expansion — Stage E.4,
 * резолвер табличных значений в dry-run — Stage E.3.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  readTableRepeats,
  type TableRepeatConfig,
} from "@/lib/documents/tableRepeatSpec";

const QK = (itemId: string | null | undefined) =>
  ["template-item-table-repeats", itemId ?? "_"] as const;

export function useTemplateItemTableRepeats(
  itemId: string | null,
  packageTemplateId?: string | null,
) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: QK(itemId),
    queryFn: async () => {
      if (!itemId) {
        return { repeats: [] as TableRepeatConfig[], metadata: {} as Record<string, unknown> };
      }
      const { data, error } = await supabase
        .from("document_package_template_items")
        .select("id, metadata")
        .eq("id", itemId)
        .maybeSingle();
      if (error) throw error;
      const meta = (data?.metadata ?? {}) as Record<string, unknown>;
      return { repeats: readTableRepeats(meta), metadata: meta };
    },
    enabled: !!itemId,
  });

  const saveMutation = useMutation({
    mutationFn: async (nextRepeats: TableRepeatConfig[]) => {
      if (!itemId) throw new Error("itemId is required");

      // Шаг 1: всегда читать СВЕЖИЙ metadata прямо перед UPDATE
      // (merge-only контракт: не затирать ключи, изменившиеся параллельно).
      const { data: fresh, error: readErr } = await supabase
        .from("document_package_template_items")
        .select("metadata")
        .eq("id", itemId)
        .maybeSingle();
      if (readErr) throw readErr;
      const freshMeta = (fresh?.metadata ?? {}) as Record<string, unknown>;

      // Нормализация nextRepeats через readTableRepeats — гарантирует round-trip.
      const normalized = readTableRepeats({ ...freshMeta, table_repeats: nextRepeats });

      const mergedMetadata: Record<string, unknown> = {
        ...freshMeta,
        table_repeats: normalized,
      };

      const { error: updErr } = await supabase
        .from("document_package_template_items")
        .update({ metadata: mergedMetadata as never })
        .eq("id", itemId);
      if (updErr) throw updErr;
      return normalized;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK(itemId) });
      if (packageTemplateId) {
        qc.invalidateQueries({
          queryKey: ["document-package-items", packageTemplateId],
        });
      }
      toast.success("Повторяемые строки таблиц сохранены");
    },
    onError: (e: Error) => {
      toast.error(`Не удалось сохранить: ${e.message}`);
    },
  });

  return {
    repeats: query.data?.repeats ?? [],
    rawMetadata: query.data?.metadata ?? {},
    isLoading: query.isLoading,
    save: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
  };
}
