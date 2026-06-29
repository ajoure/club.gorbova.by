import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface StaffOption {
  user_id: string;
  label: string;
  email: string | null;
}

/**
 * Lightweight list of staff members that can be assigned tasks.
 * Returns profiles having at least one of: employee | admin | super_admin role.
 * Falls back to all profiles if role-join is restricted by RLS.
 */
export function useStaffOptions() {
  return useQuery({
    queryKey: ["staff-options"],
    queryFn: async (): Promise<StaffOption[]> => {
      // 1) try role-filtered list
      try {
        const { data: roleRows, error: rolesErr } = await supabase
          .from("user_roles_v2")
          .select("user_id, roles:role_id(code)");
        if (!rolesErr && roleRows) {
          const staffIds = new Set<string>();
          roleRows.forEach((r: any) => {
            const code = r.roles?.code;
            if (code === "employee" || code === "admin" || code === "super_admin") {
              if (r.user_id) staffIds.add(r.user_id);
            }
          });
          if (staffIds.size > 0) {
            const { data: profiles } = await supabase
              .from("profiles")
              .select("user_id, full_name, email")
              .in("user_id", Array.from(staffIds))
              .order("full_name", { ascending: true });
            return (profiles ?? []).map((p: any) => ({
              user_id: p.user_id,
              label: p.full_name || p.email || p.user_id,
              email: p.email ?? null,
            }));
          }
        }
      } catch {
        // ignore – fallback below
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .not("user_id", "is", null)
        .order("full_name", { ascending: true })
        .limit(300);
      if (error) throw error;
      return (data ?? []).map((p: any) => ({
        user_id: p.user_id,
        label: p.full_name || p.email || p.user_id,
        email: p.email ?? null,
      }));
    },
    staleTime: 5 * 60 * 1000,
  });
}
