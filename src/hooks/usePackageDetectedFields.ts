/**
 * usePackageDetectedFields — token-driven альтернатива assignments.
 *
 * Для пакета загружает активные версии всех его DOCX-шаблонов и достаёт
 * из `document_template_versions.detected_tokens` множество pf-XXXXXX,
 * реально присутствующих в каждом шаблоне.
 *
 * Возвращает:
 *   • `byItemId[item_id]` → массив pf-public_ids в порядке первого появления
 *     в этом конкретном шаблоне;
 *   • `byPublicId[pf-XXXXXX]` → список item_id, где этот pf используется
 *     (нужно для подсчёта «в N документах»);
 *   • `allPublicIds` — уникальные pf-public_ids всего пакета.
 *
 * Никаких записей в `document_package_item_field_assignments`. Это чистый
 * derived view: что в DOCX, то и в анкете.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { extractPfPublicIds } from "@/lib/packageFields/extractPfTokens";

export interface PackageDetectedFieldsResult {
  /** package_template_item_id → ordered pf-public_ids в шаблоне этого документа. */
  byItemId: Record<string, string[]>;
  /** pf-public_id → список item_id, где он встречается. */
  byPublicId: Record<string, string[]>;
  /** Уникальные pf-public_ids всего пакета. */
  allPublicIds: string[];
  isLoading: boolean;
}

const QK = (pkgId: string | null) => ["package-detected-fields", pkgId] as const;

export function usePackageDetectedFields(
  packageTemplateId: string | null,
): PackageDetectedFieldsResult {
  const query = useQuery({
    queryKey: QK(packageTemplateId),
    queryFn: async () => {
      if (!packageTemplateId) return { items: [], versions: [] as Array<{ template_id: string; detected_tokens: unknown }> };

      const { data: items, error: itemsErr } = await supabase
        .from("document_package_template_items")
        .select("id, template_id")
        .eq("package_template_id", packageTemplateId);
      if (itemsErr) throw itemsErr;
      const rows = (items ?? []) as Array<{ id: string; template_id: string }>;
      const templateIds = Array.from(new Set(rows.map((r) => r.template_id)));
      if (templateIds.length === 0) return { items: rows, versions: [] };

      const { data: versions, error: vErr } = await supabase
        .from("document_template_versions")
        .select("template_id, detected_tokens, tokens")
        .in("template_id", templateIds)
        .eq("is_current", true);
      if (vErr) throw vErr;

      return {
        items: rows,
        versions: ((versions ?? []) as Array<{
          template_id: string;
          detected_tokens: unknown;
          tokens: unknown;
        }>),
      };
    },
    enabled: !!packageTemplateId,
    staleTime: 30 * 1000,
  });

  return useMemo(() => {
    const byItemId: Record<string, string[]> = {};
    const byPublicId: Record<string, string[]> = {};
    const seenAll = new Set<string>();

    const tokensByTemplate = new Map<string, string[]>();
    for (const v of query.data?.versions ?? []) {
      // Предпочитаем detected_tokens, fallback на tokens (legacy).
      const fromDetected = extractPfPublicIds(v.detected_tokens);
      const ids = fromDetected.length > 0
        ? fromDetected
        : extractPfPublicIds(v.tokens);
      tokensByTemplate.set(v.template_id, ids);
    }

    for (const it of query.data?.items ?? []) {
      const ids = tokensByTemplate.get(it.template_id) ?? [];
      byItemId[it.id] = ids;
      for (const id of ids) {
        if (!seenAll.has(id)) seenAll.add(id);
        (byPublicId[id] ??= []).push(it.id);
      }
    }

    return {
      byItemId,
      byPublicId,
      allPublicIds: Array.from(seenAll),
      isLoading: query.isLoading,
    };
  }, [query.data, query.isLoading]);
}
