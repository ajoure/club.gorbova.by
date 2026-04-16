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
  source_entity: string; // page title / lesson name / product code
  created_at: string;
  status: string;
  has_deal: boolean;
  has_account: boolean;
  // For detail opening
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

export const DEFAULT_FILTERS: FormsHubFilters = {
  search: "",
  source_type: "all",
  product_id: "all",
  period_from: "",
  period_to: "",
  has_deal: "all",
  has_account: "all",
};

export function useFormsHubData(filters: FormsHubFilters, sourceTypeOverride?: FormsSourceType) {
  const effectiveSourceType = sourceTypeOverride || filters.source_type;

  return useQuery({
    queryKey: ["forms-hub-data", filters, sourceTypeOverride],
    queryFn: async (): Promise<FormsHubRow[]> => {
      const rows: FormsHubRow[] = [];

      // 1. Site form submissions
      if (effectiveSourceType === "all" || effectiveSourceType === "site_form") {
        const { data: forms } = await supabase
          .from("site_form_submissions")
          .select("id, form_data, metadata, status, created_at, profile_id, order_id, page_id, site_pages!site_form_submissions_page_id_fkey(title)")
          .order("created_at", { ascending: false })
          .limit(500);

        for (const f of forms || []) {
          const meta = (f.metadata || {}) as any;
          const formData = (f.form_data || {}) as any;
          const pageTitle = (f as any).site_pages?.title || "Без страницы";

          rows.push({
            id: f.id,
            source_type: "site_form",
            client_name: formData.name || formData.full_name || meta.full_name || "—",
            client_email: formData.email || meta.email || null,
            client_phone: formData.phone || meta.phone || null,
            profile_id: f.profile_id,
            user_id: meta.user_id || null,
            product_id: meta.product_id || null,
            product_title: meta.product_title || "",
            source_entity: pageTitle,
            created_at: f.created_at,
            status: f.status || "new",
            has_deal: !!f.order_id,
            has_account: !!f.profile_id,
            raw: f,
          });
        }
      }

      // 2. Preregistrations
      if (effectiveSourceType === "all" || effectiveSourceType === "preorder") {
        const { data: preorders } = await supabase
          .from("course_preregistrations")
          .select("id, name, email, phone, product_code, tariff_name, status, source, created_at, user_id, meta")
          .order("created_at", { ascending: false })
          .limit(500);

        for (const p of preorders || []) {
          rows.push({
            id: p.id,
            source_type: "preorder",
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
          });
        }
      }

      // 3. Training progress (lesson_progress_state aggregated per user+lesson)
      if (effectiveSourceType === "all" || effectiveSourceType === "training") {
        const { data: progress } = await supabase
          .from("lesson_progress_state")
          .select(`
            id, user_id, lesson_id, completed_at, created_at,
            training_lessons!inner(id, title, module_id,
              training_modules!inner(id, title, product_id,
                products_v2(id, name)
              )
            )
          `)
          .order("created_at", { ascending: false })
          .limit(500);

        if (progress) {
          // Get profiles for user_ids
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

          for (const r of progress) {
            const lesson = r.training_lessons as any;
            const module = lesson?.training_modules;
            const product = module?.products_v2;
            const profile = r.user_id ? profileMap[r.user_id] : null;

            rows.push({
              id: r.id,
              source_type: "training",
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
            });
          }
        }
      }

      // Sort all by date desc
      rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      // Apply client-side filters
      let filtered = rows;

      if (filters.search) {
        const q = filters.search.toLowerCase();
        filtered = filtered.filter(r =>
          r.client_name.toLowerCase().includes(q) ||
          (r.client_email || "").toLowerCase().includes(q) ||
          (r.client_phone || "").toLowerCase().includes(q)
        );
      }

      if (filters.product_id !== "all") {
        filtered = filtered.filter(r => r.product_id === filters.product_id || r.product_title === filters.product_id);
      }

      if (filters.period_from) {
        filtered = filtered.filter(r => r.created_at >= filters.period_from);
      }
      if (filters.period_to) {
        filtered = filtered.filter(r => r.created_at <= filters.period_to + "T23:59:59");
      }

      if (filters.has_deal === "yes") filtered = filtered.filter(r => r.has_deal);
      if (filters.has_deal === "no") filtered = filtered.filter(r => !r.has_deal);

      if (filters.has_account === "yes") filtered = filtered.filter(r => r.has_account);
      if (filters.has_account === "no") filtered = filtered.filter(r => !r.has_account);

      return filtered;
    },
    staleTime: 30_000,
  });
}

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
