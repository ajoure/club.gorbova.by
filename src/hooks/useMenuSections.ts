import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface MenuSection {
  id: string;
  key: string;
  label: string;
  icon: string;
  url: string;
  sort_order: number;
  parent_key: string | null;
  is_active: boolean;
}

export interface MenuSectionWithChildren extends MenuSection {
  children: MenuSection[];
}

export function useMenuSections() {
  return useQuery({
    queryKey: ["user-menu-sections"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_menu_sections")
        .select("*")
        .eq("is_active", true)
        .order("sort_order");

      if (error) throw error;

      const sections = data as MenuSection[];

      // Build hierarchical structure
      const topLevel = sections
        .filter((s) => !s.parent_key)
        .sort((a, b) => a.sort_order - b.sort_order);

      const withChildren: MenuSectionWithChildren[] = topLevel.map((parent) => ({
        ...parent,
        children: sections
          .filter((s) => s.parent_key === parent.key)
          .sort((a, b) => a.sort_order - b.sort_order),
      }));

      return withChildren;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Helper to get flat list of all sections for dropdown
export function useFlatMenuSections() {
  return useQuery({
    queryKey: ["user-menu-sections-flat"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_menu_sections")
        .select("*")
        .eq("is_active", true)
        .order("sort_order");

      if (error) throw error;
      return data as MenuSection[];
    },
    staleTime: 5 * 60 * 1000,
  });
}
