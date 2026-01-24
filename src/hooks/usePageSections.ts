import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PageSection {
  id: string;
  key: string;
  label: string;
  icon: string;
  url: string;
  sort_order: number;
  parent_key: string | null;
  page_key: string | null;
  kind: string;
  is_active: boolean;
}

/**
 * Hook to fetch tabs for a specific page from user_menu_sections
 * @param pageKey - The page identifier (e.g., 'knowledge', 'products')
 */
export function usePageSections(pageKey: string) {
  const queryClient = useQueryClient();

  // Fetch active tabs for the page
  const tabsQuery = useQuery({
    queryKey: ["page-sections-tabs", pageKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_menu_sections")
        .select("*")
        .eq("page_key", pageKey)
        .eq("kind", "tab")
        .eq("is_active", true)
        .order("sort_order");

      if (error) throw error;
      return (data || []) as PageSection[];
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Fetch all sections for the page (for selectors)
  const treeQuery = useQuery({
    queryKey: ["page-sections-tree", pageKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_menu_sections")
        .select("*")
        .eq("page_key", pageKey)
        .order("sort_order");

      if (error) throw error;
      return (data || []) as PageSection[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["page-sections-tabs", pageKey] });
    queryClient.invalidateQueries({ queryKey: ["page-sections-tree", pageKey] });
    queryClient.invalidateQueries({ queryKey: ["user-menu-sections"] });
  };

  return {
    tabs: tabsQuery.data || [],
    tree: treeQuery.data || [],
    isLoading: tabsQuery.isLoading || treeQuery.isLoading,
    error: tabsQuery.error || treeQuery.error,
    invalidate,
  };
}

/**
 * Hook to fetch all page sections (roots) for the section selector
 */
export function useAllPageSections() {
  return useQuery({
    queryKey: ["all-page-sections"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_menu_sections")
        .select("*")
        .eq("is_active", true)
        .order("sort_order");

      if (error) throw error;

      const sections = (data || []) as PageSection[];

      // Build hierarchical structure
      const roots = sections.filter((s) => s.kind === "page" || !s.parent_key);
      const withChildren = roots.map((parent) => ({
        ...parent,
        children: sections.filter((s) => s.parent_key === parent.key),
      }));

      return withChildren;
    },
    staleTime: 5 * 60 * 1000,
  });
}
