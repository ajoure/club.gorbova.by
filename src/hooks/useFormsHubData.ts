/**
 * Forms Hub data layer — PATCH 1: server-side filters & pagination.
 *
 * Architecture:
 * - Single-source tabs (site_form, preorder, training) → server-filtered + paginated
 * - "All" tab → aggregated mode: 3 parallel server-filtered queries, merged + sorted client-side
 * - "By Products" tab → aggregated grouped mode (same as All, grouped by product)
 * - Export → explicit exportMode (no pagination, same server filters)
 *
 * This is NOT a unified backend layer — it's stabilization of the MVP for production use.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getProductName } from "@/lib/product-names";

export type FormsSourceType = "site_form" | "preorder" | "training";

export interface FormsHubRow {
  id: string;
  source_type: FormsSourceType;
  client_name: string;
  client_email: string | null;
  client_phone: string | null;
  profile_id: string | null;
  user_id: string | null;
  product_id: string | null;
  product_title: string;
  source_entity: string;
  created_at: string;
  status: string;
  has_deal: boolean;
  has_account: boolean;
  // Training-only: used for level-2/3 grouping in By-Product tab
  module_id: string | null;
  module_title: string | null;
  lesson_id: string | null;
  lesson_title: string | null;
  raw: any;
}

export interface FormsHubFilters {
  search: string;
  source_type: FormsSourceType | "all";
  product_id: string;
  period_from: string;
  period_to: string;
  has_deal: "all" | "yes" | "no";
  has_account: "all" | "yes" | "no";
}

export interface FormsHubPagination {
  page: number;
  pageSize: number;
}

export interface FormsHubResult {
  rows: FormsHubRow[];
  totalCount: number;
}

export const DEFAULT_FILTERS: FormsHubFilters = {
  search: "",
  source_type: "all",
  product_id: "all",
  period_from: "",
  period_to: "",
  has_deal: "all",
  has_account: "all",
};

export const DEFAULT_PAGINATION: FormsHubPagination = {
  page: 1,
  pageSize: 50,
};

// ── Source-specific fetchers ────────────────────────────────────────────

async function fetchSiteForms(
  filters: FormsHubFilters,
  pagination?: FormsHubPagination
): Promise<{ rows: FormsHubRow[]; count: number }> {
  let query = supabase
    .from("site_form_submissions")
    .select(
      "id, form_data, metadata, status, created_at, profile_id, order_id, page_id, site_pages!site_form_submissions_page_id_fkey(title)",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .order("id");

  // Server-side filters
  if (filters.period_from) query = query.gte("created_at", filters.period_from);
  if (filters.period_to) query = query.lte("created_at", filters.period_to + "T23:59:59.999Z");

  if (filters.has_deal === "yes") query = query.not("order_id", "is", null);
  if (filters.has_deal === "no") query = query.is("order_id", null);

  // Note: search and product_id for site_forms require client-side filtering
  // because data lives in JSONB form_data/metadata, not indexed columns.

  // Pagination (only for single-source mode)
  if (pagination) {
    const offset = (pagination.page - 1) * pagination.pageSize;
    query = query.range(offset, offset + pagination.pageSize - 1);
  }

  const { data: forms, count } = await query;

  // Batch-resolve profile user_ids
  const profileIdsToResolve: string[] = [];
  for (const f of forms || []) {
    const meta = (f.metadata || {}) as any;
    if (!meta.user_id && f.profile_id) {
      profileIdsToResolve.push(f.profile_id);
    }
  }

  let profileUserIdMap: Record<string, string | null> = {};
  if (profileIdsToResolve.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, user_id")
      .in("id", [...new Set(profileIdsToResolve)]);
    if (profiles) {
      for (const p of profiles) {
        profileUserIdMap[p.id] = p.user_id;
      }
    }
  }

  const rows: FormsHubRow[] = [];
  for (const f of forms || []) {
    const meta = (f.metadata || {}) as any;
    const formData = (f.form_data || {}) as any;
    const pageTitle = (f as any).site_pages?.title || "Без страницы";
    const metaUserId = meta.user_id || null;
    const resolvedUserId = metaUserId || (f.profile_id ? profileUserIdMap[f.profile_id] : null);

    rows.push({
      id: f.id,
      source_type: "site_form",
      client_name: formData.name || formData.full_name || meta.full_name || "—",
      client_email: formData.email || meta.email || null,
      client_phone: formData.phone || meta.phone || null,
      profile_id: f.profile_id,
      user_id: resolvedUserId,
      product_id: meta.product_id || null,
      product_title: meta.product_title || "",
      source_entity: pageTitle,
      created_at: f.created_at,
      status: f.status || "new",
      has_deal: !!f.order_id,
      has_account: !!resolvedUserId,
      raw: f,
    });
  }

  return { rows, count: count ?? rows.length };
}

async function fetchPreorders(
  filters: FormsHubFilters,
  pagination?: FormsHubPagination
): Promise<{ rows: FormsHubRow[]; count: number }> {
  let query = supabase
    .from("course_preregistrations")
    .select("id, name, email, phone, product_code, tariff_name, status, source, created_at, user_id, meta", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id");

  // Server-side filters — preorders have direct columns
  if (filters.period_from) query = query.gte("created_at", filters.period_from);
  if (filters.period_to) query = query.lte("created_at", filters.period_to + "T23:59:59.999Z");

  if (filters.search) {
    const q = `%${filters.search}%`;
    query = query.or(`name.ilike.${q},email.ilike.${q},phone.ilike.${q}`);
  }

  // has_deal: preorders never have deals
  if (filters.has_deal === "yes") return { rows: [], count: 0 };

  // has_account
  if (filters.has_account === "yes") query = query.not("user_id", "is", null);
  if (filters.has_account === "no") query = query.is("user_id", null);

  if (pagination) {
    const offset = (pagination.page - 1) * pagination.pageSize;
    query = query.range(offset, offset + pagination.pageSize - 1);
  }

  const { data: preorders, count } = await query;

  const rows: FormsHubRow[] = (preorders || []).map((p) => ({
    id: p.id,
    source_type: "preorder" as const,
    client_name: p.name || "—",
    client_email: p.email,
    client_phone: p.phone,
    profile_id: null,
    user_id: p.user_id,
    product_id: null,
    product_title: getProductName(p.product_code),
    source_entity: p.tariff_name || p.product_code,
    created_at: p.created_at,
    status: p.status || "new",
    has_deal: false,
    has_account: !!p.user_id,
    raw: p,
  }));

  return { rows, count: count ?? rows.length };
}

async function fetchTraining(
  filters: FormsHubFilters,
  pagination?: FormsHubPagination
): Promise<{ rows: FormsHubRow[]; count: number }> {
  let query = supabase
    .from("lesson_progress_state")
    .select(`
      id, user_id, lesson_id, completed_at, created_at,
      training_lessons!inner(id, title, module_id,
        training_modules!inner(id, title, product_id,
          products_v2(id, name)
        )
      )
    `, { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id");

  if (filters.period_from) query = query.gte("created_at", filters.period_from);
  if (filters.period_to) query = query.lte("created_at", filters.period_to + "T23:59:59.999Z");

  // has_deal: training never has deals
  if (filters.has_deal === "yes") return { rows: [], count: 0 };

  // has_account: training always has user_id
  if (filters.has_account === "no") return { rows: [], count: 0 };

  if (pagination) {
    const offset = (pagination.page - 1) * pagination.pageSize;
    query = query.range(offset, offset + pagination.pageSize - 1);
  }

  const { data: progress, count } = await query;

  if (!progress) return { rows: [], count: 0 };

  // Resolve profiles for search filtering
  const userIds = [...new Set(progress.map(p => p.user_id).filter(Boolean))];
  let profileMap: Record<string, any> = {};
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, full_name, email")
      .in("user_id", userIds);
    if (profiles) {
      for (const p of profiles) {
        if (p.user_id) profileMap[p.user_id] = p;
      }
    }
  }

  let rows: FormsHubRow[] = progress.map((r) => {
    const lesson = r.training_lessons as any;
    const module = lesson?.training_modules;
    const product = module?.products_v2;
    const profile = r.user_id ? profileMap[r.user_id] : null;

    return {
      id: r.id,
      source_type: "training" as const,
      client_name: profile?.full_name || profile?.email || "—",
      client_email: profile?.email || null,
      client_phone: null,
      profile_id: null,
      user_id: r.user_id,
      product_id: product?.id || module?.product_id || null,
      product_title: product?.name || module?.title || "",
      source_entity: lesson?.title || "Урок",
      created_at: r.completed_at || r.created_at,
      status: r.completed_at ? "completed" : "in_progress",
      has_deal: false,
      has_account: !!r.user_id,
      raw: { ...r, lesson, module, product, profile },
    };
  });

  // Training search is client-side (search through resolved profile names/emails)
  if (filters.search) {
    const q = filters.search.toLowerCase();
    rows = rows.filter(r =>
      r.client_name.toLowerCase().includes(q) ||
      (r.client_email || "").toLowerCase().includes(q)
    );
  }

  return { rows, count: count ?? rows.length };
}

// ── Client-side filters (for fields not queryable server-side) ──────────

function applyClientFilters(rows: FormsHubRow[], filters: FormsHubFilters): FormsHubRow[] {
  let filtered = rows;

  // Search for site_forms only (preorder/training handled server-side or in fetcher)
  if (filters.search) {
    const q = filters.search.toLowerCase();
    filtered = filtered.filter(r => {
      if (r.source_type !== "site_form") return true; // already filtered
      return (
        r.client_name.toLowerCase().includes(q) ||
        (r.client_email || "").toLowerCase().includes(q) ||
        (r.client_phone || "").toLowerCase().includes(q)
      );
    });
  }

  // Product filter — client-side for site_forms (JSONB), server join not possible without RPC
  if (filters.product_id !== "all") {
    filtered = filtered.filter(r =>
      r.product_id === filters.product_id || r.product_title === filters.product_id
    );
  }

  return filtered;
}

// ── Main hook ────────────────────────────────────────────────────────────

export function useFormsHubData(
  filters: FormsHubFilters,
  sourceTypeOverride?: FormsSourceType,
  pagination: FormsHubPagination = DEFAULT_PAGINATION,
  options?: { exportMode?: boolean }
) {
  const effectiveSourceType = sourceTypeOverride || filters.source_type;
  const pag = options?.exportMode ? undefined : pagination;

  return useQuery({
    queryKey: ["forms-hub-data", filters, sourceTypeOverride, pagination.page, pagination.pageSize, options?.exportMode],
    queryFn: async (): Promise<FormsHubResult> => {
      // Single-source: server-paginated
      if (effectiveSourceType !== "all") {
        const fetcher = effectiveSourceType === "site_form"
          ? fetchSiteForms
          : effectiveSourceType === "preorder"
            ? fetchPreorders
            : fetchTraining;

        const result = await fetcher(filters, pag);
        const filtered = applyClientFilters(result.rows, filters);

        return {
          rows: filtered,
          totalCount: result.count,
        };
      }

      // "All" tab: aggregated mode — 3 parallel server-filtered queries
      const [siteResult, preorderResult, trainingResult] = await Promise.all([
        fetchSiteForms(filters),
        fetchPreorders(filters),
        fetchTraining(filters),
      ]);

      let merged = [
        ...siteResult.rows,
        ...preorderResult.rows,
        ...trainingResult.rows,
      ];

      // Client-side filters for cross-source
      merged = applyClientFilters(merged, filters);

      // Deterministic sort: created_at desc, id asc
      merged.sort((a, b) => {
        const dateDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        if (dateDiff !== 0) return dateDiff;
        return a.id.localeCompare(b.id);
      });

      const totalCount = merged.length;

      // Client-side pagination for aggregated mode
      if (pag) {
        const offset = (pag.page - 1) * pag.pageSize;
        merged = merged.slice(offset, offset + pag.pageSize);
      }

      return { rows: merged, totalCount };
    },
    staleTime: 30_000,
  });
}

// ── Products list for filter dropdown ────────────────────────────────────

export function useFormsHubProducts() {
  return useQuery({
    queryKey: ["forms-hub-products"],
    queryFn: async () => {
      const { data } = await supabase
        .from("products_v2")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
    staleTime: 5 * 60_000,
  });
}
