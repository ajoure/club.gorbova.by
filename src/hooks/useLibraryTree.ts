import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TrainingModule } from "@/hooks/useTrainingModules";

/* ── Types ─────────────────────────────────────────────── */

export interface LibraryGroup {
  productId: string; // product UUID or "__no_product__"
  productName: string;
  rootModules: LibraryRootModule[];
  /** Aggregate: total lessons across all root modules in this group */
  totalLessons: number;
  totalCompleted: number;
  /** true when single root module title duplicates group name — skip root row */
  isFlattenable: boolean;
  flattenedRoot?: LibraryRootModule;
}

export interface LibraryRootModule {
  module: TrainingModule;
  children: TrainingModule[]; // direct child modules (sorted)
  /** true = this root has child modules; false = lessons are directly under root */
  hasChildren: boolean;
  accessLabel: string;
}

const NO_PRODUCT_ID = "__no_product__";
const NO_PRODUCT_NAME = "Без продукта";

/* ── Title normalizer & flatten check ─────────────────── */

function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[|·—–\-]/g, "").replace(/\s+/g, " ").trim();
}

export function shouldFlattenSingleRoot(
  _groupProductId: string,
  _groupName: string,
  rootModules: LibraryRootModule[],
): { flatten: boolean; root?: LibraryRootModule } {
  if (rootModules.length !== 1) return { flatten: false };
  // Always flatten single-root groups — no title match needed
  return { flatten: true, root: rootModules[0] };
}

/* ── Access label resolver ─────────────────────────────── */

/**
 * Resolve a single human-readable access label for a module.
 * Priority: tariff → product → fallback "Доступно".
 */
export function resolveAccessLabel(module: TrainingModule): string {
  // 1. Tariff name (first non-empty)
  const tariffs = module.accessible_tariffs || [];
  const firstTariff = tariffs.find((t) => t && t.trim().length > 0);
  if (firstTariff) return firstTariff;

  // 2. Product name (first non-empty)
  const products = module.accessible_products || [];
  const firstProduct = products.find((p) => p.product_name && p.product_name.trim().length > 0);
  if (firstProduct) return firstProduct.product_name;

  // 3. Fallback
  return "Доступно";
}

/* ── Tree builder ──────────────────────────────────────── */

export function useLibraryTree(libraryModules: TrainingModule[], allModules: TrainingModule[]) {
  // Fetch product names for group headers
  const productIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of allModules) {
      if (m.product_id) ids.add(m.product_id);
    }
    return [...ids];
  }, [allModules]);

  const { data: productsMap } = useQuery({
    queryKey: ["library-product-names", productIds],
    queryFn: async () => {
      if (productIds.length === 0) return {} as Record<string, string>;
      const { data } = await supabase
        .from("products_v2")
        .select("id, name")
        .in("id", productIds);
      const map: Record<string, string> = {};
      (data || []).forEach((p: any) => { map[p.id] = p.name; });
      return map;
    },
    enabled: productIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  return useMemo(() => {
    if (!libraryModules.length) return [] as LibraryGroup[];

    // Build a full module map for hierarchy resolution
    const byId = new Map(allModules.map((m) => [m.id, m]));

    // Find the effective root for any module (walk up parent_module_id)
    const findRoot = (m: TrainingModule): TrainingModule => {
      let current = m;
      const visited = new Set<string>();
      while (current.parent_module_id && !visited.has(current.id)) {
        visited.add(current.id);
        const parent = byId.get(current.parent_module_id);
        if (!parent) break;
        current = parent;
      }
      return current;
    };

    // Separate root modules from child modules within libraryModules
    const rootModuleMap = new Map<string, TrainingModule>();
    const childModules: TrainingModule[] = [];

    for (const m of libraryModules) {
      if (!m.parent_module_id) {
        rootModuleMap.set(m.id, m);
      } else {
        childModules.push(m);
      }
    }

    // Also check if child modules have accessible roots that are in libraryModules
    // If a child's root is not yet tracked, it means the root is accessible and in libraryModules
    // (since libraryModules only contains has_access=true modules)

    // Build children map: rootId → child modules (only direct children of roots that are in library)
    const childrenByRoot = new Map<string, TrainingModule[]>();
    for (const child of childModules) {
      // Only consider direct children of roots
      if (child.parent_module_id && rootModuleMap.has(child.parent_module_id)) {
        const arr = childrenByRoot.get(child.parent_module_id) || [];
        arr.push(child);
        childrenByRoot.set(child.parent_module_id, arr);
      }
    }

    // Sort children by sort_order
    for (const [, children] of childrenByRoot) {
      children.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    }

    // Group root modules by product_id
    const groupMap = new Map<string, { productName: string; roots: TrainingModule[] }>();

    for (const [, root] of rootModuleMap) {
      const pid = root.product_id || NO_PRODUCT_ID;
      if (!groupMap.has(pid)) {
        let productName = NO_PRODUCT_NAME;
        if (root.product_id && productsMap?.[root.product_id]) {
          productName = productsMap[root.product_id];
        }
        groupMap.set(pid, { productName, roots: [] });
      }
      groupMap.get(pid)!.roots.push(root);
    }

    // Build final groups
    const groups: LibraryGroup[] = [];

    for (const [pid, { productName, roots }] of groupMap) {
      // Sort roots by sort_order
      roots.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

      const rootNodes: LibraryRootModule[] = roots.map((root) => {
        const children = childrenByRoot.get(root.id) || [];
        return {
          module: root,
          children,
          hasChildren: children.length > 0,
          accessLabel: resolveAccessLabel(root),
        };
      });

      const totalLessons = roots.reduce((s, r) => s + (r.lesson_count || 0), 0);
      const totalCompleted = roots.reduce((s, r) => s + (r.completed_count || 0), 0);

      const { flatten, root: flatRoot } = shouldFlattenSingleRoot(pid, productName, rootNodes);

      groups.push({
        productId: pid,
        productName,
        rootModules: rootNodes,
        totalLessons,
        totalCompleted,
        isFlattenable: flatten,
        flattenedRoot: flatRoot,
      });
    }

    // Sort groups: named products first (alphabetically), "Без продукта" last
    groups.sort((a, b) => {
      if (a.productId === NO_PRODUCT_ID) return 1;
      if (b.productId === NO_PRODUCT_ID) return -1;
      return a.productName.localeCompare(b.productName, "ru");
    });

    return groups;
  }, [libraryModules, allModules, productsMap]);
}
