import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Canonical Deals filters — URL-synced.
 * Compact, stable param names. Server-side filtering only.
 *
 * Note: `product`, `tariffs`, `pipeline`, `date_from`, `date_to`, `view` —
 * already managed by AdminDeals; not duplicated here.
 */
export interface DealsExtraFilters {
  statuses: string[];                 // multi: paid, pending, partial, canceled, refunded, failed, expired, draft, needs_mapping
  createdFrom?: string;               // YYYY-MM-DD (created_at)
  createdTo?: string;
  priceMin?: number;
  priceMax?: number;
  stageId?: string | null;            // pipeline_stage_id
  contactProfileId?: string | null;   // exact profile_id
  contactEmail?: string | null;       // exact customer_email
  salesManager?: string | null;       // user id or __unassigned__
  // advanced
  source?: string | null;             // meta->>source
  provider?: string | null;           // meta->>payment_provider
  reconcileSource?: string | null;    // reconcile_source column
  includeSynthetic: boolean;          // default false → exclude rule_engine
  // PATCH-PREORDER-DEAL-FLOW Phase B: default false → hide converted preorders
  // (rows with meta.converted_to_order_id set). User can opt-in to see them.
  includeConvertedPreorders: boolean;
}


const KEYS = {
  statuses: "statuses",
  createdFrom: "created_from",
  createdTo: "created_to",
  priceMin: "price_min",
  priceMax: "price_max",
  stage: "stage",
  contactProfile: "contact_profile",
  contactEmail: "contact_email",
  salesManager: "sales_manager",
  source: "source",
  provider: "provider",
  reconcileSource: "recon_src",
  includeSynthetic: "synthetic",
  includeConvertedPreorders: "conv_preorders",
} as const;


export function useDealsFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo<DealsExtraFilters>(() => {
    const statusesRaw = searchParams.get(KEYS.statuses);
    const priceMinRaw = searchParams.get(KEYS.priceMin);
    const priceMaxRaw = searchParams.get(KEYS.priceMax);
    return {
      statuses: statusesRaw ? statusesRaw.split(",").filter(Boolean) : [],
      createdFrom: searchParams.get(KEYS.createdFrom) || undefined,
      createdTo: searchParams.get(KEYS.createdTo) || undefined,
      priceMin: priceMinRaw ? Number(priceMinRaw) : undefined,
      priceMax: priceMaxRaw ? Number(priceMaxRaw) : undefined,
      stageId: searchParams.get(KEYS.stage) || null,
      contactProfileId: searchParams.get(KEYS.contactProfile) || null,
      contactEmail: searchParams.get(KEYS.contactEmail) || null,
      salesManager: searchParams.get(KEYS.salesManager) || null,
      source: searchParams.get(KEYS.source) || null,
      provider: searchParams.get(KEYS.provider) || null,
      reconcileSource: searchParams.get(KEYS.reconcileSource) || null,
      includeSynthetic: searchParams.get(KEYS.includeSynthetic) === "1",
      includeConvertedPreorders: searchParams.get(KEYS.includeConvertedPreorders) === "1",
    };

  }, [searchParams]);

  const updateFilters = useCallback(
    (patch: Partial<DealsExtraFilters>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const apply = (key: string, val: string | undefined | null) => {
            if (val === undefined || val === null || val === "") next.delete(key);
            else next.set(key, val);
          };
          if ("statuses" in patch) {
            const v = patch.statuses;
            if (!v || v.length === 0) next.delete(KEYS.statuses);
            else next.set(KEYS.statuses, v.join(","));
          }
          if ("createdFrom" in patch) apply(KEYS.createdFrom, patch.createdFrom);
          if ("createdTo" in patch) apply(KEYS.createdTo, patch.createdTo);
          if ("priceMin" in patch) apply(KEYS.priceMin, patch.priceMin != null ? String(patch.priceMin) : undefined);
          if ("priceMax" in patch) apply(KEYS.priceMax, patch.priceMax != null ? String(patch.priceMax) : undefined);
          if ("stageId" in patch) apply(KEYS.stage, patch.stageId);
          if ("contactProfileId" in patch) apply(KEYS.contactProfile, patch.contactProfileId);
          if ("contactEmail" in patch) apply(KEYS.contactEmail, patch.contactEmail);
          if ("salesManager" in patch) apply(KEYS.salesManager, patch.salesManager);
          if ("source" in patch) apply(KEYS.source, patch.source);
          if ("provider" in patch) apply(KEYS.provider, patch.provider);
          if ("reconcileSource" in patch) apply(KEYS.reconcileSource, patch.reconcileSource);
          if ("includeSynthetic" in patch) {
            if (patch.includeSynthetic) next.set(KEYS.includeSynthetic, "1");
            else next.delete(KEYS.includeSynthetic);
          }
          if ("includeConvertedPreorders" in patch) {
            if (patch.includeConvertedPreorders) next.set(KEYS.includeConvertedPreorders, "1");
            else next.delete(KEYS.includeConvertedPreorders);
          }
          return next;

        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const resetExtraFilters = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        Object.values(KEYS).forEach((k) => next.delete(k));
        return next;
      },
      { replace: true }
    );
  }, [setSearchParams]);

  const activeCount = useMemo(() => {
    let n = 0;
    if (filters.statuses.length > 0) n++;
    if (filters.createdFrom || filters.createdTo) n++;
    if (filters.priceMin != null || filters.priceMax != null) n++;
    if (filters.stageId) n++;
    if (filters.contactProfileId || filters.contactEmail) n++;
    if (filters.salesManager) n++;
    if (filters.source) n++;
    if (filters.provider) n++;
    if (filters.reconcileSource) n++;
    if (filters.includeSynthetic) n++;
    if (filters.includeConvertedPreorders) n++;
    return n;

  }, [filters]);

  return { filters, updateFilters, resetExtraFilters, activeCount };
}
