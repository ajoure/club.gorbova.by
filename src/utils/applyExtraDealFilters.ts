import type { DealsExtraFilters } from "@/hooks/useDealsFilters";

/**
 * Apply canonical extra filters to a Supabase orders_v2 query builder.
 * All filters are applied server-side. Default-deny for synthetic
 * rule_engine source unless includeSynthetic=true.
 */
export function applyExtraDealFilters<T extends any>(query: T, f: DealsExtraFilters): T {
  let q: any = query;

  // Status (multi)
  if (f.statuses && f.statuses.length > 0) {
    q = q.in("status", f.statuses);
  }

  // Created at range
  if (f.createdFrom) q = q.gte("created_at", `${f.createdFrom}T00:00:00Z`);
  if (f.createdTo) q = q.lte("created_at", `${f.createdTo}T23:59:59Z`);

  // Price range
  if (f.priceMin != null && !Number.isNaN(f.priceMin)) {
    q = q.gte("final_price", f.priceMin);
  }
  if (f.priceMax != null && !Number.isNaN(f.priceMax)) {
    q = q.lte("final_price", f.priceMax);
  }

  // Pipeline stage
  if (f.stageId) {
    q = q.eq("pipeline_stage_id", f.stageId);
  }

  // Contact — exact match (no ILIKE on whole table)
  if (f.contactProfileId) {
    q = q.eq("profile_id", f.contactProfileId);
  } else if (f.contactEmail) {
    q = q.eq("customer_email", f.contactEmail);
  }

  // Advanced
  if (f.source) {
    q = q.eq("meta->>source", f.source);
  }
  if (f.provider) {
    q = q.eq("meta->>payment_provider", f.provider);
  }
  if (f.reconcileSource) {
    q = q.eq("reconcile_source", f.reconcileSource);
  }

  // Default-deny synthetic rule_engine orders
  if (!f.includeSynthetic) {
    // Exclude rows where meta->>source = 'rule_engine'.
    // NULL or any other value passes.
    q = q.or("meta->>source.is.null,meta->>source.neq.rule_engine");
  }

  return q as T;
}
