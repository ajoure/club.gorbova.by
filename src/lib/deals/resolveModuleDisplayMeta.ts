/**
 * resolveModuleDisplayMeta — batch-резолвер для отображения модульных сделок.
 *
 * Извлекает module UUIDs из purchase_snapshot.module_list_mapped,
 * подгружает products_v2 по этим UUID, возвращает map: orderId → ModuleDisplayMeta.
 *
 * Используется единообразно во всех consumer-компонентах.
 */

import { supabase } from "@/integrations/supabase/client";

export interface ModuleDisplayMeta {
  resolvedDisplayName: string | null;
  resolvedPublicId: string | null;
  resolvedModuleProductId: string | null;
  resolutionType: "direct_module" | "multi_module" | "snapshot_fallback" | "parent_fallback" | "not_module";
  moduleProduct: { name: string; publicId: string } | null;
}

/**
 * Safely extract module_list_mapped UUIDs from a purchase_snapshot.
 */
function extractModuleIds(snapshot: unknown): string[] {
  if (!snapshot || typeof snapshot !== "object") return [];
  const obj = snapshot as Record<string, unknown>;
  const list = obj.module_list_mapped;
  if (!Array.isArray(list)) return [];
  return list
    .map((item: unknown) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && typeof (item as any).product_id === "string") {
        return (item as any).product_id;
      }
      return null;
    })
    .filter((id): id is string => !!id && id.length > 10);
}

function isModuleStandalone(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== "object") return false;
  return (snapshot as any).historical_purchase_type === "module_only_standalone";
}

/**
 * Batch-resolve module display meta for an array of deals.
 * Returns a Map<dealId, ModuleDisplayMeta>.
 *
 * @param deals - array of deal-like objects with { id, purchase_snapshot }
 */
export async function resolveModuleDisplayMetaBatch(
  deals: Array<{ id: string; purchase_snapshot: unknown }>
): Promise<Map<string, ModuleDisplayMeta>> {
  const result = new Map<string, ModuleDisplayMeta>();

  // 1. Collect all unique module UUIDs from module_only_standalone deals
  const dealModuleMap = new Map<string, string[]>(); // dealId → moduleIds
  const allModuleIds = new Set<string>();

  for (const deal of deals) {
    if (!isModuleStandalone(deal.purchase_snapshot)) {
      result.set(deal.id, {
        resolvedDisplayName: null,
        resolvedPublicId: null,
        resolvedModuleProductId: null,
        resolutionType: "not_module",
        moduleProduct: null,
      });
      continue;
    }

    const moduleIds = extractModuleIds(deal.purchase_snapshot);
    dealModuleMap.set(deal.id, moduleIds);
    moduleIds.forEach((id) => allModuleIds.add(id));
  }

  // 2. Batch-fetch products_v2 for all module UUIDs
  const moduleProductsMap = new Map<string, { name: string; publicId: string }>();

  if (allModuleIds.size > 0) {
    const ids = Array.from(allModuleIds);
    // Supabase .in() limit is ~300, chunk if needed
    const CHUNK = 200;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const { data } = await supabase
        .from("products_v2")
        .select("id, name, public_id")
        .in("id", chunk);

      if (data) {
        for (const p of data) {
          moduleProductsMap.set(p.id, {
            name: p.name,
            publicId: p.public_id || "",
          });
        }
      }
    }
  }

  // 3. Build meta for each module_only_standalone deal
  for (const [dealId, moduleIds] of dealModuleMap) {
    if (moduleIds.length === 1) {
      const moduleId = moduleIds[0];
      const product = moduleProductsMap.get(moduleId) || null;
      if (product) {
        result.set(dealId, {
          resolvedDisplayName: product.name,
          resolvedPublicId: product.publicId,
          resolvedModuleProductId: moduleId,
          resolutionType: "direct_module",
          moduleProduct: product,
        });
      } else {
        result.set(dealId, {
          resolvedDisplayName: null,
          resolvedPublicId: null,
          resolvedModuleProductId: moduleId,
          resolutionType: "snapshot_fallback",
          moduleProduct: null,
        });
      }
    } else if (moduleIds.length > 1) {
      result.set(dealId, {
        resolvedDisplayName: null,
        resolvedPublicId: null,
        resolvedModuleProductId: null,
        resolutionType: "multi_module",
        moduleProduct: null,
      });
    } else {
      // No module_list_mapped but is module_only_standalone
      result.set(dealId, {
        resolvedDisplayName: null,
        resolvedPublicId: null,
        resolvedModuleProductId: null,
        resolutionType: "snapshot_fallback",
        moduleProduct: null,
      });
    }
  }

  return result;
}
